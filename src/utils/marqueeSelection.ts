import type { PPTElement } from '@/types/slides'
import { getElementRange } from '@/utils/element'

export interface MarqueeRange {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export const getMarqueeRange = (start: [number, number], end: [number, number]): MarqueeRange => ({
  minX: Math.min(start[0], end[0]),
  maxX: Math.max(start[0], end[0]),
  minY: Math.min(start[1], end[1]),
  maxY: Math.max(start[1], end[1]),
})

/** Any overlap selects an element; a group remains an indivisible selection. */
export const getMarqueeSelectedIds = (elements: PPTElement[], range: MarqueeRange, hiddenIds: readonly string[] = []): string[] => {
  if (range.maxX <= range.minX || range.maxY <= range.minY) return []
  const hidden = new Set(hiddenIds)
  const selectable = new Set(elements.filter(element => !element.lock && !hidden.has(element.id)).map(element => element.id))
  const hits = new Set(elements.filter(element => {
    if (!selectable.has(element.id)) return false
    const bounds = getElementRange(element)
    return bounds.maxX > range.minX && bounds.minX < range.maxX && bounds.maxY > range.minY && bounds.minY < range.maxY
  }).map(element => element.id))
  const groups = new Map<string, PPTElement[]>()
  for (const element of elements) {
    if (!element.groupId) continue
    const members = groups.get(element.groupId) || []
    members.push(element)
    groups.set(element.groupId, members)
  }
  const selectedGroups = new Set([...groups].filter(([, members]) => members.every(member => selectable.has(member.id)) && members.some(member => hits.has(member.id))).map(([id]) => id))
  return elements.filter(element => element.groupId ? selectedGroups.has(element.groupId) : hits.has(element.id)).map(element => element.id)
}
