import type { LocalDocument } from '@/services/localDocument'
import { collectStylesheetFontFaces, preparePortableFonts, type PortableFontUsage, type PortableFontFaceSource, type PortableFontOptions } from './portableFonts'
import { rewritePortableHtmlFonts } from './portableFontCss'

export const PORTABLE_TEXT_SIZE_CSS = 'html,body,.native-content,.native-content *{-webkit-text-size-adjust:none!important;text-size-adjust:none!important;}'

interface HtmlToken { tag: string; closing: boolean; start: number; end: number; contentEnd?: number; closingEnd?: number }
const endOfTag = (source: string, start: number) => {
  let quote = ''
  for (let index = start; index < source.length; index++) {
    if (quote) {
      if (source[index] === quote) quote = ''; continue
    }
    if (source[index] === '"' || source[index] === "'") quote = source[index]
    else if (source[index] === '>') return index + 1
  }
  return source.length
}
const htmlTokens = (source: string): HtmlToken[] => {
  const tokens: HtmlToken[] = []
  let index = 0
  while (index < source.length) {
    const start = source.indexOf('<', index)
    if (start < 0) break
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4); index = end < 0 ? source.length : end + 3; continue
    }
    if (source.startsWith('<![CDATA[', start)) {
      const end = source.indexOf(']]>', start + 9); index = end < 0 ? source.length : end + 3; continue
    }
    const match = source.slice(start).match(/^<(\/?)([a-z][\w:-]*)\b/i)
    if (!match) {
      index = source.startsWith('<!', start) ? endOfTag(source, start + 2) : start + 1; continue
    }
    const token: HtmlToken = { tag: match[2].toLowerCase(), closing: !!match[1], start, end: endOfTag(source, start + match[0].length) }
    tokens.push(token)
    index = token.end
    if (!token.closing && ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext'].includes(token.tag)) {
      if (token.tag === 'plaintext') break
      const closing = new RegExp(`<\\/${token.tag}(?=[\\s/>])`, 'ig'); closing.lastIndex = token.end
      const found = closing.exec(source)
      token.contentEnd = found?.index ?? source.length
      token.closingEnd = found ? endOfTag(source, found.index + found[0].length) : source.length
      index = token.closingEnd
    }
  }
  return tokens
}

/** Do not weaken a page's security policy merely to make fonts exportable. */
export const assertPortableFontCsp = (policies: string[], page: number) => {
  for (const policy of policies) {
    const directives = new Map<string, string[]>()
    for (const declaration of policy.split(';')) {
      const [name, ...values] = declaration.trim().split(/\s+/)
      if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), values.map(value => value.toLowerCase()))
    }
    const fonts = directives.get('font-src') || directives.get('default-src')
    const styles = directives.get('style-src-elem') || directives.get('style-src') || directives.get('default-src')
    const fontsAllowed = !fonts || fonts.includes('data:')
    const stylesAllowed = !styles || (styles.includes("'unsafe-inline'") && !styles.some(value => /^'(?:nonce-|sha(?:256|384|512)-)/.test(value)))
    if (!fontsAllowed || !stylesAllowed) throw new Error(`第 ${page} 页网页的 Content Security Policy（CSP）禁止${!fontsAllowed ? ' data: 内嵌字体' : '新增内联字体样式'}，无法保证跨设备排版。请调整网页自身的 font-src / style-src 策略后重试；原安全策略没有被删除或放宽。`)
  }
}

const skipCssToken = (text: string, start: number): number => {
  if (text.startsWith('/*', start)) {
    const end = text.indexOf('*/', start + 2); return end < 0 ? text.length : end + 2
  }
  const quote = text[start]
  if (quote === '"' || quote === "'") {
    for (let index = start + 1; index < text.length; index++) {
      if (text[index] === '\\') index++
      else if (text[index] === quote) return index + 1
    }
    return text.length
  }
  if (quote === '(') {
    for (let index = start + 1; index < text.length;) {
      if (text[index] === ')') return index + 1
      const next = skipCssToken(text, index); index = next > index ? next : index + 1
    }
    return text.length
  }
  return start
}
const skipCssSpace = (text: string, start: number) => {
  let index = start
  while (index < text.length) {
    if (/\s|\ufeff/.test(text[index])) index++
    else if (text.startsWith('/*', index)) index = skipCssToken(text, index)
    else break
  }
  return index
}
const cssUnescape = (value: string) => value.replace(/\\(?:\r\n|[\r\n\f])/g, '').replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, character) => hex ? String.fromCodePoint(Math.min(0x10ffff, parseInt(hex, 16)) || 0xfffd) : character)
const cssUrl = (value: string) => JSON.stringify(value).replace(/</g, '\\3c ')

