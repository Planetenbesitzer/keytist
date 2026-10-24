import { normalizeFontFamily } from './portableFonts'

interface Patch { start: number; end: number; value: string }
const quoted = (value: string) => JSON.stringify(value).replace(/</g, '\\3c ')
const applyPatches = (source: string, patches: Patch[]) => patches.sort((a, b) => b.start - a.start).reduce((result, patch) => result.slice(0, patch.start) + patch.value + result.slice(patch.end), source)

/** Skip a CSS string/comment/function without confusing its punctuation with
 * declaration delimiters. Offsets always refer to the untouched source. */
const skipCss = (text: string, start: number): number => {
  if (text.startsWith('/*', start)) {
    const end = text.indexOf('*/', start + 2)
    return end < 0 ? text.length : end + 2
  }
  const quote = text[start]
  if (quote === '"' || quote === "'") {
    for (let index = start + 1; index < text.length; index++) {
      if (text[index] === '\\') index++
      else if (text[index] === quote) return index + 1
    }
    return text.length
  }
  if (quote === '(' || quote === '[') {
    const closing = quote === '(' ? ')' : ']'
    for (let index = start + 1; index < text.length;) {
      if (text[index] === closing) return index + 1
      const next = skipCss(text, index)
      index = next > index ? next : index + 1
    }
    return text.length
  }
  return start
}

const commaParts = (text: string): [number, number][] => {
  const result: [number, number][] = []
  let start = 0
  for (let index = 0; index < text.length;) {
    const next = skipCss(text, index)
    if (next > index) {
      index = next; continue
    }
    if (text[index] === ',') {
      result.push([start, index]); start = index + 1
    }
    index++
  }
  result.push([start, text.length])
  return result
}

