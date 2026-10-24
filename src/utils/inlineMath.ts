import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { translate as decodeEntities } from 'mathjax-full/js/util/Entities.js'
import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js'
import { renderInlineLatex, type InlineLatexResult } from '@/utils/latex'

export const INLINE_MATH_SELECTOR = 'span[data-inline-math][data-latex]'

const adaptor = liteAdaptor()
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!))
const em = (value: number) => `${Number(value.toFixed(6))}em`
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const rawTextTags = new Set(['script', 'style', 'fieldset'])
const decodedTextTags = new Set(['title', 'textarea', 'option'])

// Serialize attributes ourselves: MathJax's lite HTML serializer escapes only
// quotes, so a literal LaTeX "&alpha;" attribute would otherwise change source
// when a browser decodes it on the next editor/import roundtrip.
const serializeHtml = (node: LiteElement): string => {
  const kind = adaptor.kind(node)
  const attributes = adaptor.allAttributes(node).map(({ name, value }) => ` ${name}="${escapeHtml(value)}"`).join('')
  if (voidTags.has(kind)) return `<${kind}${attributes}>`
  const content = rawTextTags.has(kind) ? adaptor.textContent(node)
    : decodedTextTags.has(kind) ? escapeHtml(decodeEntities(adaptor.textContent(node)))
      : serializeChildren(node)
  return `<${kind}${attributes}>${content}</${kind}>`
}
const serializeChildren = (node: LiteElement): string => adaptor.childNodes(node).map(child => {
  const kind = adaptor.kind(child)
  if (kind === '#text') return escapeHtml(adaptor.value(child))
  if (kind === '#comment') return `<!--${adaptor.value(child)}-->`
  return serializeHtml(child as LiteElement)
}).join('')

const mathStyle = (result: InlineLatexResult) => [
  'display:inline-block',
  `width:${em(result.widthEm)}`,
  `height:${em(result.heightEm)}`,
  `vertical-align:${em(result.verticalAlignEm)}`,
  'line-height:0',
  'white-space:nowrap',
  'text-indent:0',
].join(';') + ';'

/** Canonical self-contained HTML, suitable for native text content and static
 * publication. Only LaTeX is authoritative; supplied SVG is never reused. */
export const createInlineMathHTML = (source: string): string => {
  const result = renderInlineLatex(source)
  const latex = escapeHtml(result.latex)
  return `<span data-inline-math="1" data-latex="${latex}" contenteditable="false" role="math" aria-label="${latex}" style="${mathStyle(result)}">${result.svg}</span>`
}

/** Node views must also tolerate a malformed formula pasted from another app.
 * Keep it visible and editable instead of breaking the editor or losing text. */
export const createInlineMathDOM = (source: string, ownerDocument: Document = document): HTMLSpanElement => {
  const holder = ownerDocument.createElement('div')
  try {
    holder.innerHTML = createInlineMathHTML(source)
    return holder.firstElementChild as HTMLSpanElement
  }
  catch {
    const fallback = ownerDocument.createElement('span')
    // This is ordinary visible text, not a persistable formula atom. Keeping
    // canonical markers here would make an invalid paste fail strict document
    // validation when its autosaved text content is reopened later.
    fallback.dataset.inlineMathError = '1'
    fallback.contentEditable = 'false'
    fallback.setAttribute('role', 'math')
    fallback.setAttribute('aria-label', `无法排版的公式：${source}`)
    fallback.style.cssText = 'display:inline-block;white-space:pre-wrap;'
    fallback.textContent = source || '（空公式）'
    return fallback
  }
}

// Native marks normally surround the atom. AI-created text can put typography
// on the marker itself; preserve these harmless inheritable values as marks.
const typography = [
  'font-size', 'font-family', 'font-weight', 'color', 'background-color',
  'text-decoration', 'text-decoration-line',
]
const getTypography = (node: LiteElement): string => typography.flatMap(property => {
  const value = adaptor.getStyle(node, property)
  if (!value || /[;{}<>]|url\s*\(|expression\s*\(/i.test(value)) return []
  return [`${property}:${value};`]
}).join('')

/** Validate the entire change before the caller replaces its document. The
 * detached parse leaves neighboring text/marks intact and overwrites every
 * formula child tree, including stale or untrusted imported SVG markup. */
export const normalizeInlineMathHTML = (html: string): string => {
  if (!/\bdata-inline-math\b/i.test(html)) return html
  const parsed = adaptor.parse(html, 'text/html')
  const body = adaptor.body(parsed)
  let changed = false
  const visit = (node: LiteElement) => {
    for (const child of [...adaptor.childNodes(node)]) {
      if (adaptor.kind(child) === '#text' || adaptor.kind(child) === '#comment') continue
      const element = child as LiteElement
      const attributes = Object.fromEntries(adaptor.allAttributes(element).map(({ name, value }) => [name.toLowerCase(), value]))
      if (adaptor.kind(element) === 'span' && Object.prototype.hasOwnProperty.call(attributes, 'data-inline-math')) {
        const source = attributes['data-latex']
        if (typeof source !== 'string') throw new Error('行内公式缺少 LaTeX 源码')
        const canonicalDocument = adaptor.parse(createInlineMathHTML(source), 'text/html')
        const canonical = adaptor.firstChild(adaptor.body(canonicalDocument)) as LiteElement
        const inherited = getTypography(element)
        if (inherited) adaptor.setAttribute(canonical, 'style', inherited + adaptor.getAttribute(canonical, 'style'))
        adaptor.replace(canonical, element)
        changed = true
      }
      else visit(element)
    }
  }
  visit(body)
  return changed ? serializeChildren(body) : html
}
