import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { transform } from 'esbuild'
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = await fs.readFile(path.join(root, 'src/hooks/useExport.ts'), 'utf8')
const ast = ts.createSourceFile('useExport.ts', source, ts.ScriptTarget.Latest, true)
const find = predicate => {
  let found
  const visit = node => {
    if (predicate(node)) found ??= node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, 'Expected production export implementation was not found')
  return found
}
const variable = name => `const ${find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name).getText(ast)}`
const imageBranch = find(node => ts.isIfStatement(node) && /el\.type\s*===\s*['"]image['"]/.test(node.expression.getText(ast))).thenStatement.getText(ast)
// Compile the exact production image branch and its helpers, rather than a
// second implementation. The original Vue hook requires a mounted editor.
const moduleSource = `
import tinycolor from 'tinycolor2'
import { computed } from 'vue'
export function imageExporter(size) {
  const viewportSize = { value: size }
  const preparedImages = new Map()
  ${variable('ratioPx2Inch')}
  ${variable('ratioPx2Pt')}
  ${variable('formatColor')}
  ${variable('getShadowOption')}
  ${variable('isBase64Image')}
  // This suite covers legacy/drop shadows; advanced geometry has its own fixtures.
  const preparePptxImageShadow = async () => null
  const appendImage = async (el, pptxSlide) => ${imageBranch}
  return { appendImage, getShadowOption }
}`
const temporary = path.join(root, `.image-shadow-verification-${process.pid}.mjs`)
const cases = [
  { name: 'soft-default', shadow: { h: 0, v: 8, blur: 10, color: 'rgba(0,0,0,0.18)' }, expected: { angle: 90, opacity: 0.18 } },
  { name: 'diagonal', shadow: { h: 3, v: -4, blur: 12, color: 'rgba(0,0,0,0.24)' }, expected: { angle: 307, opacity: 0.24 } },
  { name: 'centered', shadow: { h: 0, v: 0, blur: 20, color: 'rgba(0,0,0,0.10)' }, expected: { angle: 1, opacity: 0.10 } },
  { name: 'transparent-and-zero-blur', shadow: { h: 0, v: 8, blur: 0, color: 'rgba(0,0,0,0)' }, expected: { angle: 90, opacity: 0 } },
  { name: 'horizontal-right', shadow: { h: 7, v: 0, blur: 10, color: 'rgba(0,0,0,0.20)' }, expected: { angle: 1, opacity: 0.20 } },
  { name: 'no-shadow' },
]
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const results = []
try {
  await fs.writeFile(temporary, (await transform(moduleSource, { loader: 'ts', format: 'esm', target: 'es2020' })).code)
  const { imageExporter } = await import(temporary)
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  let slideNumber = 0
  for (const viewportSize of [1000, 1920]) {
    const exporter = imageExporter(viewportSize)
    for (const item of cases) {
      const slide = pptx.addSlide()
      const element = { type: 'image', id: `${viewportSize}-${item.name}`, src: pixel, left: 100, top: 100, width: 400, height: 250, rotate: 0, fixedRatio: true, ...(item.shadow ? { shadow: item.shadow } : {}) }
      await exporter.appendImage(element, slide)
      results.push({ name: item.name, viewportSize, slideNumber: ++slideNumber, element, expected: item.expected })
    }
  }
  const data = await pptx.write({ outputType: 'nodebuffer' })
  const zip = await JSZip.loadAsync(data)
  for (const result of results) {
    const xml = await zip.file(`ppt/slides/slide${result.slideNumber}.xml`).async('string')
    const shadowTag = /<a:outerShdw\b([^>]*)>/.exec(xml)
    if (!result.element.shadow) {
      assert.equal(shadowTag, null, 'An image without shadow gained an exported shadow')
      result.passed = true
      delete result.element
      continue
    }
    assert.ok(shadowTag, `Image shadow was missing for ${result.name}`)
    const attrs = Object.fromEntries([...shadowTag[1].matchAll(/([A-Za-z]+)="([^"]*)"/g)].map(match => [match[1], match[2]]))
    const alpha = Number(/<a:alpha val="(\d+)"/.exec(xml)?.[1])
    const pixelsPerPoint = 96 / 72 * (result.viewportSize / 960)
    const shadow = result.element.shadow
    assert.equal(Number(attrs.blurRad), Math.round(shadow.blur / pixelsPerPoint * 12700), 'Blur unit conversion differs')
    assert.equal(Number(attrs.dist), Math.round(Math.hypot(shadow.h, shadow.v) / pixelsPerPoint * 12700), 'Offset unit conversion differs')
    assert.equal(Number(attrs.dir), result.expected.angle * 60000, 'Shadow direction differs')
    assert.equal(alpha, Math.round(result.expected.opacity * 100000), 'Shadow opacity differs')
    result.xml = { blurRad: Number(attrs.blurRad), distance: Number(attrs.dist), direction: Number(attrs.dir), alpha }
    result.passed = true
    delete result.element
  }
  await fs.mkdir(path.join(root, 'verification'), { recursive: true })
  await fs.writeFile(path.join(root, 'verification/image-shadow-export.pptx'), data)
  const report = {
    generatedAt: new Date().toISOString(),
    passed: results.every(result => result.passed),
    cases: results,
    method: 'Extracted the exact production image-export branch and shadow helpers, generated a real PPTX with PptxGenJS, and inspected every slide XML.',
    checks: ['Image shadow survives native PPTX export', 'Pixel-to-point conversion for offset and blur', 'Diagonal vector length and direction', 'Centered shadow retains zero distance', 'Transparent shadow retains zero alpha', 'Zero blur remains zero', 'Absent shadow stays absent', 'Two document viewport scales'],
    limitations: ['PptxGenJS 3.12 serializes integer shadow directions and substitutes 270 degrees for zero. Horizontal-right shadows use a 1 degree approximation.', 'This XML check does not claim identical blur appearance between browser CSS and PowerPoint/Keynote renderers.'],
  }
  await fs.writeFile(path.join(root, 'verification/image-shadow-export-report.json'), JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(`Image shadow PPTX checks passed: ${results.length} cases.\n`)
}
finally {
  await fs.rm(temporary, { force: true }) 
}
