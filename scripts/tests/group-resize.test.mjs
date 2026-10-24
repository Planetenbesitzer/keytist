/* eslint-env node, es2020 */
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { DOMParser as XMLParser, XMLSerializer } from '@xmldom/xmldom'
import { createServer } from 'vite'

// Well-formed native-text fixtures need only this detached DOM adapter. The
// production browser uses its native HTML parser, not a second transform copy.
globalThis.DOMParser = class {
  parseFromString(content) {
    const document = new XMLParser().parseFromString(`<body>${content}</body>`, 'application/xml')
    const body = document.documentElement
    Object.defineProperty(body, 'innerHTML', {
      get: () => Array.from(body.childNodes).map(node => new XMLSerializer().serializeToString(node)).join(''),
    })
    return { body }
  }
}
const source = await readFile(new URL('../../src/utils/groupResize.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const { resizeGroupElement, scaleGroupText, getGroupResizeTransform, isCompleteGroupSelection } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
// Load the real schema and its formula renderer with the app's alias mapping.
// The temporary Vite cache is always removed, including on module-load errors.
const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'slide-studio-group-test-'))
let server
let nativeNodes
let createInlineMathHTML
try {
  server = await createServer({
    configFile: false, cacheDir: cacheDirectory, logLevel: 'error', server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  })
  ;({ default: nativeNodes } = await server.ssrLoadModule('/src/utils/prosemirror/schema/nodes.ts'))
  ;({ createInlineMathHTML } = await server.ssrLoadModule('/src/utils/inlineMath.ts'))
}
finally {
  try {
    if (server) await server.close()
  }
  finally {
    await rm(cacheDirectory, { recursive: true, force: true })
  }
}

const base = { id: 'one', groupId: 'group', left: 100, top: 80, width: 200, height: 100, rotate: 37 }
const anchor = { x: 20, y: 30 }
const tests = []
const check = (name, fn) => tests.push([name, fn])
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

