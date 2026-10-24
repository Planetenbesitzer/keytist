const svgDataHeader = /^data:image\/svg\+xml(?:;[^,]*)?,/i
export interface SvgImageViewport { width: number; height: number }

const utf8Base64 = (value: string) => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  return btoa(binary)
}

/** Canonical data lets PptxGenJS create both SVG and its PNG compatibility image. */
export const normalizeSvgForPptx = (source: string): string => {
  const header = svgDataHeader.exec(source)?.[0]
  let svg = source
  if (header) {
    const payload = source.slice(header.length)
    svg = /;base64(?:;|,)/i.test(header)
      ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(payload), character => character.charCodeAt(0)))
      : decodeURIComponent(payload)
  }
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = parsed.documentElement
  if (parsed.querySelector('parsererror') || root.localName !== 'svg') throw new Error('SVG 图片格式无效。')
  const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const dimension = (name: string) => {
    const value = root.getAttribute(name) || ''
    return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? parseFloat(value) : 0
  }
  let width = dimension('width')
  let height = dimension('height')
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    width ||= height ? height * viewBox[2] / viewBox[3] : viewBox[2]
    height ||= width * viewBox[3] / viewBox[2]
  }
  if (!(width > 0 && height > 0)) throw new Error('SVG 图片需要有效的 width/height 或 viewBox。')
  // A bounded intrinsic size gives browsers a useful PNG fallback even for
  // viewBox-only SVGs, without changing the vector content or slide geometry.
  const scale = Math.min(1, 4096 / width, 4096 / height)
  root.setAttribute('width', String(Math.max(1, Math.round(width * scale))))
  root.setAttribute('height', String(Math.max(1, Math.round(height * scale))))
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return `data:image/svg+xml;base64,${utf8Base64(new XMLSerializer().serializeToString(root))}`
}

/** Reproduce the SVG image viewport that the browser gives its img element. */
export const wrapSvgViewport = (source: string, viewport: SvgImageViewport): string => {
  const { width, height } = viewport
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) throw new Error('SVG 图片的未裁剪视口尺寸无效。')
  const svg = new TextDecoder().decode(Uint8Array.from(atob(source.slice(source.indexOf(',') + 1)), character => character.charCodeAt(0)))
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const inner = parsed.documentElement
  const outer = parsed.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const density = Math.min(2, 4096 / Math.max(width, height))
  outer.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  outer.setAttribute('width', String(width * density))
  outer.setAttribute('height', String(height * density))
  outer.setAttribute('viewBox', `0 0 ${width} ${height}`)
  inner.setAttribute('x', '0')
  inner.setAttribute('y', '0')
  inner.setAttribute('width', String(width))
  inner.setAttribute('height', String(height))
  // Preserve the source's viewBox and preserveAspectRatio (default meet).
  // PowerPoint may stretch the outer viewport, but its aspect now matches the
  // uncropped image object, so the inner drawing is not stretched into an oval.
  outer.appendChild(inner)
  return `data:image/svg+xml;base64,${utf8Base64(new XMLSerializer().serializeToString(outer))}`
}

const verifyPptxImage = (source: string) => new Promise<void>((resolve, reject) => {
  const image = new Image()
  const timer = setTimeout(() => {
    image.src = ''
    reject(new Error('图片预览生成超时。'))
  }, 15000)
  image.onload = () => {
    clearTimeout(timer)
    if (image.naturalWidth && image.naturalHeight) resolve()
    else reject(new Error('图片没有可渲染的尺寸。'))
  }
  image.onerror = () => {
    clearTimeout(timer)
    reject(new Error('图片无法解码或读取，无法生成 PowerPoint 兼容预览。'))
  }
  image.src = source
})

export const preparePptxImageSource = async (source: string, viewport?: SvgImageViewport): Promise<string> => {
  let normalized = source
  if (svgDataHeader.test(source)) normalized = normalizeSvgForPptx(source)
  else if (/\.svg(?:[?#]|$)/i.test(source) || source.startsWith('blob:')) {
    const response = await fetch(source, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`无法读取图片（${response.status}）。`)
    const blob = await response.blob()
    if (/svg/i.test(blob.type) || /\.svg(?:[?#]|$)/i.test(source)) normalized = normalizeSvgForPptx(await blob.text())
    else {
      normalized = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('无法读取本地图片。'))
        reader.readAsDataURL(blob)
      })
    }
  }
  if (normalized.startsWith('data:image/svg+xml;base64,')) {
    if (viewport) normalized = wrapSvgViewport(normalized, viewport)
  }
  // Validate raster sources too: an unreadable image must stop the export,
  // rather than leaving an apparently successful deck with missing pictures.
  await verifyPptxImage(normalized)
  return normalized
}
