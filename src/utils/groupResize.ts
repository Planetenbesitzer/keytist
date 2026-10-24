import type { MultiSelectRange, OperateResizeHandlers } from '@/types/edit'
import type { PPTElement, PPTElementShadow, TextInset } from '@/types/slides'

interface Point { x: number; y: number }

/** A complete group is one transformable object. An entered group member is not. */
export const isCompleteGroupSelection = (selected: PPTElement[], all: PPTElement[]) => {
  if (selected.length < 2 || !selected[0].groupId) return false
  const groupId = selected[0].groupId
  return selected.every(element => element.groupId === groupId) &&
    all.filter(element => element.groupId === groupId).length === selected.length
}

export const isGroupResizeCorner = (direction: OperateResizeHandlers) => direction.includes('-')

/** Project the pointer onto the group's diagonal; the opposite corner stays fixed. */
export const getGroupResizeTransform = (
  range: MultiSelectRange,
  direction: OperateResizeHandlers,
  deltaX: number,
  deltaY: number,
) => {
  const width = range.maxX - range.minX
  const height = range.maxY - range.minY
  const left = direction.startsWith('left')
  const top = direction.endsWith('top')
  const diagonalX = left ? -width : width
  const diagonalY = top ? -height : height
  const diagonalSquared = width * width + height * height
  const requestedScale = diagonalSquared ? 1 + (deltaX * diagonalX + deltaY * diagonalY) / diagonalSquared : 1
  return {
    anchor: { x: left ? range.maxX : range.minX, y: top ? range.maxY : range.minY },
    // Crossing the fixed corner cannot create negative sizes or reverse the group.
    scale: Number.isFinite(requestedScale) ? Math.max(0.01, requestedScale) : 1,
  }
}

const scaleLength = (value: string, scale: number, root = false) => {
  const match = /^\s*(-?(?:\d+\.?\d*|\.\d+))(px|pt|pc|in|cm|mm|q|rem|em|%)\s*$/i.exec(value)
  if (!match || (!root && /^(em|%)$/i.test(match[2]))) return value
  return `${Number((Number(match[1]) * scale).toFixed(6))}${match[2]}`
}

/** Scale absolute run sizes, and materialize the editor's implicit 16px base.
 * Relative inline runs keep inheriting from their scaled parent. A detached
 * DOMParser does not execute the rich-text source. */
export const scaleGroupText = (content: string, scale: number) => {
  if (!content || scale === 1) return content
  const body = new DOMParser().parseFromString(content, 'text/html').body
  const visit = (element: Element, root: boolean) => {
    let style = element.getAttribute('style') || ''
    const hasFontSize = /(?:^|;)\s*font-size\s*:/i.test(style)
    style = style.replace(/(^|;)\s*(font-size|letter-spacing|text-indent|line-height|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)\s*:\s*([^;]+)/gi,
      (_match, separator, property: string, value: string) => {
        const scaled = value.replace(/-?(?:\d+\.?\d*|\.\d+)(?:px|pt|pc|in|cm|mm|q|rem|em|%)/gi,
          length => scaleLength(length, scale, root && property.toLowerCase() === 'font-size'))
        return `${separator}${property}: ${scaled}`
      })
    if (root && !hasFontSize) style += `${style && !style.endsWith(';') ? ';' : ''}font-size: ${16 * scale}px;`
    if (style) element.setAttribute('style', style)
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) visit(child as Element, false)
    }
  }
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType === 1) visit(node as Element, true)
    else if (node.nodeType === 3 && node.textContent?.trim()) {
      const span = body.ownerDocument.createElement('span')
      span.setAttribute('style', `font-size: ${16 * scale}px;`)
      body.replaceChild(span, node)
      span.appendChild(node)
    }
  }
  return body.innerHTML
}

const scaleShadow = <T extends PPTElementShadow>(shadow: T, scale: number): T => ({
  ...shadow, h: shadow.h * scale, v: shadow.v * scale, blur: shadow.blur * scale,
})
const scaleInset = (inset: TextInset | undefined, scale: number): TextInset =>
  (inset || [10, 10, 10, 10]).map(value => value * scale) as TextInset

/** Apply a uniform world-space transform to an original (not previous-frame) member. */
export const resizeGroupElement = (element: PPTElement, anchor: Point, scale: number): PPTElement => {
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('组合缩放比例必须为正数。')
  if (scale === 1) return element
  const next: PPTElement = {
    ...element,
    left: anchor.x + (element.left - anchor.x) * scale,
    top: anchor.y + (element.top - anchor.y) * scale,
    width: element.width * scale,
  }
  if ('height' in next && 'height' in element) next.height = element.height * scale
  if ('outline' in next && next.outline) {
    next.outline = {
      ...next.outline,
      ...(next.outline.width === undefined ? {} : { width: next.outline.width * scale }),
    }
  }
  if ('shadow' in next && next.shadow) next.shadow = scaleShadow(next.shadow, scale)

  if (next.type === 'text' && element.type === 'text') {
    next.content = scaleGroupText(element.content, scale)
    next.inset = scaleInset(element.inset, scale)
    next.wordSpace = (element.wordSpace || 0) * scale
    next.paragraphSpace = (element.paragraphSpace ?? 5) * scale
  }
  else if (next.type === 'shape' && element.type === 'shape' && element.text) {
    next.text = {
      ...element.text,
      content: scaleGroupText(element.text.content, scale),
      inset: scaleInset(element.text.inset, scale),
      wordSpace: (element.text.wordSpace || 0) * scale,
      paragraphSpace: (element.text.paragraphSpace ?? 5) * scale,
    }
  }
  else if (next.type === 'image' && element.type === 'image') {
    if (element.radius !== undefined) next.radius = element.radius * scale
    if (element.filters?.blur) {
      next.filters = {
        ...element.filters, blur: scaleLength(element.filters.blur, scale, true),
      }
    }
  }
  else if (next.type === 'line' && element.type === 'line') {
    const point = (input: [number, number]): [number, number] => [input[0] * scale, input[1] * scale]
    next.start = point(element.start)
    next.end = point(element.end)
    if (element.broken) next.broken = point(element.broken)
    if (element.broken2) next.broken2 = point(element.broken2)
    if (element.curve) next.curve = point(element.curve)
    if (element.cubic) next.cubic = [point(element.cubic[0]), point(element.cubic[1])]
  }
  else if (next.type === 'table' && element.type === 'table') {
    next.cellMinHeight = element.cellMinHeight * scale
    if (element.rowHeights) next.rowHeights = element.rowHeights.map(height => height * scale)
    next.data = element.data.map(row => row.map(cell => ({
      ...cell, style: { ...cell.style, fontsize: scaleLength(cell.style?.fontsize || '14px', scale, true) },
    })))
  }
  // Formula SVG/path/viewBox/strokeWidth remain in their original coordinate
  // system. Chart/video/audio use the same geometry semantics as single resize.
  return next
}
