import { HTML_MIN_SCALE, HTML_MAX_SCALE, type HtmlPlacement } from './htmlPlacement'

export type HtmlResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

const validPlacement = (origin: HtmlPlacement) =>
  [origin.left, origin.top, origin.scale].every(Number.isFinite) &&
  origin.scale >= HTML_MIN_SCALE && origin.scale <= HTML_MAX_SCALE

/** Pointer deltas are in slide coordinates, independent of the canvas zoom. */
export const moveHtmlPlacement = (origin: HtmlPlacement, dx: number, dy: number): HtmlPlacement => {
  if (!validPlacement(origin) || !Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return { ...origin }
  const left = origin.left + dx
  const top = origin.top + dy
  return Number.isFinite(left) && Number.isFinite(top) ? { left, top, scale: origin.scale } : { ...origin }
}

/** Project onto the frame diagonal while fixing the opposite corner. */
export const resizeHtmlPlacement = (
  origin: HtmlPlacement,
  corner: HtmlResizeCorner,
  dx: number,
  dy: number,
  width: number,
  height: number,
): HtmlPlacement => {
  if (!validPlacement(origin) || ![dx, dy, width, height].every(Number.isFinite) || width <= 0 || height <= 0 ||
    !['nw', 'ne', 'sw', 'se'].includes(corner) || (!dx && !dy)) return { ...origin }

  const west = corner[1] === 'w'
  const north = corner[0] === 'n'
  const frameWidth = width * origin.scale
  const frameHeight = height * origin.scale
  const diagonal = Math.hypot(frameWidth, frameHeight)
  if (!Number.isFinite(diagonal) || diagonal <= 0) return { ...origin }

  const vx = west ? -frameWidth : frameWidth
  const vy = north ? -frameHeight : frameHeight
  // The normalized form avoids squaring large frame dimensions.
  const factor = 1 + (dx * (vx / diagonal) + dy * (vy / diagonal)) / diagonal
  if (!Number.isFinite(factor)) return { ...origin }
  const scale = Math.max(HTML_MIN_SCALE, Math.min(HTML_MAX_SCALE, origin.scale * factor))
  if (scale === origin.scale) return { ...origin }

  const anchorX = west ? origin.left + frameWidth : origin.left
  const anchorY = north ? origin.top + frameHeight : origin.top
  const left = west ? anchorX - width * scale : anchorX
  const top = north ? anchorY - height * scale : anchorY
  return Number.isFinite(left) && Number.isFinite(top) ? { left, top, scale } : { ...origin }
}
