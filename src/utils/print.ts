import { getEmbeddedFonts, type EmbeddedFont } from '@/utils/localFonts'
import { normalizeSvgForPptx, wrapSvgViewport } from '@/utils/pptxImage'

interface PageSize {
  width: number
  height: number
  margin: number
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!))

const cssString = (value: string) => JSON.stringify(value).replace(/</g, '\\3c ')

const createIframe = ({ width, height }: PageSize) => {
  const iframe = document.createElement('iframe')
  // A real viewport is needed for SVGs and responsive layout before printing.
  // Keep the frame rendered, rather than display:none or a zero-sized viewport.
  iframe.style.cssText = `position:absolute;left:-100000px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none;`
  iframe.title = '打印预览'
  iframe.setAttribute('aria-hidden', 'true')
  iframe.dataset.slideStudioPrint = 'true'
  return iframe
}

const printMarkup = (printNode: HTMLElement, size: PageSize, fonts: EmbeddedFont[]) => {
  const content = printNode.cloneNode(true) as HTMLElement
  content.querySelectorAll('.base-element-video, .base-element-audio').forEach(element => element.remove())
  const rules: string[] = []
  for (const sheet of document.styleSheets) {
    // Inaccessible cross-origin sheets must not prevent a local document export.
    try {
      for (const rule of sheet.cssRules) rules.push(rule.cssText)
    }
    catch { /* Local and embedded fonts are included separately below. */ }
  }
  // FontFace objects added to the editor's document.fonts are not inherited by
  // a new document. Recreate those faces from the portable document assets.
  const fontRules = fonts.map(font =>
    `@font-face{font-family:${cssString(font.family)};src:url(${cssString(font.dataUrl)});font-display:block;}`,
  ).join('\n')
  const { width, height, margin } = size
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<base href="${escapeHtml(document.baseURI)}">
<title>${escapeHtml(document.title)}</title>
<style>
${rules.join('\n')}
${fontRules}
/* Editor viewport rules must never become the print page's containing block. */
html, body {
  position: static !important;
  inset: auto !important;
  display: block !important;
  width: ${width}px !important;
  min-width: 0 !important;
  max-width: none !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
  margin: 0 !important;
  padding: 0 !important;
  transform: none !important;
  contain: none !important;
}
html, body, body * {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
body { background: transparent !important; }
.thumbnail-slide {
  display: block !important;
  position: relative !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  break-after: auto !important;
  page-break-after: auto !important;
}
.thumbnail-slide.break-page:not(:last-child) {
  break-after: page !important;
  page-break-after: always !important;
}
@page {
  size: ${width + 2 * margin}px ${height + 2 * margin}px;
  margin: ${margin}px;
}
</style></head><body>${content.innerHTML}</body></html>`
}

const withTimeout = async <T>(operation: Promise<T>, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 30000)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

const waitForImages = (doc: Document) => Promise.all(Array.from(doc.images).map(async image => {
  if (typeof image.decode === 'function') {
    try {
      await image.decode()
    }
    catch {
      throw new Error('图片载入失败，请检查文稿图片后重试')
    }
    return
  }
  if (image.complete) {
    if (!image.naturalWidth) throw new Error('图片载入失败')
    return
  }
  await new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true })
    image.addEventListener('error', () => reject(new Error('图片载入失败')), { once: true })
  })
}))

interface ImageAsset { image: HTMLImageElement; svg?: string }
interface ImageSize { width: number; height: number }

const loadAsset = async (doc: Document, source: string): Promise<ImageAsset> => {
  if (!source) throw new Error('图片填充缺少素材，无法导出')
  const image = doc.createElement('img')
  image.src = source
  try {
    await image.decode()
  }
  catch {
    throw new Error('背景或图片填充载入失败，请检查文稿素材后重试')
  }
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片素材没有有效尺寸，无法导出')
  let svg: string | undefined
  if (/^data:image\/svg\+xml(?:;|,)/i.test(source)) svg = normalizeSvgForPptx(source)
  else if (/\.svg(?:[?#]|$)/i.test(source) || source.startsWith('blob:')) {
    const response = await fetch(image.src)
    if (!response.ok) throw new Error('无法读取打印图片，请检查文稿素材后重试')
    const blob = await response.blob()
    if (/svg/i.test(blob.type) || /\.svg(?:[?#]|$)/i.test(source)) svg = normalizeSvgForPptx(await blob.text())
  }
  return { image, svg }
}

const pngPreview = async (doc: Document, markup: string, sample: ImageSize): Promise<string> => {
  const density = Math.min(2, 4096 / Math.max(sample.width, sample.height))
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = parsed.documentElement
  root.setAttribute('width', String(Math.max(1, Math.ceil(sample.width * density))))
  root.setAttribute('height', String(Math.max(1, Math.ceil(sample.height * density))))
  // Sampling density may differ along x/y for objectBoundingBox patterns.
  root.setAttribute('preserveAspectRatio', 'none')
  const preview = doc.createElement('img')
  preview.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`
  try {
    await preview.decode()
  }
  catch {
    throw new Error('无法生成背景或图片填充的打印预览')
  }
  const canvas = doc.createElement('canvas')
  canvas.width = preview.naturalWidth
  canvas.height = preview.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法准备打印图片，请重试')
  context.drawImage(preview, 0, 0)
  try {
    return canvas.toDataURL('image/png')
  }
  catch {
    throw new Error('图片素材不允许生成打印预览，请改用本地图片后重试')
  }
}

const wrappedMarkup = (svg: string, viewport: ImageSize) => {
  const source = wrapSvgViewport(svg, viewport)
  return new TextDecoder().decode(Uint8Array.from(atob(source.slice(source.indexOf(',') + 1)), char => char.charCodeAt(0)))
}

const prepareSvgImages = (doc: Document) => Promise.all(Array.from(doc.images).map(async image => {
  const asset = await loadAsset(doc, image.currentSrc || image.src)
  if (!asset.svg) return
  // Chromium's native print path can flatten SVG-image gradients. Only these
  // image assets get a bitmap preview; inline shapes, text and math stay vector.
  // Match the uncropped img viewport so SVG meet/slice letterboxing survives.
  const style = doc.defaultView!.getComputedStyle(image)
  const width = parseFloat(style.width) || image.width
  const height = parseFloat(style.height) || image.height
  image.removeAttribute('srcset')
  image.src = await pngPreview(doc, wrappedMarkup(asset.svg, { width, height }), { width, height })
  await image.decode()
}))

const cssLayers = (value: string): string[] => {
  const layers: string[] = []
  let start = 0, depth = 0, quote = ''
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '\\') {
      i++; continue
    }
    if (quote) {
      if (char === quote) quote = ''; continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && !depth) {
      layers.push(value.slice(start, i).trim()); start = i + 1
    }
  }
  layers.push(value.slice(start).trim())
  return layers
}

