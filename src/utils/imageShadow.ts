import tinycolor from 'tinycolor2'
import type { PPTImageShadow } from '@/types/slides'

export interface ImageShadowAsset {
  dataUrl: string
  left: number
  top: number
  width: number
  height: number
}

/** Validate without adding defaults or changing an existing document's values. */
export const normalizeImageShadow = (input: unknown): PPTImageShadow | undefined => {
  if (input === undefined) return undefined
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('图片阴影必须是完整的阴影对象。')
  const shadow = input as Record<string, unknown>
  for (const key of ['h', 'v', 'blur']) {
    if (typeof shadow[key] !== 'number' || !Number.isFinite(shadow[key])) throw new Error(`图片阴影 ${key} 必须是有限数值。`)
  }
  if ((shadow.blur as number) < 0) throw new Error('图片阴影 blur 不能为负数。')
  if (typeof shadow.color !== 'string' || !shadow.color.trim() || !tinycolor(shadow.color).isValid()) throw new Error('图片阴影颜色无效。')
  if (shadow.type !== undefined && (typeof shadow.type !== 'string' || !['drop', 'contact', 'curved'].includes(shadow.type))) throw new Error('图片阴影类型必须为 drop、contact 或 curved。')
  if (shadow.perspective !== undefined && (typeof shadow.perspective !== 'number' || !Number.isFinite(shadow.perspective) || shadow.perspective < 0 || shadow.perspective > 1)) throw new Error('接触阴影 perspective 必须在 0 到 1 之间。')
  if (shadow.curve !== undefined && (typeof shadow.curve !== 'number' || !Number.isFinite(shadow.curve) || shadow.curve < -1 || shadow.curve > 1)) throw new Error('曲线阴影 curve 必须在 -1 到 1 之间。')
  return { ...shadow } as unknown as PPTImageShadow
}

export const getImageShadowKind = (shadow?: PPTImageShadow): 'drop' | 'contact' | 'curved' => shadow?.type || 'drop'

/**
 * Separate shadow geometry in the unflipped, unrotated image-frame coordinates.
 * h/v are already included. The returned frame contains four Gaussian sigmas
 * plus two pixels of padding; consumers must not clip it to the image frame.
 * The frame itself is knocked out after blur so transparent image pixels and
 * letterboxing do not expose the filled shadow geometry beneath the image.
 * Drop shadows continue to use the existing alpha-aware CSS filter.
 */
export const createImageShadowAsset = (input: PPTImageShadow | undefined, width: number, height: number): ImageShadowAsset | null => {
  const shadow = normalizeImageShadow(input)
  if (!shadow || getImageShadowKind(shadow) === 'drop') return null
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) throw new Error('图片阴影视口尺寸必须为正数。')
  const kind = getImageShadowKind(shadow)
  const color = tinycolor(shadow.color)
  const fill = `fill="${color.toHexString()}" fill-opacity="${color.getAlpha()}"`
  let geometry: string
  let minX: number, maxX: number, minY: number, maxY: number
  if (kind === 'contact') {
    // A bottom ellipse follows Apple's shadowPath construction. Perspective is
    // this editor's bounded control for the projected contact-patch thickness.
    const perspective = shadow.perspective ?? 0.35
    const size = Math.max(1, Math.min(width * 0.16, height * 0.18) * (0.35 + perspective * 1.3))
    const rx = width / 2 + size
    const ry = size / 2
    const cx = width / 2 + shadow.h
    const cy = height + shadow.v
    minX = cx - rx; maxX = cx + rx; minY = cy - ry; maxY = cy + ry
    geometry = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${fill}/>`
  }
  else {
    const curve = shadow.curve ?? 0.65
    const depth = Math.abs(curve) * Math.min(width * 0.12, height * 0.25)
    const inset = Math.min(width * 0.2, Math.max(width * 0.02, shadow.blur / 2))
    const x = shadow.h + inset, right = shadow.h + width - inset
    const bottom = shadow.v + height
    const stripTop = bottom - Math.max(depth, shadow.blur, 1)
    // This is a narrow strip at the bottom edge, not a filled image frame.
    // Positive: lower corners and a midpoint at the baseline. Negative: corners
    // at the baseline and a lower midpoint. Both boundaries stay disjoint.
    const edge = curve >= 0 ? bottom + depth : bottom
    const control = curve >= 0 ? bottom - depth : bottom + depth * 2
    minX = x; maxX = right; minY = stripTop; maxY = bottom + depth
    geometry = `<path d="M ${x} ${stripTop} H ${right} V ${edge} Q ${shadow.h + width / 2} ${control} ${x} ${edge} Z" ${fill}/>`
  }
  const padding = Math.ceil(shadow.blur * 4 + 2)
  const left = Math.floor(minX - padding), top = Math.floor(minY - padding)
  const assetWidth = Math.ceil(maxX + padding) - left
  const assetHeight = Math.ceil(maxY + padding) - top
  if (![left, top, assetWidth, assetHeight].every(Number.isFinite) || assetWidth <= 0 || assetHeight <= 0) throw new Error('图片阴影范围超出可显示的数值范围。')
  const filter = shadow.blur ? ' filter="url(#shadow-blur)"' : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${assetWidth}" height="${assetHeight}" viewBox="${left} ${top} ${assetWidth} ${assetHeight}"><defs><filter id="shadow-blur" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="${left}" y="${top}" width="${assetWidth}" height="${assetHeight}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${shadow.blur}"/></filter><mask id="shadow-frame-knockout" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${left}" y="${top}" width="${assetWidth}" height="${assetHeight}" mask-type="luminance"><rect x="${left}" y="${top}" width="${assetWidth}" height="${assetHeight}" fill="white"/><rect x="0" y="0" width="${width}" height="${height}" fill="black"/></mask></defs><g mask="url(#shadow-frame-knockout)"><g${filter}>${geometry}</g></g></svg>`
  return { dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, left, top, width: assetWidth, height: assetHeight }
}
