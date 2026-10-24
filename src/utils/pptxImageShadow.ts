import type { PPTImageElement } from '@/types/slides'
import { createImageShadowAsset, getImageShadowKind, type ImageShadowAsset } from '@/utils/imageShadow'

/** Position a separate picture layer under the image's flip-then-rotate matrix. */
export const getImageShadowLayerGeometry = (image: Pick<PPTImageElement, 'left' | 'top' | 'width' | 'height' | 'rotate' | 'flipH' | 'flipV'>, asset: Omit<ImageShadowAsset, 'dataUrl'>) => {
  let dx = asset.left + asset.width / 2 - image.width / 2
  let dy = asset.top + asset.height / 2 - image.height / 2
  if (image.flipH) dx = -dx
  if (image.flipV) dy = -dy
  const angle = image.rotate * Math.PI / 180
  const offsetX = dx * Math.cos(angle) - dy * Math.sin(angle)
  const offsetY = dx * Math.sin(angle) + dy * Math.cos(angle)
  return {
    left: image.left + image.width / 2 + offsetX - asset.width / 2,
    top: image.top + image.height / 2 + offsetY - asset.height / 2,
    width: asset.width,
    height: asset.height,
    rotate: image.rotate,
    flipH: !!image.flipH,
    flipV: !!image.flipV,
  }
}

const shadowPng = async (asset: ImageShadowAsset): Promise<string> => {
  if (![asset.left, asset.top, asset.width, asset.height].every(Number.isFinite) || !(asset.width > 0 && asset.height > 0)) throw new Error('阴影预览尺寸无效')
  const comma = asset.dataUrl.indexOf(',')
  const header = asset.dataUrl.slice(0, comma)
  if (comma < 0 || !/^data:image\/svg\+xml(?:;|$)/i.test(header)) throw new Error('阴影预览格式无效')
  const payload = asset.dataUrl.slice(comma + 1)
  const source = /;base64(?:;|$)/i.test(header)
    ? new TextDecoder().decode(Uint8Array.from(atob(payload), char => char.charCodeAt(0)))
    : decodeURIComponent(payload)
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  const svg = parsed.documentElement
  if (parsed.querySelector('parsererror') || svg.localName !== 'svg') throw new Error('阴影预览格式无效')
  const density = Math.min(3, 4096 / Math.max(asset.width, asset.height))
  const width = Math.max(1, Math.ceil(asset.width * density))
  const height = Math.max(1, Math.ceil(asset.height * density))
  if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${asset.width} ${asset.height}`)
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  const preview = new Image()
  preview.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      preview.decode(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('阴影预览生成超时')), 15000)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法生成阴影预览')
  context.drawImage(preview, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

/** Rasterize only the procedural shadow, leaving the source picture editable. */
export const preparePptxImageShadow = async (image: PPTImageElement) => {
  const kind = getImageShadowKind(image.shadow)
  if (kind !== 'contact' && kind !== 'curved') return null
  try {
    const asset = createImageShadowAsset(image.shadow, image.width, image.height)
    if (!asset) throw new Error('高级阴影缺少预览')
    return { ...getImageShadowLayerGeometry(image, asset), dataUrl: await shadowPng(asset) }
  }
  catch (error) {
    throw new Error(`图片 ${image.id} 的阴影无法导出：${error instanceof Error ? error.message : '无法生成预览'}`)
  }
}
