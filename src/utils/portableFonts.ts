/** Offline font preparation. Font files are copied losslessly; a TTC is split
 * into the faces actually used and SFNT tables are wrapped in compressed WOFF.
 * No glyphs, metrics, shaping tables, or embedding permissions are rewritten. */
import { decodeWoff2Font } from './portableFontBinary'

export type UnicodeRange = [number, number]

export interface PortableFontUsage {
  family: string
  text: string
  weight?: number | string
  style?: string
  scope?: string
}

export interface PortableFontFaceSource {
  family: string
  families?: string[]
  /** Sandboxed pages can define unrelated fonts under the same CSS family. */
  scope?: string
  /** Keep explicitly declared iframe fonts for JS-generated text as well. */
  preserve?: boolean
  url: string
  weight?: number | string
  style?: string
  faceIndex?: number
  coverage?: UnicodeRange[]
  unicodeRange?: string
  fsType?: number
  postscriptName?: string
  variable?: { axes: { tag: string; min: number; default: number; max: number }[] }
}

export interface LocalFontCatalog {
  version: number
  faces?: PortableFontFaceSource[]
  files?: {
    url: string
    faces: {
      family: string
      families?: string[]
      postscriptName?: string
      weight?: number | string
      style?: string
      faceIndex?: number
      fsType?: number | null
      coverage?: { ranges: UnicodeRange[]; complete: boolean }
      variable?: PortableFontFaceSource['variable']
    }[]
  }[]
  aliases?: Record<string, string>
  defaultFallbacks?: string[] | { sans?: string[]; serif?: string[]; mono?: string[] }
}

export interface PortableFontFaceReport {
  scope: string
  family: string
  sourceFamily: string
  weight: number | string
  style: string
  bytes: number
  encodedBytes: number
}

export interface PortableFontReport {
  coveragePolicy: 'latin-and-math'
  /** Number of distinct CJK code points intentionally left to device fonts. */
  excludedCjkCharacters: number
  faces: PortableFontFaceReport[]
  totalBytes: number
  encodedBytes: number
  warnings: string[]
}

export interface PortableFontResult {
  css: string
  cssByScope: Record<string, string>
  report: PortableFontReport
  usages: PortableFontUsage[]
  familyAliases: Record<string, string>
  familyAliasesByScope: Record<string, Record<string, string>>
}

export interface PortableFontOptions {
  editable?: boolean
  /** Extra runs discovered in sandboxed HTML without executing its scripts. */
  usages?: PortableFontUsage[]
  sources?: PortableFontFaceSource[]
  catalog?: LocalFontCatalog
  catalogUrl?: string
  fetcher?: typeof fetch
  /** Warn, but retain every required font. Defaults: 5 MiB/face, 10 MiB total. */
  warningFaceBytes?: number
  warningTotalBytes?: number
}

interface FontTable { tag: string; data: Uint8Array; checksum: number }
interface Sfnt { flavor: number; tables: FontTable[] }
interface PreparedFace { bytes: Uint8Array; dataUrl: string; coverage: UnicodeRange[]; fsType: number; format: string; excludedCjk?: boolean }

const quote = (value: string) => JSON.stringify(value).replace(/</g, '\\3c ')
const unescapeCssToken = (value: string) => value.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, char) => hex ? String.fromCodePoint(parseInt(hex, 16)) : char)
const align4 = (value: number) => (value + 3) & ~3
const tagAt = (data: Uint8Array, offset: number) => String.fromCharCode(...data.subarray(offset, offset + 4))
const requireBytes = (data: Uint8Array, offset: number, count: number) => {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(count) || offset < 0 || count < 0 || offset + count > data.byteLength) throw new Error('字体文件损坏或格式不受支持，请重新导入字体文件。')
}
const dataView = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength)