const familyPatches = (text: string, offset: number, aliases: Record<string, string>): Patch[] => {
  const patches: Patch[] = []
  for (const [start, end] of commaParts(text)) {
    const part = text.slice(start, end), trimmed = part.trim()
    if (/^var\s*\(/i.test(trimmed) && trimmed.endsWith(')')) {
      const opening = part.indexOf('('), body = part.slice(opening + 1, part.lastIndexOf(')'))
      const fallback = commaParts(body)[0][1]
      if (fallback < body.length) patches.push(...familyPatches(body.slice(fallback + 1), offset + start + opening + fallback + 2, aliases))
      continue
    }
    // A generic keyword must be the whole family item. Quoted "serif" and
    // unquoted My serif are named families and must not be rewritten.
    const bare = trimmed.replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
    if (!bare || /["'(),]/.test(bare)) continue
    const alias = aliases[normalizeFontFamily(bare)]
    if (alias) {
      const token = part.indexOf(bare)
      patches.push({ start: offset + start + token, end: offset + start + token + bare.length, value: quoted(alias) })
    }
  }
  return patches
}

const fontTokens = (text: string) => {
  const tokens: { start: number; end: number; text: string }[] = []
  for (let index = 0; index < text.length;) {
    if (/\s/.test(text[index])) {
      index++; continue
    }
    if (text.startsWith('/*', index)) {
      index = skipCss(text, index); continue
    }
    const start = index
    if (text[index] === '/') index++
    else {
      while (index < text.length && !/[\s/,]/.test(text[index])) {
        const next = skipCss(text, index)
        index = next > index ? next : index + 1
      }
      if (index === start) index++
    }
    tokens.push({ start, end: index, text: text.slice(start, index) })
  }
  return tokens
}
const isSize = (text: string) => /^(?:(?:xx?-|xxx-)?(?:small|large)|medium|smaller|larger|math|(?:[+-]?(?:\d*\.)?\d+)(?:px|pt|pc|em|rem|ex|rex|ch|rch|cap|rcap|ic|ric|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cm|mm|in|q|%)|(?:calc|min|max|clamp)\([\s\S]*\))$/i.test(text)

const shorthandPatches = (text: string, offset: number, aliases: Record<string, string>): Patch[] => {
  const tokens = fontTokens(text)
  let size = tokens.findIndex(token => isSize(token.text))
  // A stretch percentage may precede the actual font-size.
  if (size >= 0 && /%$/.test(tokens[size].text) && tokens[size + 1] && isSize(tokens[size + 1].text)) size++
  if (size < 0) {
    const trimmed = text.trim()
    if (/^var\s*\(/i.test(trimmed) && trimmed.endsWith(')')) {
      const opening = text.indexOf('('), body = text.slice(opening + 1, text.lastIndexOf(')'))
      const fallback = commaParts(body)[0][1]
      if (fallback < body.length) return shorthandPatches(body.slice(fallback + 1), offset + opening + fallback + 2, aliases)
    }
    return familyPatches(text, offset, aliases)
  }
  let family = size + 1
  if (tokens[family]?.text === '/') family += 2
  if (!tokens[family]) return []
  return familyPatches(text.slice(tokens[family].start), offset + tokens[family].start, aliases)
}

const cssPatches = (text: string, aliases: Record<string, string>): Patch[] => {
  const patches: Patch[] = []
  const declarations: { property: string; start: number; value: string }[] = []
  let segment = 0
  for (let index = 0; index < text.length;) {
    const next = skipCss(text, index)
    if (next > index) {
      index = next; continue
    }
    if (/[{};]/.test(text[index])) {
      segment = index + 1; index++; continue
    }
    if (text[index] !== ':') {
      index++; continue
    }
    const rawProperty = text.slice(segment, index).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    const property = rawProperty.startsWith('--') ? rawProperty : rawProperty.toLowerCase()
    if (property !== 'font-family' && property !== 'font' && !/^--[\w-]+$/.test(property)) {
      index++; continue
    }
    const start = index + 1
    let end = start
    while (end < text.length && !/[{};]/.test(text[end])) {
      const after = skipCss(text, end)
      end = after > end ? after : end + 1
    }
    // `font:hover {}` is a selector, not a font declaration.
    if (text[end] !== '{') {
      const value = text.slice(start, end).replace(/\s*!\s*important\s*$/i, '')
      declarations.push({ property, start, value })
    }
    index = end
  }
  const related = new Set(declarations.filter(declaration => /^--.*(?:font|family|typeface)/i.test(declaration.property)).map(declaration => declaration.property))
  let added = true
  while (added) {
    added = false
    for (const declaration of declarations) {
      if (declaration.property !== 'font-family' && declaration.property !== 'font' && !related.has(declaration.property)) continue
      for (const match of declaration.value.matchAll(/\bvar\s*\(\s*(--[\w-]+)/g)) {
        if (!related.has(match[1])) {
          related.add(match[1]); added = true
        }
      }
    }
  }
  for (const { property, start, value } of declarations) {
    if (property !== 'font-family' && property !== 'font' && !related.has(property)) continue
    patches.push(...(property === 'font-family' ? familyPatches(value, start, aliases) : shorthandPatches(value, start, aliases)))
  }
  return patches
}

/** Change only generic font tokens in declarations, including shorthand and
 * font-related custom properties. Other CSS, comments, strings and URLs stay. */
export const rewritePortableFontCss = (cssText: string, aliases: Record<string, string>): string => applyPatches(cssText, cssPatches(cssText, aliases))

const decodeAttribute = (raw: string) => {
  let value = ''
  const starts: number[] = [], ends: number[] = []
  const named: Record<string, string> = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', colon: ':', semi: ';', comma: ',', Tab: '\t', NewLine: '\n' }
  for (let index = 0; index < raw.length;) {
    const match = raw[index] === '&' ? raw.slice(index).match(/^&(#x[\da-f]+;?|#\d+;?|[a-z][a-z\d]*;)/i) : null
    let decoded = match?.[0] || raw[index]
    const length = decoded.length
    if (match) {
      const entity = match[1].replace(/;$/, '')
      if (entity[0] === '#') {
        const cp = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
        decoded = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '\ufffd'
      }
      else decoded = named[entity] || match[0]
    }
    for (let character = 0; character < decoded.length; character++) {
      starts.push(index); ends.push(index + length)
    }
    value += decoded
    index += length
  }
  return { value, starts, ends }
}

const tagEnd = (source: string, start: number) => {
  let quote = ''
  for (let index = start; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = ''; continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '>') return index + 1
  }
  return source.length
}

const styleAttributePatches = (tag: string, offset: number, aliases: Record<string, string>): Patch[] => {
  const patches: Patch[] = []
  let index = tag.match(/^<\/?\s*[^\s/>]+/)?.[0].length || tag.length
  while (index < tag.length) {
    while (/[\s/]/.test(tag[index] || '')) index++
    if (!tag[index] || tag[index] === '>') break
    const name = tag.slice(index).match(/^[^\s=/>]+/)?.[0]
    if (!name) {
      index++; continue
    }
    index += name.length
    while (/\s/.test(tag[index] || '')) index++
    if (tag[index] !== '=') continue
    index++
    while (/\s/.test(tag[index] || '')) index++
    const quote = /["']/.test(tag[index] || '') ? tag[index++] : ''
    const start = index
    if (quote) while (index < tag.length && tag[index] !== quote) index++
    else while (index < tag.length && !/[\s>]/.test(tag[index])) index++
    if (name.toLowerCase() === 'style') {
      const raw = tag.slice(start, index), decoded = decodeAttribute(raw)
      for (const patch of cssPatches(decoded.value, aliases)) {
        let value = patch.value.replace(/&/g, '&amp;')
        value = quote === "'" ? value.replace(/'/g, '&#39;') : quote === '"' ? value.replace(/"/g, '&quot;') : value.replace(/[^\w-]/g, char => `&#${char.charCodeAt(0)};`)
        patches.push({ start: offset + start + decoded.starts[patch.start], end: offset + start + decoded.ends[patch.end - 1], value })
      }
    }
    if (quote) index++
  }
  return patches
}

/** A small HTML tokenizer avoids serializing or interpreting the document.
 * Script/raw-text bodies and comments are copied byte for byte, even when JS
 * strings contain apparent <style> tags or CSS declarations. */
export const rewritePortableHtmlFonts = (source: string, aliases: Record<string, string>): string => {
  const patches: Patch[] = []
  let index = 0
  while (index < source.length) {
    const start = source.indexOf('<', index)
    if (start < 0) break
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4)
      index = end < 0 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', start)) {
      const end = source.indexOf(']]>', start + 9)
      index = end < 0 ? source.length : end + 3
      continue
    }
    const match = source.slice(start).match(/^<\s*([a-z][\w:-]*)\b/i)
    if (!match) {
      index = /[!/]/.test(source[start + 1] || '') ? tagEnd(source, start + 1) : start + 1; continue
    }
    const tag = match[1].toLowerCase(), end = tagEnd(source, start + match[0].length)
    patches.push(...styleAttributePatches(source.slice(start, end), start, aliases))
    if (['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext'].includes(tag)) {
      if (tag === 'plaintext') break
      const closing = new RegExp(`<\\/${tag}(?=[\\s/>])`, 'ig')
      closing.lastIndex = end
      const close = closing.exec(source), contentEnd = close?.index ?? source.length
      if (tag === 'style') patches.push(...cssPatches(source.slice(end, contentEnd), aliases).map(patch => ({ ...patch, start: patch.start + end, end: patch.end + end })))
      index = close ? tagEnd(source, close.index + close[0].length) : source.length
    }
    else index = end
  }
  return applyPatches(source, patches)
}