export const absolutizePortableCssUrls = (css: string, base: string): string => {
  let result = '', copied = 0
  for (let index = 0; index < css.length;) {
    if (/^url\s*\(/i.test(css.slice(index)) && (index === 0 || !/[\w-]/.test(css[index - 1]))) {
      const opening = css.indexOf('(', index), end = skipCssToken(css, opening)
      const raw = css.slice(opening + 1, end - 1).trim().replace(/^(['"])([\s\S]*)\1$/, '$2'), value = cssUnescape(raw)
      if (value && !value.startsWith('#')) {
        result += css.slice(copied, index) + `url(${cssUrl(new URL(value, base).href)})`; copied = end
      }
      index = end; continue
    }
    const next = css.startsWith('/*', index) || /["']/.test(css[index]) ? skipCssToken(css, index) : index
    index = next > index ? next : index + 1
  }
  return result + css.slice(copied)
}

interface CssImport { start: number; end: number; url: string; layer?: string; supports?: string; media: string }
const cssImports = (css: string): CssImport[] => {
  const result: CssImport[] = []
  let index = skipCssSpace(css, 0)
  while (index < css.length) {
    const start = index, keyword = css.slice(index).match(/^@(import|charset|layer)\b/i)?.[1].toLowerCase()
    if (!keyword) break
    while (index < css.length && !/[;{]/.test(css[index])) {
      const next = skipCssToken(css, index); index = next > index ? next : index + 1
    }
    if (css[index] !== ';') break
    const end = index + 1
    if (keyword === 'import') {
      let at = skipCssSpace(css, start + 7), source = ''
      if (/^url\s*\(/i.test(css.slice(at))) {
        const opening = css.indexOf('(', at), after = skipCssToken(css, opening)
        source = css.slice(opening + 1, after - 1).trim().replace(/^(['"])([\s\S]*)\1$/, '$2'); at = after
      }
      else if (/["']/.test(css[at] || '')) {
        const after = skipCssToken(css, at); source = css.slice(at + 1, after - 1); at = after
      }
      if (!source) throw new Error('网页的 CSS @import 地址无效，无法制作离线字体包。')
      at = skipCssSpace(css, at)
      let layer: string | undefined, supports: string | undefined
      if (/^layer\b/i.test(css.slice(at))) {
        at += 5
        if (css[at] === '(') {
          const after = skipCssToken(css, at); layer = css.slice(at + 1, after - 1); at = after
        }
        else layer = ''
        at = skipCssSpace(css, at)
      }
      if (/^supports\s*\(/i.test(css.slice(at))) {
        const opening = css.indexOf('(', at), after = skipCssToken(css, opening)
        supports = css.slice(opening + 1, after - 1); at = skipCssSpace(css, after)
      }
      result.push({ start, end, url: cssUnescape(source), layer, supports, media: css.slice(at, end - 1).trim() })
    }
    index = skipCssSpace(css, end)
  }
  return result
}

/** External CSS is snapshotted in its original cascade position. JS is never
 * parsed/serialized, and non-font resources keep absolute original URLs. */
export const snapshotPortableHtmlCss = async (source: string, base: string, page: number, fetcher: typeof fetch = fetch): Promise<string> => {
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  assertPortableFontCsp(Array.from(parsed.querySelectorAll('meta')).filter(meta => meta.getAttribute('http-equiv')?.toLowerCase() === 'content-security-policy').map(meta => meta.getAttribute('content') || ''), page)
  const effectiveBase = parsed.querySelector('base[href]')?.getAttribute('href')
  if (effectiveBase) base = new URL(effectiveBase, base).href
  const fetched = new Map<string, Promise<string>>()
  const fetchCss = (url: string): Promise<string> => {
    let pending = fetched.get(url)
    if (pending) return pending
    pending = (async () => {
      try {
        if (!/^(?:https?:|data:|blob:)/i.test(url)) throw new Error('unsupported stylesheet address')
        const response = await fetcher(url, { signal: AbortSignal.timeout(20000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.text()
      }
      catch {
        throw new Error(`第 ${page} 页网页的样式表无法读取或不允许跨域读取：${url}。未导出 HTML，以免遗漏网页字体；请把样式表放到可读取的位置或直接内嵌 CSS。`)
      }
    })()
    fetched.set(url, pending); return pending
  }
  const expand = async (css: string, cssBase: string, ancestors: string[]): Promise<string> => {
    const imports = cssImports(css)
    let result = '', copied = 0
    for (const imported of imports) {
      const url = new URL(imported.url, cssBase).href
      if (ancestors.length >= 20) throw new Error(`第 ${page} 页网页的 CSS @import 嵌套过深，无法检查全部字体。`)
      let content = ancestors.includes(url) ? '' : await expand(await fetchCss(url), url, [...ancestors, url])
      if (imported.media && imported.media.toLowerCase() !== 'all') content = `@media ${imported.media}{${content}}`
      if (imported.supports) content = `@supports ${/^(?:\(|not\b|selector\(|font-tech\(|font-format\()/i.test(imported.supports.trim()) ? imported.supports : `(${imported.supports})`}{${content}}`
      if (imported.layer !== undefined) content = `@layer${imported.layer ? ' ' + imported.layer : ''}{${content}}`
      result += css.slice(copied, imported.start) + content; copied = imported.end
    }
    return absolutizePortableCssUrls(result + css.slice(copied), cssBase)
  }
  const patches: { start: number; end: number; value: string }[] = []
  for (const token of htmlTokens(source)) {
    if (token.closing) continue
    if (token.tag === 'style') {
      const css = await expand(source.slice(token.end, token.contentEnd), base, [])
      patches.push({ start: token.end, end: token.contentEnd!, value: css.replace(/</g, '\\3c ') })
    }
    else if (token.tag === 'link') {
      const raw = source.slice(token.start, token.end), link = new DOMParser().parseFromString(raw, 'text/html').querySelector('link')
      if (!link?.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('stylesheet')) continue
      const href = link.getAttribute('href')
      if (!href) throw new Error(`第 ${page} 页网页的样式表缺少地址，无法检查字体。`)
      const url = new URL(href, base).href, css = await expand(await fetchCss(url), url, [url])
      const opening = raw.replace(/^<link\b/i, '<style').replace(/\/\s*>$/, '>')
      patches.push({ start: token.start, end: token.end, value: opening + css.replace(/</g, '\\3c ') + '</style>' })
    }
  }
  return patches.sort((a, b) => b.start - a.start).reduce((result, patch) => result.slice(0, patch.start) + patch.value + result.slice(patch.end), source)
}

/** A measurement copy has no script privileges. The original executable page
 * is retained separately and is never serialized from this inert document. */
const measurementSource = (source: string) => {
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  parsed.querySelectorAll('script,iframe,object,embed,video,audio,source,track,link:not([rel="stylesheet"])').forEach(node => node.remove())
  parsed.querySelectorAll('meta[http-equiv]').forEach(node => {
    if (node.getAttribute('http-equiv')?.toLowerCase() !== 'content-security-policy') node.remove()
  })
  parsed.querySelectorAll('*').forEach(node => {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name) || ['srcdoc', 'srcset'].includes(attribute.name)) node.removeAttribute(attribute.name)
    }
    // Images do not participate in font measurement and may have side effects.
    if (node.localName === 'img') node.removeAttribute('src')
  })
  const style = parsed.createElement('style')
  style.textContent = PORTABLE_TEXT_SIZE_CSS
  parsed.head.appendChild(style)
  return '<!doctype html>' + parsed.documentElement.outerHTML
}

const captureHtmlFonts = async (source: string, width: number, height: number, page: number) => {
  const publishSource = await snapshotPortableHtmlCss(source, document.baseURI, page)
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;opacity:0;pointer-events:none;border:0;`
  frame.width = String(width)
  frame.height = String(height)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`第 ${page} 页网页的字体检查超时，请检查引用的样式表。`)), 20000)
      frame.onload = () => {
        clearTimeout(timer); resolve()
      }
      frame.srcdoc = measurementSource(publishSource)
      document.body.appendChild(frame)
    })
    const doc = frame.contentDocument, view = frame.contentWindow
    if (!doc || !view) throw new Error(`无法检查第 ${page} 页网页的字体。`)
    const usages: PortableFontUsage[] = []
    const add = (element: Element, text: string, pseudo?: string) => {
      if (!text.trim()) return
      const style = view.getComputedStyle(element, pseudo)
      // The frame itself is invisible; only explicit hidden content is skipped.
      if (!element.getClientRects().length || style.display === 'none' || style.visibility === 'hidden' || style.fontSize === '0px' || element.closest('script,style,noscript,template,.katex-mathml,mjx-assistive-mml,annotation,defs,title,desc,metadata')) return
      usages.push({ family: style.fontFamily, weight: style.fontWeight, style: style.fontStyle, text, scope: `第 ${page} 页网页` })
    }
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) if (node.parentElement) add(node.parentElement, node.textContent || '')
    for (const element of [doc.body, ...Array.from(doc.body.querySelectorAll('*'))]) {
      // Empty text containers and canvases may receive text from the preserved
      // demo script. Retain the full face declared for those visible elements.
      if (!(element.textContent || '').trim()) add(element, 'Aa0123456789')
      for (const pseudo of ['::before', '::after']) {
        const content = view.getComputedStyle(element, pseudo).content
        if (content && !['none', 'normal'].includes(content) && /^(['"])[\s\S]*\1$/.test(content)) add(element, content.slice(1, -1), pseudo)
      }
      if (element.localName === 'li') {
        const style = view.getComputedStyle(element)
        if (style.listStyleType !== 'none') add(element, ({ disc: '•', circle: '◦', square: '▪' } as Record<string, string>)[style.listStyleType] || '0123456789.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', '::marker')
      }
    }
    for (const sheet of Array.from(doc.styleSheets)) {
      try {
        void sheet.cssRules
      }
      catch {
        throw new Error(`第 ${page} 页网页包含无法读取的样式表，未导出以免遗漏字体。请内嵌相关 CSS 后重试。`)
      }
    }
    const sources = collectStylesheetFontFaces(doc.styleSheets).map(font => ({ ...font, scope: `第 ${page} 页网页`, preserve: true }))
    return { usages, sources, publishSource }
  }
  finally {
    frame.remove()
  }
}

export const injectPortableFontStyles = (source: string, css: string, aliases: Record<string, string> = {}) => {
  source = rewritePortableHtmlFonts(source, aliases)
  // CSS is generated from validated font bytes, not taken from source markup.
  const style = `<style data-slide-studio-fonts>${(css + '\n' + PORTABLE_TEXT_SIZE_CSS).replace(/<\/style/gi, '<\\/style')}</style>`
  const tokens = htmlTokens(source)
  const closing = tokens.find(token => token.tag === 'head' && token.closing)
  const offset = closing?.start ?? tokens.find(token => token.tag === 'head' && !token.closing)?.end ?? tokens.find(token => token.tag === 'body' && !token.closing)?.start ?? tokens.find(token => token.tag === 'html' && !token.closing)?.end ?? source.match(/^\s*<!doctype[^>]*>/i)?.[0].length ?? 0
  return source.slice(0, offset) + style + source.slice(offset)
}

export const prepareHtmlExportFonts = async (input: LocalDocument, roots: HTMLElement[], options: PortableFontOptions = {}) => {
  const usages: PortableFontUsage[] = [], sources: PortableFontFaceSource[] = []
  const sourcesByScope: Record<string, string> = {}
  for (const [index, slide] of input.slides.entries()) {
    if (!slide.html) continue
    const captured = await captureHtmlFonts(slide.html.source, slide.html.width || input.width, slide.html.height || input.height, index + 1)
    usages.push(...captured.usages)
    sources.push(...captured.sources)
    sourcesByScope[`第 ${index + 1} 页网页`] = captured.publishSource
  }
  return { ...await preparePortableFonts(input, roots, { ...options, usages: [...(options.usages || []), ...usages], sources: [...(options.sources || []), ...sources] }), sourcesByScope }
}

export type PreparedHtmlFonts = Awaited<ReturnType<typeof prepareHtmlExportFonts>>