const backgroundTile = (size: string, box: ImageSize, image: HTMLImageElement): ImageSize => {
  const ratio = image.naturalWidth / image.naturalHeight
  if (size === 'cover' || size === 'contain') {
    const scale = Math[size === 'cover' ? 'max' : 'min'](box.width / image.naturalWidth, box.height / image.naturalHeight)
    return { width: image.naturalWidth * scale, height: image.naturalHeight * scale }
  }
  const [x = 'auto', y = 'auto'] = size.split(/\s+/)
  const dimension = (value: string, reference: number) => value === 'auto' ? 0 : parseFloat(value) * (value.endsWith('%') ? reference / 100 : 1)
  let width = dimension(x, box.width), height = dimension(y, box.height)
  width ||= height ? height * ratio : image.naturalWidth
  height ||= width / ratio
  return { width, height }
}

const prepareBackgroundImages = (doc: Document) => Promise.all(Array.from(doc.body.querySelectorAll<HTMLElement>('*')).map(async element => {
  const style = doc.defaultView!.getComputedStyle(element)
  if (!style.backgroundImage.includes('url(')) return
  const layers = cssLayers(style.backgroundImage)
  const sizes = cssLayers(style.backgroundSize)
  const rect = element.getBoundingClientRect()
  const box = { width: element.clientWidth || rect.width, height: element.clientHeight || rect.height }
  const prepared = await Promise.all(layers.map(async (layer, index) => {
    const matches = [...layer.matchAll(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/g)]
    let result = layer
    for (const match of matches) {
      const source = (match[1] ?? match[2] ?? match[3]).replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, char) => hex ? String.fromCodePoint(parseInt(hex, 16)) : char)
      const asset = await loadAsset(doc, source)
      if (!asset.svg) continue
      const tile = backgroundTile(sizes[index % sizes.length], box, asset.image)
      const sourcePng = await pngPreview(doc, wrappedMarkup(asset.svg, tile), tile)
      const preview = await loadAsset(doc, sourcePng)
      // The resolution descriptor preserves auto/repeat tile size despite a
      // higher-resolution PNG. Cover, contain, position and repeat stay intact.
      result = result.replace(match[0], `image-set(url(${cssString(sourcePng)}) ${preview.image.naturalWidth / tile.width}x)`)
    }
    return result
  }))
  element.style.backgroundImage = prepared.join(', ')
}))

