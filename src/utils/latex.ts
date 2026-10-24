import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { translate as decodeEntities } from 'mathjax-full/js/util/Entities.js'
import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js'
import type { PPTLatexElement } from '@/types/slides'
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js'
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js'
import 'mathjax-full/js/input/tex/configmacros/ConfigMacrosConfiguration.js'
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js'
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js'
import 'mathjax-full/js/input/tex/braket/BraketConfiguration.js'
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js'
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js'

export interface LatexResult {
  latex: string
  svg: string
  // Retained for presentations created with the original path renderer.
  path: string
  w: number
  h: number
}

export interface InlineLatexResult {
  latex: string
  svg: string
  widthEm: number
  heightEm: number
  verticalAlignEm: number
}

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const cache = new Map<string, LatexResult>()
const inlineCache = new Map<string, InlineLatexResult>()
const safeSvgCache = new Map<string, string>()
const svgTags = new Set(['svg', 'g', 'path', 'rect', 'line', 'polygon', 'polyline', 'circle', 'ellipse', 'text', 'title'])
const svgAttributes = new Set([
  'xmlns', 'width', 'height', 'viewbox', 'preserveaspectratio', 'x', 'y', 'rx', 'ry', 'cx', 'cy', 'r',
  'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'fill-rule', 'clip-rule', 'color',
  'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'vector-effect',
  'font-family', 'font-size', 'role', 'aria-label', 'aria-hidden', 'focusable', 'data-mml-node', 'data-mjx-texclass', 'data-c',
])
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// The lite adaptor intentionally serializes HTML <title> as raw PCDATA and
// escapes only quotes in attributes. SVG is inserted into real browser DOM,
// where both behaviors could turn literal formula text into live markup.
const serializeSafeSvg = (node: LiteElement): string => {
  const attributes = adaptor.allAttributes(node).map(({ name, value }) => ` ${name}="${escapeXml(value)}"`).join('')
  const content = adaptor.kind(node) === 'title'
    ? escapeXml(decodeEntities(adaptor.textContent(node)))
    : adaptor.childNodes(node).map(child => adaptor.kind(child) === '#text'
      ? escapeXml(adaptor.value(child))
      : serializeSafeSvg(child as LiteElement)).join('')
  return `<${adaptor.kind(node)}${attributes}>${content}</${adaptor.kind(node)}>`
}

/** Keep imported formula SVGs to static geometry, text, and plain colors. */
export const sanitizeLatexSvg = (source: string): string => {
  const previous = safeSvgCache.get(source)
  if (previous !== undefined) return previous
  const parsed = adaptor.parse(source, 'text/html')
  const root = adaptor.childNodes(adaptor.body(parsed)).find(node => adaptor.kind(node) === 'svg') as LiteElement | undefined
  if (!root) return ''
  const clean = (node: LiteElement) => {
    for (const { name, value } of adaptor.allAttributes(node)) {
      if (!svgAttributes.has(name.toLowerCase()) || /url\s*\(|javascript\s*:|data\s*:/i.test(value)) {
        adaptor.removeAttribute(node, name)
      }
    }
    for (const child of [...adaptor.childNodes(node)]) {
      const kind = adaptor.kind(child)
      if (kind === '#text') continue
      if (!svgTags.has(kind)) adaptor.remove(child)
      else clean(child as LiteElement)
    }
  }
  clean(root)
  adaptor.setAttribute(root, 'xmlns', 'http://www.w3.org/2000/svg')
  const result = serializeSafeSvg(root)
  if (safeSvgCache.size >= 400) safeSvgCache.delete(safeSvgCache.keys().next().value!)
  safeSvgCache.set(source, result)
  return result
}

const unwrapMath = (source: string) => {
  const value = source.trim()
  if (value.startsWith('$$') && value.endsWith('$$')) return value.slice(2, -2).trim()
  if (value.startsWith('\\[') && value.endsWith('\\]')) return value.slice(2, -2).trim()
  if (value.startsWith('\\(') && value.endsWith('\\)')) return value.slice(2, -2).trim()
  if (value.startsWith('$') && value.endsWith('$')) return value.slice(1, -1).trim()
  return value
}

const typesetLatex = (input: string, display: boolean): LiteElement => {
  // A fresh TeX instance prevents one equation's macro definitions from leaking
  // into another. No loader/require/html extensions or external fonts are used.
  const tex = new TeX({
    packages: ['base', 'ams', 'newcommand', 'configmacros', 'boldsymbol', 'mathtools', 'braket', 'cancel', 'color'],
    maxMacros: 1000,
    maxBuffer: 32 * 1024,
    formatError: (_jax: unknown, error: { message: string }) => {
      throw new Error(error.message) 
    },
  })
  const output = new SVG({ fontCache: 'none' })
  const document = mathjax.document('', { InputJax: tex, OutputJax: output })
  const container = document.convert(input, { display })
  const svg = adaptor.firstChild(container) as LiteElement
  if (!svg || adaptor.kind(svg) !== 'svg') throw new Error('公式无法排版，请检查 LaTeX 语法')
  if (adaptor.outerHTML(svg).includes('data-mjx-error')) throw new Error('公式包含无法识别的 LaTeX 命令')

  return svg
}

const getLatexViewBox = (svg: LiteElement): number[] => {
  const viewBox = (adaptor.getAttribute(svg, 'viewBox') || '').split(/\s+/).map(Number)
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error('公式为空，或仅包含宏定义')
  }
  return viewBox
}

