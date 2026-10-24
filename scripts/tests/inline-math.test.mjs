/* eslint-env node, es2020 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { Schema } from 'prosemirror-model'
import { DOMImplementation, XMLSerializer } from '@xmldom/xmldom'

const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-inline-math-test-'))
const server = await createServer({
  configFile: false, cacheDir: cacheDirectory, logLevel: 'error', server: { middlewareMode: true, hmr: false },
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
})
after(async () => {
  try {
    await server.close()
  }
  finally {
    await fs.rm(cacheDirectory, { recursive: true, force: true })
  }
})
const { renderLatex, renderInlineLatex, sanitizeLatexSvg } = await server.ssrLoadModule('/src/utils/latex.ts')
const { createInlineMathHTML, createInlineMathDOM, normalizeInlineMathHTML, INLINE_MATH_SELECTOR } = await server.ssrLoadModule('/src/utils/inlineMath.ts')
const { schemaNodes, schemaMarks } = await server.ssrLoadModule('/src/utils/prosemirror/schema/index.ts')

test('inline TeX uses text style, em geometry and its own baseline without changing standalone rendering', () => {
  const source = String.raw`\frac{x}{y}`
  const standalone = renderLatex(source)
  const inline = renderInlineLatex(source)
  assert.ok(inline.widthEm > 0 && inline.heightEm > 0)
  assert.ok(inline.widthEm < standalone.w / 32)
  assert.ok(inline.heightEm < standalone.h / 32)
  assert.ok(inline.verticalAlignEm < 0)
  const viewBox = inline.svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number)
  assert.equal(inline.widthEm, viewBox[2] / 1000)
  assert.equal(inline.heightEm, viewBox[3] / 1000)
  assert.equal(inline.verticalAlignEm, -(viewBox[1] + viewBox[3]) / 1000)
  assert.deepEqual(renderLatex(source), standalone)
})

test('published inline math is self-contained, inherits color and retains accessible formula source', () => {
  const source = String.raw`g_{\mu\nu}x^\nu`
  const html = createInlineMathHTML(source)
  assert.equal(INLINE_MATH_SELECTOR, 'span[data-inline-math][data-latex]')
  assert.ok(html.includes(`data-latex="${source}"`))
  assert.ok(html.includes(`aria-label="${source}"`))
  assert.ok(html.includes(`<title>${source}</title>`))
  assert.match(html, /width:[\d.]+em;height:[\d.]+em;vertical-align:-?[\d.]+em/)
  assert.ok(html.includes('fill="currentColor"'))
  assert.ok(html.includes('width="100%" height="100%"'))
  assert.ok(!/href=|<use\b|<image\b|font-family=|<style\b/.test(html))
  assert.match(html, /<path\b/)
})

test('source and labels are escaped instead of interpreted as HTML or attributes', () => {
  const source = String.raw`\text{<script>alert("x")</script> & '}`
  const html = createInlineMathHTML(source)
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('&quot;x&quot;'))
  assert.ok(html.includes('&#39;'))
  assert.equal(/<script\b|onclick=|onload=/i.test(html), false)
  assert.equal(normalizeInlineMathHTML(html), html)
  const entities = createInlineMathHTML(String.raw`\text{&alpha; &quot; </title><script>}`)
  assert.equal(normalizeInlineMathHTML(entities), entities)
  assert.ok(entities.includes('&amp;alpha;'))
  assert.equal(/<script\b/.test(entities), false)
})

test('normalization replaces supplied SVG and keeps neighboring text and typography', () => {
  const html = '<p><strong>before</strong> <span data-inline-math="1" data-latex="x" style="font-size:32px;color:#245b81;" onclick="bad()"><svg onload="bad()"><script>bad()</script><image href="https://bad.invalid"/></svg></span> <em>after</em></p>'
  const result = normalizeInlineMathHTML(html)
  assert.ok(result.startsWith('<p><strong>before</strong> '))
  assert.ok(result.endsWith(' <em>after</em></p>'))
  assert.ok(result.includes('font-size:32px;color:#245b81;'))
  assert.match(result, /<path\b/)
  assert.equal(/bad\(|<script\b|<image\b|onload=|onclick=|https:/i.test(result), false)
  assert.equal(normalizeInlineMathHTML(result), result)
  const uppercase = normalizeInlineMathHTML('<p>a<SPAN DATA-INLINE-MATH="1" DATA-LATEX="x"><svg onload="bad()"/></SPAN>b</p>')
  assert.ok(uppercase.includes('data-latex="x"'))
  assert.equal(uppercase.includes('bad()'), false)
})

test('invalid imported formulas reject the detached change without losing adjacent content', () => {
  const bad = '<p>left<span data-inline-math="1" data-latex="\\notACommand">old SVG</span>right</p>'
  assert.throws(() => normalizeInlineMathHTML(bad))
  assert.equal(bad, '<p>left<span data-inline-math="1" data-latex="\\notACommand">old SVG</span>right</p>')
  assert.throws(() => normalizeInlineMathHTML('<p>left<span data-inline-math="1">missing</span>right</p>'), /缺少/)
  assert.throws(() => createInlineMathHTML(''), /请输入/)
  assert.throws(() => createInlineMathHTML(String.raw`\frac{a}`))
  assert.equal(normalizeInlineMathHTML('<p>Existing plain text &amp; marks</p>'), '<p>Existing plain text &amp; marks</p>')
})

test('invalid pasted atoms serialize as explicit ordinary text and can safely reopen', () => {
  const xmlDocument = new DOMImplementation().createDocument(null, 'div')
  // The XML DOM provides real node/attribute/text serialization. Add the small
  // browser property adapters used by this error path without an app/profile.
  const ownerDocument = { createElement(tag) {
    const element = xmlDocument.createElement(tag)
    Object.defineProperty(element, 'dataset', { value: new Proxy({}, {
      set(_target, name, value) {
        element.setAttribute(`data-${name.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`)}`, value)
        return true
      },
    }) })
    Object.defineProperty(element, 'style', { value: { set cssText(value) {
      element.setAttribute('style', value)
    } } })
    Object.defineProperty(element, 'contentEditable', { set(value) {
      element.setAttribute('contenteditable', value)
    } })
    return element
  } }
  const source = String.raw`\notACommand{<unsafe> & text}`
  const fallback = createInlineMathDOM(source, ownerDocument)
  const serialized = new XMLSerializer().serializeToString(fallback)
  assert.equal(fallback.getAttribute('data-inline-math'), null)
  assert.equal(fallback.getAttribute('data-latex'), null)
  assert.equal(fallback.getAttribute('data-inline-math-error'), '1')
  assert.equal(fallback.textContent, source)
  assert.equal(serialized.includes('<unsafe>'), false)
  const surrounding = `<p>left${serialized}right</p>`
  assert.equal(normalizeInlineMathHTML(surrounding), surrounding)
})

test('equation-local macros and cache values never leak into another inline or standalone equation', () => {
  renderInlineLatex(String.raw`\newcommand{\privateFormula}{x}\privateFormula`)
  assert.throws(() => renderInlineLatex(String.raw`\privateFormula`))
  assert.throws(() => renderLatex(String.raw`\privateFormula`))
  const result = renderInlineLatex('x')
  result.svg = '<svg>mutated</svg>'
  result.widthEm = 999
  assert.notEqual(renderInlineLatex('x').widthEm, 999)
  assert.notEqual(renderInlineLatex('x').svg, '<svg>mutated</svg>')
})

test('native inline atom roundtrips LaTeX and marks as one caret position in ordinary paragraphs', () => {
  const schema = new Schema({ nodes: schemaNodes, marks: schemaMarks })
  const source = String.raw`E=mc^2`
  const marks = [schema.marks.fontsize.create({ fontsize: '32px' }), schema.marks.forecolor.create({ color: '#b43185' })]
  const formula = schema.nodes.inline_math.create({ latex: source }, null, marks)
  const paragraph = schema.nodes.paragraph.create(null, [schema.text('left '), formula, schema.text(' right')])
  const doc = schema.nodes.doc.create(null, [paragraph])
  assert.equal(formula.nodeSize, 1)
  assert.equal(formula.isInline, true)
  assert.equal(formula.isAtom, true)
  assert.equal(schema.nodes.inline_math.spec.selectable, true)
  assert.equal(doc.textBetween(0, doc.content.size), `left ${source} right`)
  const roundtrip = schema.nodeFromJSON(doc.toJSON())
  assert.ok(roundtrip.eq(doc))
  assert.equal(roundtrip.firstChild.child(1).marks[0].attrs.fontsize, '32px')
  assert.equal(roundtrip.firstChild.child(1).marks[1].attrs.color, '#b43185')
})

test('static SVG sanitizer discards executable nodes, external references and URL paint', () => {
  const safe = sanitizeLatexSvg('<svg onload="bad()"><foreignObject><p>bad</p></foreignObject><script>bad()</script><path d="M0 0L1 1" fill="url(https://bad.invalid)"/><text onclick="bad()">safe</text></svg>')
  assert.equal(/bad|foreignObject|script|onload|onclick|url\(/.test(safe), false)
  assert.ok(safe.includes('<text>safe</text>'))
  assert.ok(safe.includes('d="M0 0L1 1"'))
})
