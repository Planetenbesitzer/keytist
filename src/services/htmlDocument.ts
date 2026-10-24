import { nanoid } from 'nanoid'
import type { Slide } from '@/types/slides'
import type { LocalDocument } from '@/services/localDocument'
import { HTML_MIN_SCALE, HTML_MAX_SCALE } from '@/utils/htmlPlacement'
import { unpackCompactHtml } from '@/utils/htmlCompact'

export const MAX_HTML_SOURCE_LENGTH = 25 * 1024 * 1024
const MAX_HTML_IMPORT_LENGTH = 100 * 1024 * 1024

export interface ImportHtmlOptions {
  mode: 'append' | 'replace'
  viewport?: HtmlViewport
}

export interface HtmlViewport { width: number; height: number }

export type ParsedHtmlDocument =
  | { kind: 'document'; document: unknown }
  | { kind: 'html'; title: string; slides: Slide[] }

/** Preserve the original source. Scripts are isolated at render time, not stripped. */
export const normalizeHtmlSlide = (input: unknown): Slide['html'] => {
  if (input === undefined) return undefined
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('HTML 幻灯片需要完整的 html.source。')
  const value = input as Record<string, unknown>
  if (typeof value.source !== 'string' || !value.source.trim()) throw new Error('HTML 源码不能为空。')
  if (value.source.length > MAX_HTML_SOURCE_LENGTH) throw new Error('单页 HTML 源码超过 25 MiB 字符限制，请精简内嵌资源后重试。')
  for (const key of ['width', 'height']) {
    const dimension = value[key]
    if (dimension !== undefined && (typeof dimension !== 'number' || !Number.isFinite(dimension) || dimension <= 0)) throw new Error(`HTML 网页 ${key} 必须是正数。`)
  }
  for (const key of ['left', 'top']) {
    const offset = value[key]
    if (offset !== undefined && (typeof offset !== 'number' || !Number.isFinite(offset))) throw new Error(`HTML 网页 ${key} 必须是有限数值。`)
  }
  if (value.scale !== undefined && (typeof value.scale !== 'number' || !Number.isFinite(value.scale) || value.scale < HTML_MIN_SCALE || value.scale > HTML_MAX_SCALE)) {
    throw new Error(`HTML 网页缩放比例需要在 ${HTML_MIN_SCALE} 到 ${HTML_MAX_SCALE} 之间。`)
  }
  return { ...value, source: value.source } as Slide['html']
}

export const createHtmlSlide = (source: string, viewport?: HtmlViewport): Slide => ({
  id: nanoid(10),
  elements: [],
  html: normalizeHtmlSlide({ source, ...viewport }),
})

const parseHtmlDocumentSource = (source: string, compact = false): ParsedHtmlDocument => {
  if (typeof source !== 'string' || !source.trim()) throw new Error('HTML 文件不能为空。')
  // The compact decoder has already enforced its expanded byte limit. Native
  // document metadata may legitimately expand beyond the legacy input limit.
  if (!compact && source.length > MAX_HTML_IMPORT_LENGTH) throw new Error('HTML 文件超过 100 MiB 字符限制。')
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const metadata = [...parsed.querySelectorAll('script#slide-studio-document')]
  if (metadata.length > 1) throw new Error('HTML 文稿包含重复的 slide-studio-document 数据。')
  if (metadata.length) {
    if (metadata[0].getAttribute('type')?.trim().toLowerCase() !== 'application/json') throw new Error('HTML 文稿的 slide-studio-document 必须使用 application/json。')
    try {
      return { kind: 'document', document: JSON.parse(metadata[0].textContent || '') }
    }
    catch {
      throw new Error('HTML 文稿内的 JSON 数据不完整，未导入任何页面。')
    }
  }
  if (compact && source.length > MAX_HTML_SOURCE_LENGTH) throw new Error('紧凑播放版展开后超过单页 HTML 的 25 MiB 限制。请使用原始 JSON 文稿，或重新导出时选择“保留重新导入编辑能力”。')
  return { kind: 'html', title: parsed.title.trim() || 'HTML 页面', slides: [createHtmlSlide(source)] }
}

/** Read metadata without executing HTML or guessing how a page should be split. */
export const parseHtmlDocument = (source: string): ParsedHtmlDocument => parseHtmlDocumentSource(source)

/** Restore compact exports as inert data before applying the ordinary import rules. */
export const parseHtmlDocumentAsync = async (source: string): Promise<ParsedHtmlDocument> => {
  const restored = await unpackCompactHtml(source)
  return parseHtmlDocumentSource(restored === undefined ? source : restored, restored !== undefined)
}

// The pure parser is shared with document validation and the slides store.
// Load the mutation service only on demand to avoid an initialization cycle.
export const importHtmlDocument = async (source: string, options: ImportHtmlOptions = { mode: 'append' }): Promise<LocalDocument> => {
  return (await import('@/services/localDocument')).importHtmlDocument(source, options)
}

export const updateHtmlSlideSource = async (slideId: string, source: string, viewport?: HtmlViewport): Promise<LocalDocument> => {
  return (await import('@/services/localDocument')).updateHtmlSlideSource(slideId, source, viewport)
}