/** Typeset locally, with every glyph embedded in the returned SVG. */
export const renderLatex = (source: string): LatexResult => {
  const latex = source.trim()
  const input = unwrapMath(latex)
  if (!input) throw new Error('请输入 LaTeX 公式')
  const previous = cache.get(latex)
  if (previous) return { ...previous }
  const svg = typesetLatex(input, true)
  const viewBox = getLatexViewBox(svg)
  const w = Math.max(12, viewBox[2] / 1000 * 32)
  const h = Math.max(12, viewBox[3] / 1000 * 32)
  adaptor.setAttribute(svg, 'width', `${w}`)
  adaptor.setAttribute(svg, 'height', `${h}`)
  adaptor.setAttribute(svg, 'style', 'display:block;overflow:visible')
  const result = { latex, svg: sanitizeLatexSvg(adaptor.outerHTML(svg)), path: '', w, h }
  if (cache.size >= 400) cache.delete(cache.keys().next().value!)
  cache.set(latex, result)
  return { ...result }
}

/** Inline math uses TeX text style, follows the surrounding font size and color,
 * and carries its baseline in em units rather than the standalone object's px. */
export const renderInlineLatex = (source: string): InlineLatexResult => {
  const latex = source.trim()
  const input = unwrapMath(latex)
  if (!input) throw new Error('请输入 LaTeX 公式')
  const previous = inlineCache.get(latex)
  if (previous) return { ...previous }
  const svg = typesetLatex(input, false)
  const viewBox = getLatexViewBox(svg)
  const widthEm = viewBox[2] / 1000
  const heightEm = viewBox[3] / 1000
  const verticalAlignEm = -(viewBox[1] + viewBox[3]) / 1000
  adaptor.setAttribute(svg, 'width', '100%')
  adaptor.setAttribute(svg, 'height', '100%')
  adaptor.setAttribute(svg, 'aria-hidden', 'true')
  adaptor.setAttribute(svg, 'focusable', 'false')
  // Besides the accessible label on the outer atom, retain source as real text
  // so formula-only native text boxes are not mistaken for empty text.
  adaptor.insert(adaptor.node('title', {}, [adaptor.text(escapeXml(latex))]), adaptor.firstChild(svg))
  const result = {
    latex,
    svg: sanitizeLatexSvg(adaptor.outerHTML(svg)),
    widthEm,
    heightEm,
    verticalAlignEm,
  }
  if (inlineCache.size >= 400) inlineCache.delete(inlineCache.keys().next().value!)
  inlineCache.set(latex, result)
  return { ...result }
}

/** Apply source edits atomically, keeping the object centered at its current size scale. */
export const mergeLatexElement = (element: PPTLatexElement, patch: Partial<PPTLatexElement>): PPTLatexElement => {
  const result = renderLatex(patch.latex ?? element.latex)
  for (const field of ['width', 'height'] as const) {
    if (patch[field] !== undefined && (!Number.isFinite(patch[field]) || patch[field]! <= 0)) {
      throw new Error(`公式的 ${field} 必须为正数`)
    }
  }
  const widthSpecified = patch.width !== undefined
  const heightSpecified = patch.height !== undefined
  let width = patch.width ?? result.w * element.width / element.viewBox[0]
  let height = patch.height ?? result.h * element.height / element.viewBox[1]
  if (widthSpecified && !heightSpecified) height = width * result.h / result.w
  if (heightSpecified && !widthSpecified) width = height * result.w / result.h
  return {
    ...element,
    ...patch,
    latex: result.latex,
    svg: result.svg,
    path: '',
    viewBox: [result.w, result.h],
    width,
    height,
    left: patch.left ?? element.left + (element.width - width) / 2,
    top: patch.top ?? element.top + (element.height - height) / 2,
  }
}