check('All four corners retain the opposite anchor and use both pointer axes', () => {
  const range = { minX: 20, maxX: 220, minY: 30, maxY: 130 }
  for (const direction of ['left-top', 'right-top', 'left-bottom', 'right-bottom']) {
    const x = direction.startsWith('left') ? -200 : 200
    const y = direction.endsWith('top') ? -100 : 100
    const transform = getGroupResizeTransform(range, direction, x, y)
    close(transform.scale, 2)
    assert.deepEqual(transform.anchor, { x: x < 0 ? 220 : 20, y: y < 0 ? 130 : 30 })
  }
  close(getGroupResizeTransform(range, 'right-bottom', 0, 50).scale, 1.1)
  assert.equal(getGroupResizeTransform(range, 'right-bottom', -1000, -1000).scale, 0.01)
})
check('Rotated rectangles scale in world space without changing their angle', () => {
  const original = { ...base, type: 'image', src: 'data:image/png;base64,AA', fixedRatio: true }
  const changed = resizeGroupElement(original, anchor, 2)
  assert.equal(changed.rotate, 37)
  assert.deepEqual([changed.left, changed.top, changed.width, changed.height], [180, 130, 400, 200])
  close(changed.left + changed.width / 2, anchor.x + (original.left + original.width / 2 - anchor.x) * 2)
  assert.deepEqual(original, { ...base, type: 'image', src: 'data:image/png;base64,AA', fixedRatio: true })
})
check('Mixed font runs, inherited base, relative runs and list markers scale once', () => {
  const result = scaleGroupText('<p>Default <strong>bold</strong><span style="font-size:24px;color:red">large</span><span style="font-size:150%">relative</span></p><ul style="font-size:20pt"><li><p>Item</p></li></ul>', 2)
  assert.match(result, /<p style="font-size: 32px;">Default <strong>bold<\/strong>/)
  assert.match(result, /font-size: 48px;color:red/)
  assert.match(result, /font-size: 150%/)
  assert.match(result, /ul style="font-size: 40pt"/)
  assert.equal(scaleGroupText('<p>unchanged</p>', 1), '<p>unchanged</p>')
  assert.match(scaleGroupText('plain text', 2), /^<span style="font-size: 32px;">plain text<\/span>$/)
})
check('Paragraph and quotation base sizes survive the editor schema without changing legacy defaults', () => {
  const element = { style: { textAlign: 'right', textIndent: '2em', fontSize: '14px' }, getAttribute: name => name === 'data-indent' ? '3' : null }
  const attrs = nativeNodes.paragraph.parseDOM[0].getAttrs(element)
  assert.deepEqual(attrs, { align: 'right', indent: 3, textIndent: 2, fontsize: '14px' })
  const paragraph = nativeNodes.paragraph.toDOM({ attrs })
  assert.equal(paragraph[1]['data-indent'], 3)
  assert.match(paragraph[1].style, /font-size: 14px;/)
  assert.match(paragraph[1].style, /text-align: right;/)
  assert.match(paragraph[1].style, /text-indent: 2em;/)
  assert.equal(nativeNodes.paragraph.attrs.fontsize.default, '')
  assert.equal(nativeNodes.paragraph.toDOM({ attrs: { align: '', indent: 0, textIndent: 0, fontsize: '' } })[1].style, '')
  assert.deepEqual(nativeNodes.blockquote.parseDOM[0].getAttrs(element), { fontsize: '14px' })
  assert.deepEqual(nativeNodes.blockquote.toDOM({ attrs: { fontsize: '' } }), ['blockquote', {}, 0])
  assert.deepEqual(nativeNodes.blockquote.toDOM({ attrs: { fontsize: '8px' } }), ['blockquote', { style: 'font-size: 8px;' }, 0])
})
check('Inline formulas inherit scaled text size while retaining em geometry and source', () => {
  const formula = createInlineMathHTML(String.raw`\frac{x}{y}`)
  const result = scaleGroupText(`<p style="font-size:20px">Before ${formula} after</p>`, 2)
  assert.match(result, /<p style="font-size: 40px">Before /)
  const original = new XMLParser().parseFromString(`<body>${formula}</body>`, 'application/xml').documentElement.firstChild
  const changed = new XMLParser().parseFromString(`<body>${result}</body>`, 'application/xml').documentElement.firstChild.childNodes[1]
  assert.equal(changed.getAttribute('data-latex'), original.getAttribute('data-latex'))
  assert.equal(changed.getAttribute('style').replace(/\s+/g, ''), original.getAttribute('style').replace(/\s+/g, ''))
  assert.equal(nativeNodes.inline_math.inline, true)
  assert.equal(nativeNodes.inline_math.atom, true)
  assert.equal(nativeNodes.inline_math.leafText({ attrs: { latex: 'x' } }), 'x')
})
check('Text and shape text keep layout, styles and source geometry coordinated', () => {
  const text = { ...base, type: 'text', content: '<p><span style="font-size:20px">Text</span></p>', defaultFontName: 'Arial', defaultColor: '#000', wordSpace: 2, paragraphSpace: 7 }
  const changed = resizeGroupElement(text, anchor, 0.5)
  assert.deepEqual(changed.inset, [5, 5, 5, 5])
  assert.equal(changed.wordSpace, 1)
  assert.equal(changed.paragraphSpace, 3.5)
  assert.match(changed.content, /font-size: 10px/)
  const shape = { ...base, type: 'shape', path: 'M0 0 Q10 5 20 0Z', viewBox: [20, 10], fixedRatio: false, pathFormula: 'roundRect', fill: '#fff', text: { content: '<p>Shape</p>', align: 'middle', defaultFontName: 'Arial', defaultColor: '#000' } }
  const resized = resizeGroupElement(shape, anchor, 2)
  assert.equal(resized.path, shape.path)
  assert.deepEqual(resized.viewBox, shape.viewBox)
  assert.equal(resized.pathFormula, shape.pathFormula)
  assert.deepEqual(resized.text.inset, [20, 20, 20, 20])
  assert.match(resized.text.content, /font-size: 32px/)
})
check('Image frame, filter, shadow geometry and outline scale but shape ratios do not', () => {
  const image = { ...base, type: 'image', src: 'unchanged', fixedRatio: true, radius: 18, filters: { blur: '2px', brightness: '110%' }, outline: { width: 3, color: '#333' }, shadow: { h: 2, v: 8, blur: 12, color: '#0004', type: 'curved', perspective: 0.35, curve: 0.65 } }
  const changed = resizeGroupElement(image, anchor, 2)
  assert.equal(changed.radius, 36)
  assert.equal(changed.filters.blur, '4px')
  assert.equal(changed.filters.brightness, '110%')
  assert.equal(changed.outline.width, 6)
  assert.deepEqual(changed.shadow, { ...image.shadow, h: 4, v: 16, blur: 24 })
})
check('Lines include every local control point, absolute position and stroke width', () => {
  const line = { ...base, type: 'line', width: 4, start: [0, 20], end: [100, 0], broken: [20, 40], broken2: [40, 30], curve: [50, -20], cubic: [[10, 30], [70, -10]], style: 'solid', color: '#000', points: ['arrow', 'dot'] }
  delete line.height
  delete line.rotate
  const changed = resizeGroupElement(line, anchor, 2)
  assert.deepEqual(changed.start, [0, 40])
  assert.deepEqual(changed.end, [200, 0])
  assert.deepEqual(changed.broken, [40, 80])
  assert.deepEqual(changed.broken2, [80, 60])
  assert.deepEqual(changed.curve, [100, -40])
  assert.deepEqual(changed.cubic, [[20, 60], [140, -20]])
  assert.equal(changed.width, 8)
  assert.deepEqual(changed.points, line.points)
  close(changed.left + changed.curve[0], anchor.x + (line.left + line.curve[0] - anchor.x) * 2)
})
check('Formula source and intrinsic SVG coordinates remain byte-for-byte unchanged', () => {
  const formula = { ...base, type: 'latex', latex: String.raw`E=mc^2`, svg: '<svg viewBox="-1 -2 32 12"><path d="M0 1"/></svg>', path: 'M0 1', viewBox: [32, 12], color: '#123', strokeWidth: 1.7, fixedRatio: true }
  const changed = resizeGroupElement(formula, anchor, 2)
  for (const property of ['latex', 'svg', 'path', 'strokeWidth']) assert.equal(changed[property], formula[property])
  assert.deepEqual(changed.viewBox, formula.viewBox)
  assert.deepEqual([changed.width, changed.height], [400, 200])
})
check('Tables scale rows, fonts and geometry; other native types retain source/data', () => {
  const table = { ...base, type: 'table', cellMinHeight: 40, rowHeights: [40, 60], colWidths: [1], outline: { width: 2 }, data: [[{ id: 'cell1', text: 'one', colspan: 1, rowspan: 1 }], [{ id: 'cell2', text: 'two', colspan: 1, rowspan: 1, style: { fontsize: '20pt', color: '#f00' } }]] }
  const changed = resizeGroupElement(table, anchor, 0.5)
  assert.equal(changed.cellMinHeight, 20)
  assert.deepEqual(changed.rowHeights, [20, 30])
  assert.equal(changed.data[0][0].style.fontsize, '7px')
  assert.equal(changed.data[1][0].style.fontsize, '10pt')
  assert.equal(changed.data[1][0].style.color, '#f00')
  assert.equal(table.data[0][0].style, undefined)
  for (const type of ['chart', 'audio', 'video']) {
    const element = { ...base, type, src: 'preserved.mp4', data: { labels: ['one'], series: [[4]] } }
    const resized = resizeGroupElement(element, anchor, 2)
    assert.deepEqual([resized.left, resized.top, resized.width, resized.height], [180, 130, 400, 200])
    assert.equal(resized.src, element.src)
    assert.deepEqual(resized.data, element.data)
  }
})
check('Only a complete same-group selection qualifies; no-op does not rewrite data', () => {
  const first = { ...base, type: 'image' }
  const second = { ...first, id: 'two' }
  assert.equal(isCompleteGroupSelection([first, second], [first, second]), true)
  assert.equal(isCompleteGroupSelection([first], [first, second]), false)
  assert.equal(isCompleteGroupSelection([first, second], [first, second, { ...first, id: 'three' }]), false)
  assert.equal(isCompleteGroupSelection([first, { ...second, groupId: 'another' }], [first, second]), false)
  assert.equal(resizeGroupElement(first, anchor, 1), first)
  assert.throws(() => resizeGroupElement(first, anchor, 0), RangeError)
})

for (const [name, fn] of tests) {
  fn()
  process.stdout.write(`PASS ${name}\n`)
}
process.stdout.write(`${tests.length} group resize regression checks passed. No files were created.\n`)