export const normalizeFontFamily = (value: string) => unescapeCssToken(value.trim().replace(/^(['"])([\s\S]*)\1$/, '$2')).toLocaleLowerCase('en-US')

/** Quoted commas and CSS escape sequences are valid inside a family name. */
export const parseFontFamilies = (value: string): string[] => {
  const result: string[] = []
  let buffer = '', quoteChar = '', escaped = false
  for (const char of value) {
    if (escaped) {
      buffer += char; escaped = false; continue
    }
    if (char === '\\') {
      buffer += char; escaped = true; continue
    }
    if (quoteChar) {
      buffer += char; if (char === quoteChar) quoteChar = ''; continue
    }
    if (char === '"' || char === "'") {
      quoteChar = char; buffer += char; continue
    }
    if (char === ',') {
      if (buffer.trim()) result.push(unescapeCssToken(buffer.trim().replace(/^(['"])([\s\S]*)\1$/, '$2'))); buffer = ''; continue
    }
    buffer += char
  }
  if (buffer.trim()) result.push(unescapeCssToken(buffer.trim().replace(/^(['"])([\s\S]*)\1$/, '$2')))
  return result
}

/** Generic CSS keywords cannot be replaced by an @font-face of the same name.
 * Exported CSS declarations must use the explicit private aliases instead. */
export const replacePortableFontFamilies = (value: string, aliases: Record<string, string>): string => parseFontFamilies(value).map(family => {
  const replacement = aliases[normalizeFontFamily(family)]
  return replacement ? quote(replacement) : /^[-a-z]+$/i.test(family) ? family : quote(family)
}).join(', ')

export const mergeUnicodeRanges = (ranges: UnicodeRange[]): UnicodeRange[] => {
  const sorted = ranges.filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end <= 0x10FFFF).map(([a, b]) => [a, b] as UnicodeRange).sort((a, b) => a[0] - b[0])
  const result: UnicodeRange[] = []
  for (const range of sorted) {
    const last = result[result.length - 1]
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1])
    else result.push(range)
  }
  return result
}

export const hasFontCodePoint = (ranges: UnicodeRange[], value: number): boolean => {
  let low = 0, high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1, range = ranges[middle]
    if (value < range[0]) high = middle - 1
    else if (value > range[1]) low = middle + 1
    else return true
  }
  return false
}

const hanRanges: UnicodeRange[] = [[0x3400, 0x4DBF], [0x4E00, 0x9FFF], [0xF900, 0xFAFF], [0x20000, 0x2FA1F], [0x30000, 0x33FFF]]
const kanaRanges: UnicodeRange[] = [[0x3040, 0x30FF], [0x31F0, 0x31FF], [0x1AFF0, 0x1B16F], [0xFF65, 0xFF9F]]
const hangulRanges: UnicodeRange[] = [[0x1100, 0x11FF], [0x3130, 0x318F], [0xA960, 0xA97F], [0xAC00, 0xD7FF], [0xFFA0, 0xFFDC]]
const excludedCjkRanges = [...hanRanges, ...kanaRanges, ...hangulRanges, [0x2E80, 0x303F], [0x3100, 0x312F], [0x3190, 0x31EF], [0x3200, 0x33FF], [0xFE10, 0xFE1F], [0xFE30, 0xFE6F], [0xFF00, 0xFF64], [0xFFE0, 0xFFEE], [0x1F200, 0x1F2FF]] as UnicodeRange[]

/** CJK text is retained in the HTML, without triggering a large fallback font. */
export const isExcludedCjkCodePoint = (value: number): boolean => excludedCjkRanges.some(([start, end]) => value >= start && value <= end)

const coveredCount = (coverage: UnicodeRange[], target: UnicodeRange[]) => coverage.reduce((sum, [start, end]) => sum + target.reduce((count, [left, right]) => count + Math.max(0, Math.min(end, right) - Math.max(start, left) + 1), 0), 0)

/** Classify actual cmap coverage, never a name: a Latin-only font may use a
 * CJK-looking family name, and a renamed large CJK font must still be skipped. */
export const isCjkFontSource = (source: Pick<PortableFontFaceSource, 'family' | 'families' | 'coverage'>): boolean => {
  const coverage = source.coverage || []
  return coveredCount(coverage, hanRanges) >= 256 || coveredCount(coverage, kanaRanges) >= 128 || coveredCount(coverage, hangulRanges) >= 512
}

const subtractRanges = (source: UnicodeRange[], excluded: UnicodeRange[]): UnicodeRange[] => {
  const result: UnicodeRange[] = []
  for (const [start, end] of source) {
    let cursor = start
    for (const [left, right] of excluded) {
      if (right < cursor) continue
      if (left > end) break
      if (left > cursor) result.push([cursor, Math.min(end, left - 1)])
      cursor = Math.max(cursor, right + 1)
      if (cursor > end) break
    }
    if (cursor <= end) result.push([cursor, end])
  }
  return result
}

const intersectRanges = (source: UnicodeRange[], limits: UnicodeRange[]): UnicodeRange[] => {
  const result: UnicodeRange[] = []
  for (const [start, end] of source) {
    for (const [left, right] of limits) {
      if (left > end) break
      if (right >= start) result.push([Math.max(start, left), Math.min(end, right)])
    }
  }
  return mergeUnicodeRanges(result)
}

export const parseCssUnicodeRange = (value: string): UnicodeRange[] => mergeUnicodeRanges(value.split(',').map(item => {
  const match = item.trim().match(/^U\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i)
  if (!match) return [-1, -1] as UnicodeRange
  return [parseInt(match[1].replace(/\?/g, '0'), 16), parseInt((match[2] || match[1]).replace(/\?/g, 'f'), 16)] as UnicodeRange
}))

const readSfnt = (data: Uint8Array, faceIndex = 0): Sfnt => {
  requireBytes(data, 0, 12)
  const view = dataView(data)
  let offset = 0
  if (tagAt(data, 0) === 'ttcf') {
    const count = view.getUint32(8)
    if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= count || count > 10000) throw new Error('字体集合中的字体索引无效。')
    requireBytes(data, 12, count * 4)
    offset = view.getUint32(12 + faceIndex * 4)
  }
  else if (faceIndex !== 0) throw new Error('此字体文件不包含请求的字体样式。')
  requireBytes(data, offset, 12)
  const flavor = view.getUint32(offset)
  if (![0x00010000, 0x4F54544F, 0x74727565].includes(flavor)) throw new Error('仅支持 TrueType、OpenType、WOFF 和 WOFF2 字体。')
  const count = view.getUint16(offset + 4)
  if (!count || count > 4096) throw new Error('字体目录无效。')
  requireBytes(data, offset + 12, count * 16)
  const tables: FontTable[] = [], names = new Set<string>()
  for (let i = 0; i < count; i++) {
    const at = offset + 12 + i * 16, tag = tagAt(data, at), start = view.getUint32(at + 8), length = view.getUint32(at + 12)
    if (names.has(tag)) throw new Error('字体目录包含重复表。')
    names.add(tag)
    requireBytes(data, start, length)
    tables.push({ tag, data: data.slice(start, start + length), checksum: view.getUint32(at + 4) })
  }
  return { flavor: flavor === 0x74727565 ? 0x00010000 : flavor, tables: tables.sort((a, b) => a.tag < b.tag ? -1 : 1) }
}

const checksum = (data: Uint8Array) => {
  let result = 0
  for (let i = 0; i < data.byteLength; i += 4) result = (result + (((data[i] || 0) * 0x1000000) + ((data[i + 1] || 0) << 16) + ((data[i + 2] || 0) << 8) + (data[i + 3] || 0))) >>> 0
  return result
}

/** Build a standalone SFNT and recompute head.checkSumAdjustment after a TTC split. */
export const extractSfntFace = (data: Uint8Array, faceIndex = 0): Uint8Array => {
  const parsed = readSfnt(data, faceIndex)
  // A collection signature cannot remain valid after extracting one face.
  // DSIG has no glyph/metric/shaping effect and is omitted from rebuilt fonts.
  const sfnt = { ...parsed, tables: parsed.tables.filter(table => table.tag !== 'DSIG') }, count = sfnt.tables.length
  const size = 12 + 16 * count + sfnt.tables.reduce((sum, table) => sum + align4(table.data.length), 0)
  const result = new Uint8Array(size), view = dataView(result)
  view.setUint32(0, sfnt.flavor); view.setUint16(4, count)
  const power = 2 ** Math.floor(Math.log2(count))
  view.setUint16(6, power * 16); view.setUint16(8, Math.log2(power)); view.setUint16(10, count * 16 - power * 16)
  let offset = 12 + 16 * count, headOffset = 0
  for (const [index, table] of sfnt.tables.entries()) {
    const at = 12 + index * 16
    result.set(Array.from(table.tag).map(char => char.charCodeAt(0)), at)
    result.set(table.data, offset)
    if (table.tag === 'head') {
      requireBytes(table.data, 0, 12); headOffset = offset; view.setUint32(offset + 8, 0)
    }
    view.setUint32(at + 4, checksum(result.subarray(offset, offset + table.data.length)))
    view.setUint32(at + 8, offset); view.setUint32(at + 12, table.data.length)
    offset += align4(table.data.length)
  }
  if (headOffset) view.setUint32(headOffset + 8, (0xB1B0AFBA - checksum(result)) >>> 0)
  return result
}

/** Restricted-license / bitmap-only embedding must never be silently overridden.
 * No-subsetting is allowed: this exporter always retains the complete face. */
export const assertFontEmbeddingAllowed = (fsType: number, family = '此字体', editable = false) => {
  if ((fsType & 0x0002) || (fsType & 0x0200)) throw new Error(`字体“${family}”标记为${fsType & 0x0002 ? '禁止嵌入' : '只允许嵌入位图'}，无法制作离线 HTML。请改用允许嵌入的字体，或导入有授权的字体文件。`)
  if (editable && (fsType & 0x0004) && !(fsType & 0x0008)) throw new Error(`字体“${family}”仅允许预览或打印嵌入。请关闭“保留可编辑文稿”来发布，或改用允许编辑嵌入的字体。`)
}

export const readFontEmbeddingType = (data: Uint8Array, faceIndex = 0): number => {
  const table = readSfnt(data, faceIndex).tables.find(table => table.tag === 'OS/2')
  if (!table) return 0
  requireBytes(table.data, 0, 10)
  return dataView(table.data).getUint16(8)
}

/** Read actual nonzero glyph mappings; Unicode block bits are not coverage. */
export const readFontCoverage = (data: Uint8Array, faceIndex = 0): UnicodeRange[] => {
  const table = readSfnt(data, faceIndex).tables.find(table => table.tag === 'cmap')
  if (!table) throw new Error('字体缺少 Unicode 字符映射表。')
  const cmap = table.data, view = dataView(cmap), ranges: UnicodeRange[] = []
  requireBytes(cmap, 0, 4)
  const count = view.getUint16(2)
  requireBytes(cmap, 4, count * 8)
  const seen = new Set<number>()
  for (let index = 0; index < count; index++) {
    const at = 4 + index * 8, platform = view.getUint16(at), encoding = view.getUint16(at + 2), offset = view.getUint32(at + 4)
    if (!(platform === 0 || (platform === 3 && [1, 10].includes(encoding))) || seen.has(offset)) continue
    seen.add(offset); requireBytes(cmap, offset, 2)
    const format = view.getUint16(offset)
    if (format === 12 || format === 13) {
      requireBytes(cmap, offset, 16)
      const length = view.getUint32(offset + 4), groups = view.getUint32(offset + 12)
      requireBytes(cmap, offset, length)
      if (groups > 0x110000 || 16 + groups * 12 > length) throw new Error('字体 Unicode 映射损坏。')
      for (let group = 0; group < groups; group++) {
        const position = offset + 16 + group * 12, start = view.getUint32(position), end = view.getUint32(position + 4), glyph = view.getUint32(position + 8)
        if (start > end || end > 0x10FFFF) throw new Error('字体 Unicode 映射范围无效。')
        if (format === 13) {
          if (glyph) ranges.push([start, end])
        }
        else if (glyph) ranges.push([start, end])
        else if (start < end) ranges.push([start + 1, end])
      }
    }
    else if (format === 4) {
      requireBytes(cmap, offset, 14)
      const length = view.getUint16(offset + 2), segments = view.getUint16(offset + 6) / 2
      requireBytes(cmap, offset, length)
      if (!Number.isInteger(segments) || 16 + segments * 8 > length) throw new Error('字体 Unicode 映射损坏。')
      const endAt = offset + 14, startAt = endAt + segments * 2 + 2, deltaAt = startAt + segments * 2, rangeAt = deltaAt + segments * 2
      for (let segment = 0; segment < segments; segment++) {
        const start = view.getUint16(startAt + segment * 2), end = view.getUint16(endAt + segment * 2), delta = view.getInt16(deltaAt + segment * 2), range = view.getUint16(rangeAt + segment * 2)
        if (start > end) throw new Error('字体 Unicode 映射范围无效。')
        for (let cp = start; cp <= Math.min(end, 0xFFFE); cp++) {
          let glyph = (cp + delta) & 0xFFFF
          if (range) {
            const glyphAt = rangeAt + segment * 2 + range + (cp - start) * 2
            if (glyphAt + 2 > offset + length) throw new Error('字体 Unicode 映射损坏。')
            glyph = view.getUint16(glyphAt)
            if (glyph) glyph = (glyph + delta) & 0xFFFF
          }
          if (glyph) ranges.push([cp, cp])
        }
      }
    }
  }
  const merged = mergeUnicodeRanges(ranges)
  if (!merged.length) throw new Error('字体不含可识别的 Unicode 字符映射，无法核验离线显示。')
  return merged
}

const transformBytes = async (bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer())

/** WOFF 1.0 uses zlib/deflate independently per table. Original SFNT checksums,
 * including the corrected head adjustment, are retained (W3C WOFF §5). */
export const sfntToWoff = async (data: Uint8Array): Promise<Uint8Array> => {
  const sfnt = readSfnt(data), count = sfnt.tables.length
  const tables = await Promise.all(sfnt.tables.map(async table => {
    if (typeof CompressionStream === 'undefined') return { ...table, packed: table.data }
    const packed = await transformBytes(table.data, new CompressionStream('deflate'))
    return { ...table, packed: packed.length < table.data.length ? packed : table.data }
  }))
  const size = 44 + 20 * count + tables.reduce((sum, table) => sum + align4(table.packed.length), 0)
  const result = new Uint8Array(size), view = dataView(result)
  view.setUint32(0, 0x774F4646); view.setUint32(4, sfnt.flavor); view.setUint32(8, size); view.setUint16(12, count)
  view.setUint32(16, 12 + 16 * count + tables.reduce((sum, table) => sum + align4(table.data.length), 0)); view.setUint16(20, 1)
  let offset = 44 + 20 * count
  tables.forEach((table, index) => {
    const at = 44 + index * 20
    result.set(Array.from(table.tag).map(char => char.charCodeAt(0)), at)
    view.setUint32(at + 4, offset); view.setUint32(at + 8, table.packed.length); view.setUint32(at + 12, table.data.length); view.setUint32(at + 16, table.checksum)
    result.set(table.packed, offset); offset += align4(table.packed.length)
  })
  return result
}

const readWoffTables = async (bytes: Uint8Array): Promise<Sfnt> => {
  requireBytes(bytes, 0, 44)
  const view = dataView(bytes), count = view.getUint16(12)
  requireBytes(bytes, 44, count * 20)
  const tables = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const at = 44 + index * 20, offset = view.getUint32(at + 4), packedLength = view.getUint32(at + 8), length = view.getUint32(at + 12)
    requireBytes(bytes, offset, packedLength)
    if (packedLength > length || length > 128 * 1024 * 1024) throw new Error('WOFF 字体目录无效。')
    let data = bytes.slice(offset, offset + packedLength)
    if (packedLength < length) {
      if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持字体解压，请升级浏览器后导出。')
      data = await transformBytes(data, new DecompressionStream('deflate'))
    }
    if (data.length !== length) throw new Error('WOFF 字体解压校验失败。')
    return { tag: tagAt(bytes, at), data, checksum: view.getUint32(at + 16) }
  }))
  return { flavor: view.getUint32(4), tables }
}

const sfntFromTables = (sfnt: Sfnt) => {
  const count = sfnt.tables.length, result = new Uint8Array(12 + 16 * count + sfnt.tables.reduce((sum, table) => sum + align4(table.data.length), 0)), view = dataView(result)
  view.setUint32(0, sfnt.flavor); view.setUint16(4, count)
  let offset = 12 + 16 * count
  sfnt.tables.forEach((table, index) => {
    const at = 12 + index * 16
    result.set(Array.from(table.tag).map(char => char.charCodeAt(0)), at); view.setUint32(at + 4, table.checksum); view.setUint32(at + 8, offset); view.setUint32(at + 12, table.data.length)
    result.set(table.data, offset); offset += align4(table.data.length)
  })
  return result
}

const toDataUrl = (bytes: Uint8Array, mime: string) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return `data:${mime};base64,${btoa(binary)}`
}

export const collectNativeFontUsages = (roots: HTMLElement[]): PortableFontUsage[] => {
  const usages: PortableFontUsage[] = []
  const nonRendering = '[data-auto-page-number-hidden],.html-slide,script,style,iframe,canvas,.katex-mathml,mjx-assistive-mml,annotation,defs,title,desc,metadata'
  const append = (element: Element, text: string, pseudo?: string) => {
    if (!text || !text.trim()) return
    // Hidden accessibility/MathML copies do not contribute visible glyphs.
    if (typeof element.getClientRects === 'function' && !element.getClientRects().length) return
    const computed = getComputedStyle(element, pseudo)
    if (computed.display === 'none' || computed.visibility === 'hidden' || Number(computed.fontSize.replace('px', '')) === 0) return
    usages.push({ family: computed.fontFamily, weight: computed.fontWeight, style: computed.fontStyle, text, scope: 'native' })
  }
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const element = node.parentElement
      if (!element || element.closest(nonRendering)) continue
      append(element, node.textContent || '')
    }
    for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
      if (element.closest(nonRendering)) continue
      for (const pseudo of ['::before', '::after']) {
        const content = getComputedStyle(element, pseudo).content
        if (content && !['none', 'normal'].includes(content) && /^(['"])[\s\S]*\1$/.test(content)) append(element, content.slice(1, -1), pseudo)
      }
      if (element.localName === 'li') {
        const marker = getComputedStyle(element, '::marker'), type = getComputedStyle(element).listStyleType
        const content = marker.content
        if (content && !['none', 'normal'].includes(content)) append(element, content.replace(/^(['"])([\s\S]*)\1$/, '$2'), '::marker')
        else if (type && type !== 'none') {
          const markerText: Record<string, string> = { disc: '•', circle: '◦', square: '▪', 'lower-alpha': 'abcdefghijklmnopqrstuvwxyz.', 'lower-latin': 'abcdefghijklmnopqrstuvwxyz.', 'upper-alpha': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.', 'upper-latin': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.', 'lower-roman': 'ivxlcdm.', 'upper-roman': 'IVXLCDM.' }
          append(element, markerText[type] || '0123456789.', '::marker')
        }
      }
    }
  }
  return usages
}

export const collectStylesheetFontFaces = (sheets: StyleSheetList | CSSStyleSheet[]): PortableFontFaceSource[] => {
  const sources: PortableFontFaceSource[] = []
  const read = (rules: CSSRuleList, base: string) => {
    for (const rule of Array.from(rules)) {
      if (rule.type === 5) {
        const style = (rule as CSSFontFaceRule).style, family = parseFontFamilies(style.fontFamily)[0]
        const match = style.getPropertyValue('src').match(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/i)
        if (family && match) sources.push({ family, url: new URL(unescapeCssToken((match[1] ?? match[2] ?? match[3]).trim()), base).href, weight: style.fontWeight || 400, style: style.fontStyle || 'normal', unicodeRange: style.getPropertyValue('unicode-range') || undefined })
      }
      else if ('cssRules' in rule) read((rule as CSSGroupingRule).cssRules, base)
    }
  }
  for (const sheet of Array.from(sheets)) {
    try {
      read((sheet as CSSStyleSheet).cssRules, sheet.href || (sheet as CSSStyleSheet).ownerNode?.ownerDocument?.baseURI || document.baseURI)
    }
    catch { /* Cross-origin face sources are supplied by the HTML/CSS bundler. */ }
  }
  return sources
}

const numericWeight = (weight: number | string = 400) => weight === 'bold' ? 700 : weight === 'normal' ? 400 : Number.parseFloat(String(weight)) || 400
const styleName = (style = 'normal') => /italic|oblique/i.test(style) ? 'italic' : 'normal'
const ignoredCodePoint = (cp: number) => cp < 0x20 || (cp >= 0x7F && cp <= 0x9F) || cp === 0x200B || cp === 0x200C || cp === 0x200D || cp === 0xFEFF || (cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0xE0100 && cp <= 0xE01EF)

const matchingFontFaces = (sources: PortableFontFaceSource[], family: string, weight: number | string = 400, style = 'normal'): PortableFontFaceSource[] => {
  const candidates = sources.filter(face => [face.family, ...(face.families || [])].some(name => normalizeFontFamily(name) === normalizeFontFamily(family)))
  const desiredWeight = numericWeight(weight), desiredStyle = styleName(style)
  const ranked = candidates.map((face, index) => {
    const range = String(face.weight ?? 400).trim().split(/\s+/).map(Number), low = range[0] || 400, high = range[1] || low
    const difference = desiredWeight < low ? low - desiredWeight : desiredWeight > high ? desiredWeight - high : 0
    // Source precedence is intentional: document-imported faces precede CSS and catalog.
    return { face, rank: (styleName(face.style) === desiredStyle ? 0 : 10000) + difference, index }
  }).sort((a, b) => a.rank - b.rank || a.index - b.index)
  return ranked.filter(candidate => candidate.rank === ranked[0]?.rank).map(candidate => candidate.face)
}

export const findMatchingFontFace = (sources: PortableFontFaceSource[], family: string, weight: number | string = 400, style = 'normal'): PortableFontFaceSource | undefined => matchingFontFaces(sources, family, weight, style)[0]

const memorySize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export const preparePortableFonts = async (input: { embeddedFonts?: { family: string; dataUrl: string }[] }, roots: HTMLElement[], options: PortableFontOptions = {}): Promise<PortableFontResult> => {
  const fetcher = options.fetcher || fetch
  let catalog = options.catalog
  if (!catalog) {
    try {
      const response = await fetcher(options.catalogUrl || '/local-fonts/catalog.json', { signal: AbortSignal.timeout(20000) })
      if (response.ok) catalog = await response.json() as LocalFontCatalog
    }
    catch { /* A clear missing-font error below names the affected family. */ }
  }
  const usages = [...(typeof document === 'undefined' ? [] : collectNativeFontUsages(roots)), ...(options.usages || [])]
  const cssSources = typeof document === 'undefined' ? [] : collectStylesheetFontFaces(document.styleSheets)
  const catalogSources: PortableFontFaceSource[] = [...(catalog?.faces || []), ...(catalog?.files || []).flatMap(file => file.faces.map(face => {
    const weightAxis = face.variable?.axes.find(axis => axis.tag === 'wght')
    return { ...face, url: file.url, weight: weightAxis ? `${weightAxis.min} ${weightAxis.max}` : face.weight, fsType: face.fsType ?? undefined, coverage: face.coverage?.complete ? face.coverage.ranges : undefined }
  }))]
  const sources: PortableFontFaceSource[] = [...(input.embeddedFonts || []).map(font => ({ family: font.family, url: font.dataUrl })), ...(options.sources || []), ...cssSources, ...catalogSources]
  // Attach known metadata to compressed bundled sources without changing source precedence.
  for (const source of sources) {
    const known = catalogSources.find(face => (face.faceIndex || 0) === (source.faceIndex || 0) && (face.url === source.url || (face.url.split('/').pop() === source.url.split('/').pop() && normalizeFontFamily(face.family) === normalizeFontFamily(source.family))))
    if (known) {
      source.coverage ??= known.coverage; source.fsType ??= known.fsType
    }
    if (source.coverage) source.coverage = mergeUnicodeRanges(source.coverage)
  }
  const aliases = new Map(Object.entries(catalog?.aliases || {}).map(([key, value]) => [normalizeFontFamily(key), value]))
  const systemFamily = ['.SF NS', 'Segoe UI', 'Noto Sans', 'Arial', 'Helvetica Neue'].find(family => findMatchingFontFace(sources, family)) || 'Helvetica Neue'
  const defaults: Record<string, string> = { 'sans-serif': 'Arial', serif: 'Times New Roman', monospace: 'Menlo', cursive: 'Apple Chancery', 'system-ui': systemFamily, '-apple-system': systemFamily, blinkmacsystemfont: systemFamily }
  const familyAliases: Record<string, string> = Object.fromEntries(Object.keys(defaults).map(family => [family, `SlideStudioPortable-${family.replace(/[^a-z0-9]/g, '-')}`]))
  const familyName = (value: string) => aliases.get(normalizeFontFamily(value)) || defaults[normalizeFontFamily(value)] || value
  const prepared = new Map<string, Promise<PreparedFace>>()
  const downloads = new Map<string, Promise<Uint8Array>>()
  const uniqueResources = new Map<string, { bytes: number; encodedBytes: number }>()
  const faceKey = (source: PortableFontFaceSource) => `${source.url}#face=${source.faceIndex || 0}`
  const prepare = (source: PortableFontFaceSource): Promise<PreparedFace> => {
    const key = faceKey(source), previous = prepared.get(key)
    if (previous) return previous
    const pending = (async () => {
      if (!downloads.has(source.url)) {
        downloads.set(source.url, (async () => {
          let response: Response
          try {
            response = await fetcher(source.url, { signal: AbortSignal.timeout(60000) })
          }
          catch {
            throw new Error(`无法读取字体“${source.family}”。请在本机重新启动 Slide Studio，或导入对应字体文件后重试。`)
          }
          if (!response.ok) throw new Error(`字体“${source.family}”读取失败（${response.status}）。请导入字体文件或重新启动本地入口。`)
          return new Uint8Array(await response.arrayBuffer())
        })())
      }
      const original = await downloads.get(source.url)!
      requireBytes(original, 0, 4)
      const signature = tagAt(original, 0)
      let bytes: Uint8Array, coverage: UnicodeRange[], fsType: number, format: string
      if (signature === 'wOF2') {
        if (source.coverage?.length && source.fsType !== undefined) {
          coverage = mergeUnicodeRanges(source.coverage); fsType = source.fsType
        }
        else {
          const expanded = new Uint8Array(await decodeWoff2Font(original))
          coverage = readFontCoverage(expanded); fsType = readFontEmbeddingType(expanded)
        }
        bytes = original; format = 'woff2'
      }
      else if (signature === 'wOFF') {
        const expanded = sfntFromTables(await readWoffTables(original))
        bytes = original; coverage = readFontCoverage(expanded); fsType = readFontEmbeddingType(expanded); format = 'woff'
      }
      else {
        const extracted = extractSfntFace(original, source.faceIndex || 0)
        coverage = readFontCoverage(extracted); fsType = readFontEmbeddingType(extracted)
        if (isCjkFontSource({ ...source, coverage })) return { bytes: new Uint8Array(), dataUrl: '', coverage, fsType, format: 'woff', excludedCjk: true }
        assertFontEmbeddingAllowed(fsType, source.family, options.editable)
        bytes = await sfntToWoff(extracted); format = 'woff'
      }
      if (isCjkFontSource({ ...source, coverage })) return { bytes: new Uint8Array(), dataUrl: '', coverage, fsType, format, excludedCjk: true }
      assertFontEmbeddingAllowed(fsType, source.family, options.editable)
      if (typeof FontFace !== 'undefined') {
        try {
          // Validate in an isolated FontFace, without adding it to the editor's
          // FontFaceSet or altering the user's current document styling.
          await new FontFace('SlideStudioExportValidation', bytes).load()
        }
        catch {
          throw new Error(`浏览器无法载入打包后的字体“${source.family}”。请重新导入有效字体，避免导出后发生静默替换。`)
        }
      }
      const dataUrl = toDataUrl(bytes, `font/${format}`)
      uniqueResources.set(dataUrl, { bytes: bytes.length, encodedBytes: dataUrl.length })
      return { bytes, dataUrl, coverage, fsType, format }
    })()
    prepared.set(key, pending)
    return pending
  }
  const rules = new Map<string, { scope: string; alias: string; source: PortableFontFaceSource; prepared: PreparedFace; range: UnicodeRange[]; weight: number | string; style: string }>()
  const warnings = new Set<string>(), checked = new Set<string>()
  const excludedCjkCharacters = new Set<number>()
  const scopes = new Set(['native', ...usages.map(usage => usage.scope || 'native')])
  const sourceMatchesFamily = (source: PortableFontFaceSource, family: string) => [source.family, ...(source.families || [])].some(name => normalizeFontFamily(name) === normalizeFontFamily(family))
  const scopedMatches = (scope: string, family: string, weight: number | string, style: string) => {
    const specific = sources.filter(source => source.scope === scope && sourceMatchesFamily(source, family))
    return matchingFontFaces(specific.length ? specific : sources.filter(source => !source.scope), family, weight, style)
  }
  for (const usage of usages) {
    const scope = usage.scope || 'native', stack = parseFontFamilies(usage.family), originalAlias = stack[0] || 'sans-serif', alias = familyAliases[normalizeFontFamily(originalAlias)] || originalAlias, weight = usage.weight || 400, style = usage.style || 'normal'
    const allCharacters = Array.from(new Set(Array.from(usage.text).map(character => character.codePointAt(0)!))).filter(cp => !ignoredCodePoint(cp))
    allCharacters.filter(isExcludedCjkCodePoint).forEach(cp => excludedCjkCharacters.add(cp))
    const characters = allCharacters.filter(cp => !isExcludedCjkCodePoint(cp))
    if (!characters.some(cp => !/\s/u.test(String.fromCodePoint(cp)))) continue
    const usageKey = `${scope}|${usage.family}|${weight}|${style}|${characters.join(',')}`
    if (checked.has(usageKey)) continue
    checked.add(usageKey)
    const category = stack.some(family => /monospace/i.test(family)) ? 'mono' : stack.some(family => /^serif$|times|georgia|baskerville/i.test(family)) ? 'serif' : 'sans'
    const catalogFallbacks = catalog?.defaultFallbacks
    const fallbackFamilies = Array.isArray(catalogFallbacks) ? catalogFallbacks : catalogFallbacks?.[category]
    const candidateFamilies = [...stack.map(familyName), ...(fallbackFamilies || (category === 'serif' ? ['SourceSerif4'] : ['Inter'])), 'Apple Symbols', 'SourceSerif4'].map(familyName)
    const primarySources = scopedMatches(scope, familyName(originalAlias), weight, style)
    if (primarySources.some(isCjkFontSource)) {
      warnings.add(`中文字体“${originalAlias}”不额外打包；使用该字体的英文也未锁定，请改用英文字体以保持跨设备排版。`)
      continue
    }
    if (!primarySources.length) throw new Error(`找不到可打包的首选字体“${originalAlias}”${scope !== 'native' ? `（${scope}）` : ''}。请导入该字体的 TTF/OTF/WOFF 文件，或将文稿改用已携带的字体后导出；不会自动替换字体而改变版式。`)
    let missing = [...characters], covered: UnicodeRange[] = [], foundPrimary = false, excludedPrimary = false
    const seenSources = new Set<string>()
    for (const source of candidateFamilies.flatMap(family => scopedMatches(scope, family, weight, style))) {
      if (isCjkFontSource(source)) continue
      const sourceKey = `${faceKey(source)}|${source.unicodeRange || ''}`
      if (seenSources.has(sourceKey)) continue
      seenSources.add(sourceKey)
      // Catalog coverage avoids downloading a large fallback that cannot help.
      if (foundPrimary && source.coverage && !missing.some(cp => hasFontCodePoint(source.coverage!, cp))) continue
      const font = await prepare(source)
      if (font.excludedCjk) {
        if (!foundPrimary) {
          warnings.add(`字体“${originalAlias}”包含大型中文字库，不额外打包；使用该字体的英文也未锁定，请改用英文字体。`)
          excludedPrimary = true
          break
        }
        continue
      }
      const coverage = source.unicodeRange ? intersectRanges(font.coverage, parseCssUnicodeRange(source.unicodeRange)) : font.coverage
      if (!foundPrimary || missing.some(cp => hasFontCodePoint(coverage, cp))) {
        const range = subtractRanges(coverage, covered), key = `${scope}|${normalizeFontFamily(alias)}|${source.weight || 400}|${source.style || 'normal'}|${faceKey(source)}`
        const previous = rules.get(key)
        rules.set(key, { scope, alias, source, prepared: font, range: previous ? mergeUnicodeRanges([...previous.range, ...range]) : range, weight: source.weight || 400, style: source.style || 'normal' })
        covered = mergeUnicodeRanges([...covered, ...coverage])
        if (foundPrimary && normalizeFontFamily(source.family) !== normalizeFontFamily(originalAlias)) warnings.add(`“${originalAlias}”不包含部分字符，已同时携带补充字体“${source.family}”，避免其他设备自行替换。`)
        foundPrimary = true
        missing = missing.filter(cp => !hasFontCodePoint(coverage, cp))
      }
      if (!missing.length) break
    }
    if (excludedPrimary) continue
    if (!foundPrimary) throw new Error(`找不到可打包的字体“${originalAlias}”。请导入该字体的 TTF/OTF/WOFF 文件，或将文稿改用已携带的字体后导出；不会生成依赖其他机器字体的 HTML。`)
    if (missing.length) {
      const sample = missing.slice(0, 8).map(cp => `${String.fromCodePoint(cp)}（U+${cp.toString(16).toUpperCase()}）`).join('、')
      throw new Error(`字体“${originalAlias}”及已知补充字体缺少字符：${sample}。请导入包含这些字符的字体或调整字体后重试，避免跨设备换行或乱码。`)
    }
  }
  for (const source of sources.filter(source => source.preserve)) {
    if (isCjkFontSource(source)) continue
    const scope = source.scope || 'native', alias = familyAliases[normalizeFontFamily(source.family)] || source.family
    scopes.add(scope)
    const font = await prepare(source), key = `${scope}|${normalizeFontFamily(alias)}|${source.weight || 400}|${source.style || 'normal'}|${faceKey(source)}`
    if (font.excludedCjk) continue
    const coverage = source.unicodeRange ? intersectRanges(font.coverage, parseCssUnicodeRange(source.unicodeRange)) : font.coverage
    const previous = rules.get(key)
    rules.set(key, { scope, alias, source, prepared: font, range: previous ? mergeUnicodeRanges([...previous.range, ...coverage]) : coverage, weight: source.weight || 400, style: source.style || 'normal' })
  }
  const faces = Array.from(rules.values()).map(rule => ({ scope: rule.scope, family: rule.alias, sourceFamily: rule.source.family, weight: rule.weight, style: rule.style, bytes: rule.prepared.bytes.length, encodedBytes: rule.prepared.dataUrl.length }))
  const totalBytes = Array.from(uniqueResources.values()).reduce((sum, resource) => sum + resource.bytes, 0), encodedBytes = Array.from(uniqueResources.values()).reduce((sum, resource) => sum + resource.encodedBytes, 0)
  for (const face of faces) if (face.bytes >= (options.warningFaceBytes ?? 5 * 1024 * 1024)) warnings.add(`字体“${face.sourceFamily}”较大（${memorySize(face.bytes)}，写入 HTML 约 ${memorySize(face.encodedBytes)}），为保持字形与排版已完整保留。`)
  if (totalBytes >= (options.warningTotalBytes ?? 10 * 1024 * 1024)) warnings.add(`字体包合计 ${memorySize(totalBytes)}（写入 HTML 约 ${memorySize(encodedBytes)}）。可以继续导出；改用较小字体可减少文件体积。`)
  const ruleCss = (rule: typeof rules extends Map<string, infer Value> ? Value : never) => `@font-face{font-family:${quote(rule.alias)};font-style:${rule.style};font-weight:${rule.weight};font-display:block;src:url(${quote(rule.prepared.dataUrl)}) format(${quote(rule.prepared.format)});unicode-range:${rule.range.map(([a, b]) => `U+${a.toString(16)}${b === a ? '' : `-${b.toString(16)}`}`).join(',')};}`
  const cssByScope = Object.fromEntries([...scopes].map(scope => [scope, Array.from(rules.values()).filter(rule => rule.scope === scope && rule.range.length).map(ruleCss).join('\n')]))
  const familyAliasesByScope = Object.fromEntries([...scopes].map(scope => [scope, familyAliases]))
  return { css: cssByScope.native, cssByScope, report: { coveragePolicy: 'latin-and-math', excludedCjkCharacters: excludedCjkCharacters.size, faces, totalBytes, encodedBytes, warnings: [...warnings] } satisfies PortableFontReport, usages, familyAliases, familyAliasesByScope }
}
