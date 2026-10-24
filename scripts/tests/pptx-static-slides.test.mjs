/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'
import ts from 'typescript'
import tinycolor from 'tinycolor2'
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'

const root = fileURLToPath(new URL('../../', import.meta.url))
const loadUtility = async relative => {
  const bundled = await build({ entryPoints: [path.join(root, relative)], bundle: true, write: false, platform: 'node', format: 'cjs' })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports
}
const { prepareStaticPptxSlides, getPptxHtmlOmissions } = await loadUtility('src/utils/pptxStaticSlides.ts')
const { toAST } = await loadUtility('src/utils/htmlParser/index.ts')
const { toPoints } = await loadUtility('src/utils/svgPathParser.ts')
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII='
const text = (id, content, extra = {}) => ({
  id, type: 'text', left: 40, top: 30, width: 400, height: 60, rotate: 0,
  content: `<p>${content}</p>`, defaultFontName: 'Arial', defaultColor: '#234e63', ...extra,
})
const html = { source: '<!doctype html><script>throw Error("DO_NOT_EXECUTE_OR_EXPORT")</script><p>WEB_ONLY_CONTENT</p>', width: 1000, height: 563 }
const deepFreeze = value => {
  Object.freeze(value)
  for (const item of Object.values(value)) if (item && typeof item === 'object' && !Object.isFrozen(item)) deepFreeze(item)
  return value
}

test('raster PPTX snapshot drops only embedded HTML without changing native content or source document', () => {
  const slides = deepFreeze([
    { id: 'native', elements: [text('one', 'Native slide')], background: { type: 'solid', color: '#f0f0f0' } },
    { id: 'mixed', html, elements: [text('overlay', 'Native overlay')], remark: '<p>Speaker notes</p>' },
    { id: 'web-only', html, elements: [] },
  ])
  const before = JSON.stringify(slides)
  const rendered = prepareStaticPptxSlides(slides)
  assert.deepEqual(rendered.map(slide => slide.id), ['native', 'mixed', 'web-only'])
  assert.equal(rendered.some(slide => Object.hasOwn(slide, 'html')), false)
  for (const [index, slide] of rendered.entries()) {
    assert.equal(slide.elements, slides[index].elements)
    assert.equal(slide.background, slides[index].background)
    assert.equal(slide.remark, slides[index].remark)
  }
  assert.equal(JSON.stringify(slides), before)
})

test('PPTX omission notice counts only the selected webpages and identifies blank placeholders with page numbers', () => {
  const slides = [
    { id: 'mixed', html, elements: [text('overlay', 'Keep me')] },
    { id: 'empty', html, elements: [] },
    { id: 'numbered', html, elements: [text('number', '3', { autoPageNumber: { start: 1, format: 'number', hideOnFirst: true, hidden: false } })] },
    { id: 'native', elements: [] },
  ]
  assert.deepEqual(getPptxHtmlOmissions(slides), { embeddedPageCount: 3, webOnlyPageCount: 2 })
  assert.deepEqual(getPptxHtmlOmissions([slides[0]]), { embeddedPageCount: 1, webOnlyPageCount: 0 })
  assert.deepEqual(getPptxHtmlOmissions([slides[3]]), { embeddedPageCount: 0, webOnlyPageCount: 0 })
})

test('production PPTX writer keeps mixed-page native text, pictures, equations, shapes and blank page order', async () => {
  const source = await fs.readFile(path.join(root, 'src/hooks/useExport.ts'), 'utf8')
  const ast = ts.createSourceFile('useExport.ts', source, ts.ScriptTarget.Latest, true)
  const variable = name => {
    let declaration
    const visit = node => {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) declaration = node
      ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.ok(declaration, `Missing production export helper ${name}`)
    return `const ${declaration.getText(ast)};`
  }
  const moduleSource = `
    const viewportSize = { value: 1000 }, viewportRatio = { value: 0.5625 };
    const ratioPx2Inch = { value: 100 }, ratioPx2Pt = { value: 100 / 72 }, defaultFontSize = 16;
    ${['setPPTXLayout', 'formatColor', 'formatHTML', 'formatPoints', 'isBase64Image', 'isSVGImage', 'buildPPTX'].map(variable).join('\n')}
    return buildPPTX;
  `
  const compiled = ts.transpileModule(moduleSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const imageSources = []
  const writer = new Function('pptxgen', 'tinycolor', 'toAST', 'toPoints', 'preparePptxImageSource', 'preparePptxImageShadow', 'preparePptxInlineMathText', compiled)(
    PptxGenJS, tinycolor, toAST, toPoints,
    source => {
      imageSources.push(source); return Promise.resolve(source)
    },
    () => Promise.resolve(null),
    element => Promise.resolve(element.id === 'equation' ? { dataUrl: png, left: 40, top: 130, width: 150, height: 50, rotate: 0 } : null),
  )
  const slides = deepFreeze([
    { id: 'cover', elements: [text('cover-text', 'COVER')] },
    { id: 'mixed', html, background: { type: 'solid', color: '#aabbcc' }, elements: [
      text('overlay', 'NATIVE_OVERLAY'), text('equation', 'Formula raster fixture'),
      { id: 'image', type: 'image', left: 500, top: 40, width: 100, height: 100, rotate: 0, src: png },
      { id: 'shape', type: 'shape', left: 700, top: 40, width: 100, height: 100, rotate: 0, viewBox: [100, 100], path: 'M 0 0 L 100 0 L 100 100 L 0 100 Z', fill: '#ff0000' },
    ] },
    { id: 'blank-web', html, background: { type: 'solid', color: '#112233' }, elements: [] },
    { id: 'last', elements: [text('last-text', 'LAST_PAGE'), text('number', '4', { autoPageNumber: { hidden: false } })] },
  ])
  const before = JSON.stringify(slides)
  const pptx = await writer(slides, false, true)
  const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }))
  const pagePaths = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  assert.equal(pagePaths.length, 4)
  const pages = await Promise.all([1, 2, 3, 4].map(index => zip.file(`ppt/slides/slide${index}.xml`).async('string')))
  assert.match(pages[0], /<a:t>COVER<\/a:t>/)
  assert.match(pages[1], /<a:t>NATIVE_OVERLAY<\/a:t>/)
  assert.equal((pages[1].match(/<p:pic>/g) || []).length, 2, 'native image and rendered inline equation remain')
  assert.match(pages[1], /<a:custGeom>/)
  assert.match(pages[1], /aabbcc/i)
  assert.equal(pages[2].includes('<p:pic>'), false)
  assert.equal(pages[2].includes('<a:t>'), false)
  assert.match(pages[2], /112233/)
  assert.match(pages[3], /<a:t>LAST_PAGE<\/a:t>/)
  assert.match(pages[3], /<a:t>4<\/a:t>/)
  for (const page of pages) assert.equal(/WEB_ONLY_CONTENT|DO_NOT_EXECUTE_OR_EXPORT/.test(page), false)
  assert.deepEqual(imageSources, [png])
  assert.equal(JSON.stringify(slides), before)
})