const prepareSvgImageFills = (doc: Document) => Promise.all(Array.from(doc.querySelectorAll<SVGImageElement>('svg image')).map(async image => {
  const source = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || ''
  const asset = await loadAsset(doc, source)
  if (!asset.svg) return
  const width = image.width.baseVal.value, height = image.height.baseVal.value
  const samplingElement = image.closest('pattern') ? image.ownerSVGElement : image
  if (!samplingElement) throw new Error('图片填充缺少有效的图形视口')
  const bounds = samplingElement.getBoundingClientRect()
  const sample = { width: bounds.width || width, height: bounds.height || height }
  if (!(width > 0 && height > 0 && sample.width > 0 && sample.height > 0)) throw new Error('图片填充没有有效的打印视口')
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" preserveAspectRatio="${escapeHtml(image.getAttribute('preserveAspectRatio') || 'xMidYMid meet')}" href="${escapeHtml(asset.svg)}"/></svg>`
  const preview = await pngPreview(doc, markup, sample)
  await loadAsset(doc, preview)
  image.setAttribute('href', preview)
  image.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
  // Fit is already baked in the material preview, including SVG-source fit.
  // The shape's original vector path, clip and objectBoundingBox transform stay.
  image.setAttribute('preserveAspectRatio', 'none')
}))

/** Prepare one print page per slide, waiting for every portable asset. */
export const print = async (printNode: HTMLElement, size: PageSize): Promise<void> => {
  if (![size.width, size.height].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(size.margin) || size.margin < 0) {
    throw new Error('打印页面尺寸无效')
  }
  const iframe = createIframe(size)
  const fonts = getEmbeddedFonts()
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined
  const cleanup = () => {
    clearTimeout(cleanupTimer)
    iframe.remove()
  }
  try {
    // Register before starting the navigation; cached assets can load immediately.
    const loaded = new Promise<void>((resolve, reject) => {
      iframe.addEventListener('load', () => resolve(), { once: true })
      iframe.addEventListener('error', () => reject(new Error('无法准备打印页面')), { once: true })
    })
    iframe.srcdoc = printMarkup(printNode, size, fonts)
    document.body.appendChild(iframe)
    await withTimeout(loaded, '打印页面载入超时，请重试')
    const doc = iframe.contentDocument
    const target = iframe.contentWindow
    if (!doc || !target) throw new Error('无法打开打印页面')
    // Flush initial layout so fonts referenced by slide text begin loading.
    void doc.body.offsetHeight
    await withTimeout(Promise.all([
      (async () => {
        await Promise.all(fonts.map(font => doc.fonts.load(`16px ${cssString(font.family)}`)))
        await doc.fonts.ready
      })(),
      (async () => {
        await waitForImages(doc)
        await Promise.all([prepareSvgImages(doc), prepareBackgroundImages(doc), prepareSvgImageFills(doc)])
      })(),
    ]), '字体或图片载入超时，请确认文稿素材后重试')
    void doc.body.offsetHeight
    target.addEventListener('afterprint', cleanup, { once: true })
    // Fallback for browsers that do not dispatch afterprint after cancellation.
    cleanupTimer = setTimeout(cleanup, 5 * 60 * 1000)
    target.focus()
    target.print()
  }
  catch (error) {
    cleanup()
    throw error instanceof Error ? error : new Error('打印准备失败，请重试')
  }
}
