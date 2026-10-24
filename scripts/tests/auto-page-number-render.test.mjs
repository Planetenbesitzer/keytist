/* eslint-env node, es2020 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { build } from 'esbuild'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import tinycolor from 'tinycolor2'
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-page-number-render-'))
const server = await createServer({
  configFile: path.join(root, 'vite.config.ts'), cacheDir: cacheDirectory, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true, hmr: false },
})
after(async () => {
  try {
    await server.close()
  }
  finally {
    await fs.rm(cacheDirectory, { recursive: true, force: true })
  }
})

const { default: BaseTextElement } = await server.ssrLoadModule('/src/views/components/element/TextElement/BaseTextElement.vue')
const parser = await build({ entryPoints: [path.join(root, 'src/utils/htmlParser/index.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['lodash'] })
const parserModule = { exports: {} }
new Function('require', 'module', 'exports', parser.outputFiles[0].text)(createRequire(import.meta.url), parserModule, parserModule.exports)
const { toAST } = parserModule.exports
const number = (id, content, autoPageNumber) => ({
  id, type: 'text', left: 800, top: 500, width: 120, height: 40, rotate: 0,
  content: `<p>${content}</p>`, defaultFontName: 'Arial', defaultColor: '#234e63',
  fixedHeight: true, ...(autoPageNumber ? { autoPageNumber } : {}),
})
const config = { start: 1, format: 'number', hideOnFirst: true }

test('thumbnail, screen and raster/print text renderer hides only the cover field', async () => {
  const hidden = await renderToString(createSSRApp(BaseTextElement, { elementInfo: number('cover', '1', { ...config, hidden: true }) }))
  const visible = await renderToString(createSSRApp(BaseTextElement, { elementInfo: number('body', '2', { ...config, hidden: false }) }))
  const ordinary = await renderToString(createSSRApp(BaseTextElement, { elementInfo: number('ordinary', '1') }))
  assert.match(hidden, /data-auto-page-number-hidden="true"/)
  assert.match(hidden, /display:none/)
  for (const html of [visible, ordinary]) {
    assert.equal(html.includes('data-auto-page-number-hidden'), false)
    assert.equal(html.includes('display:none'), false)
  }
  assert.match(visible, /<p>2<\/p>/)
  assert.match(ordinary, /<p>1<\/p>/)
})

test('native PPTX omits hidden cover numbers before rendering text and keeps ordinary text', async () => {
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
  // Compile the actual export loop and formatter. Only the browser-only inline
  // equation rasterizer is substituted; the fixture contains plain page numbers.
  const moduleSource = `
    const viewportSize = { value: 1000 }, viewportRatio = { value: 0.5625 };
    const ratioPx2Inch = { value: 96 * (1000 / 960) };
    const ratioPx2Pt = { value: 96 / 72 * (1000 / 960) };
    const defaultFontSize = 16;
    ${['setPPTXLayout', 'formatColor', 'formatHTML', 'buildPPTX'].map(variable).join('\n')}
    return buildPPTX;
  `
  const compiled = ts.transpileModule(moduleSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const rendered = []
  const build = new Function('pptxgen', 'tinycolor', 'toAST', 'preparePptxInlineMathText', compiled)(PptxGenJS, tinycolor, toAST, element => {
    rendered.push(element.id); return Promise.resolve(null)
  })
  const pptx = await build([
    { id: 'cover', elements: [number('hidden', 'Hidden cover number', { ...config, hidden: true }), number('ordinary', 'Ordinary cover text')] },
    { id: 'body', elements: [number('visible', '2', { ...config, hidden: false })] },
  ], false, true)
  assert.deepEqual(rendered, ['ordinary', 'visible'])
  const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }))
  const cover = await zip.file('ppt/slides/slide1.xml').async('string')
  const body = await zip.file('ppt/slides/slide2.xml').async('string')
  assert.equal(cover.includes('Hidden cover number'), false)
  assert.match(cover, /<a:t>Ordinary cover text<\/a:t>/)
  assert.match(body, /<a:t>2<\/a:t>/)
})
