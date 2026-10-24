/* eslint-env node, es2020 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import ts from 'typescript'
import { DOMParser as XMLDOMParser } from '@xmldom/xmldom'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-compact-import-test-'))
const server = await createServer({
  configFile: false, cacheDir: cacheDirectory, logLevel: 'error', server: { middlewareMode: true, hmr: false },
  resolve: { alias: { '@': path.join(root, 'src') } },
})
after(async () => {
  try {
    await server.close()
  }
  finally {
    await fs.rm(cacheDirectory, { recursive: true, force: true })
  }
})
const codec = await server.ssrLoadModule('/src/utils/htmlCompact.ts')
const placement = await server.ssrLoadModule('/src/utils/htmlPlacement.ts')
const pageNumbers = await server.ssrLoadModule('/src/utils/pageNumbers.ts')
const historySnapshots = await server.ssrLoadModule('/src/utils/historySnapshots.ts')

// Importing reads only title and script metadata. A detached XML DOM keeps the
// tests inert and never creates a browser/profile, script context or local DB.
class InertDOMParser {
  parseFromString(source) {
    const dom = new XMLDOMParser({ errorHandler: () => undefined }).parseFromString(source.trimStart(), 'text/html')
    return {
      title: dom.getElementsByTagName('title')[0]?.textContent || '',
      querySelectorAll(selector) {
        assert.equal(selector, 'script#slide-studio-document')
        return [...Array.from(dom.getElementsByTagName('script'))].filter(node => node.getAttribute('id') === 'slide-studio-document')
      },
    }
  }
}

const evaluateModule = async (filename, dependencies) => {
  const source = await fs.readFile(path.join(root, filename), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
  const exports = {}
  const require = id => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`)
    return dependencies[id]
  }
  const window = { dispatchEvent() {} }
  new Function('require', 'exports', 'window', 'DOMParser', outputText)(require, exports, window, InertDOMParser)
  return exports
}

const createHarness = async () => {
  let nextId = 0
  let decoder = codec.unpackCompactHtml
  let fontPreparation = Promise.resolve()
  let fonts = []
  let snapshots = 0
  let resets = 0
  const theme = {
    themeColors: ['#1473e6'], backgroundColor: '#fff', fontColor: '#222', fontName: 'Arial',
    outline: { color: '#111', width: 1, style: 'solid' }, shadow: { h: 0, v: 3, blur: 6, color: '#0003' },
  }
  const store = {
    title: 'Original', viewportSize: 1000, viewportRatio: 0.5625, theme, slideIndex: 0,
    slides: [{ id: 'original-slide', elements: [] }],
    $patch(update) {
      Object.assign(this, update)
    },
  }
  const html = await evaluateModule('src/services/htmlDocument.ts', {
    nanoid: { nanoid: () => `test-${++nextId}` },
    '@/utils/htmlPlacement': placement,
    '@/utils/htmlCompact': { unpackCompactHtml: source => decoder(source) },
  })
  class MemoryDatabase {
    version() {
      return { stores() {} }
    }
  }
  const local = await evaluateModule('src/services/localDocument.ts', {
    dexie: { default: MemoryDatabase },
    vue: { reactive: value => value },
    nanoid: { nanoid: () => `test-${++nextId}` },
    'file-saver': { saveAs() {
      throw new Error('Tests must not download files')
    } },
    '@/store': {
      useSlidesStore: () => store,
      useMainStore: () => ({ setActiveElementIdList() {} }),
      useSnapshotStore: () => ({
        initSnapshotDatabase() {
          resets++; return Promise.resolve()
        },
        addSnapshot() {
          snapshots++; return Promise.resolve()
        },
      }),
    },
    '@/utils/localFonts': {
      getEmbeddedFonts: () => fonts,
      async restoreEmbeddedFonts(value) {
        await fontPreparation; fonts = value
      },
    },
    '@/utils/latex': { renderLatex() {
      throw new Error('No standalone formula fixture')
    } },
    '@/utils/inlineMath': { normalizeInlineMathHTML: value => value },
    '@/services/outputFiles': { preloadOutputConfiguration: () => Promise.resolve(), saveOutputFile() {
      throw new Error('Tests must not save user files')
    } },
    '@/utils/imageShadow': { normalizeImageShadow: value => value },
    '@/services/htmlDocument': html,
    '@/utils/pageNumbers': pageNumbers,
    '@/utils/historySnapshots': historySnapshots,
  })
  return {
    html, local, store,
    document: title => ({ title, width: 1000, height: 562.5, theme, slides: [{ id: `${title}-slide`, elements: [] }], embeddedFonts: [] }),
    decodeWith: value => {
      decoder = value
    },
    prepareFontsWith: value => {
      fontPreparation = value
    },
    counts: () => ({ snapshots, resets }),
  }
}

const deferred = () => {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}
const playback = '<!doctype html><html><head><title>Compact player</title></head><body><p>Before &amp; after</p><script>throw new Error("must never execute on import")</script></body></html>'
const nativeHtml = document => '<!doctype html><html><head><title>Native</title></head><body><script id="slide-studio-document" type="application/json">' + JSON.stringify(document).replace(/</g, '\\u003c') + '</script></body></html>'
const pack = (source, editable = false) => codec.packHtmlPresentation(source, { editable, title: '核验' })

test('legacy sync and async imports preserve exact HTML and do not execute JS', async () => {
  const { html } = await createHarness()
  for (const parsed of [html.parseHtmlDocument(playback), await html.parseHtmlDocumentAsync(playback)]) {
    assert.equal(parsed.kind, 'html')
    assert.equal(parsed.title, 'Compact player')
    assert.equal(parsed.slides[0].html.source, playback)
  }
})

test('compact playback expands inertly, and viewport overrides retain expanded source', async () => {
  const { html, local } = await createHarness()
  const compact = await pack(playback)
  const parsed = await html.parseHtmlDocumentAsync(compact)
  assert.equal(parsed.kind, 'html')
  assert.equal(parsed.slides[0].html.source, playback)
  const document = await local.importHtmlDocument(compact, { mode: 'append', viewport: { width: 800, height: 600 } })
  assert.equal(document.slides.length, 2)
  assert.deepEqual(document.slides[1].html, { source: playback, width: 800, height: 600 })
})

test('editable compact restores native document, and replacement keeps load semantics', async () => {
  const harness = await createHarness()
  const source = harness.document('Restored native')
  source.slides[0].elements = [{ id: 'text', type: 'text', left: 10, top: 20, width: 300, height: 60, rotate: 0, content: '<p>Native text</p>' }]
  const compact = await pack(nativeHtml(source), true)
  const parsed = await harness.html.parseHtmlDocumentAsync(compact)
  assert.deepEqual(parsed, { kind: 'document', document: source })
  harness.local.localDocumentState.fileName = 'old.json'
  harness.local.localDocumentState.filePath = '/private/old.json'
  const document = await harness.local.importHtmlDocument(compact, { mode: 'replace' })
  assert.deepEqual(document, source)
  assert.deepEqual(harness.counts(), { snapshots: 0, resets: 1 })
  assert.equal(harness.local.localDocumentState.fileName, '')
  assert.equal(harness.local.localDocumentState.filePath, '')
})

test('corrupted known compact exports reject without changing the current document', async () => {
  const { local, counts } = await createHarness()
  const before = local.getLocalDocument()
  await assert.rejects(local.importHtmlDocument('<!doctype html><script id="slide-studio-compact" type="application/json">{"version":1}</script>'))
  assert.deepEqual(local.getLocalDocument(), before)
  assert.deepEqual(counts(), { snapshots: 0, resets: 0 })
})

test('bounded native compact data can exceed the legacy source limit, while playback keeps the page limit', async () => {
  const harness = await createHarness()
  const document = harness.document('Large native metadata')
  const native = ' '.repeat(100 * 1024 * 1024 + 1) + nativeHtml(document)
  assert.throws(() => harness.html.parseHtmlDocument(native), /100 MiB/)
  // The decoder's own expansion limit is covered in its codec tests. Here its
  // result is injected to exercise the parser boundary without recompressing a
  // 100 MiB fixture or writing any temporary large files.
  harness.decodeWith(() => Promise.resolve(native))
  assert.deepEqual(await harness.html.parseHtmlDocumentAsync('bounded native compact'), { kind: 'document', document })
  harness.decodeWith(() => Promise.resolve(' '.repeat(25 * 1024 * 1024) + playback))
  const before = harness.local.getLocalDocument()
  await assert.rejects(harness.local.importHtmlDocument('bounded playback compact'), /保留重新导入编辑能力/)
  assert.deepEqual(harness.local.getLocalDocument(), before)
})

test('switching documents while decompression waits rejects append and replace', async () => {
  for (const mode of ['append', 'replace']) {
    const harness = await createHarness()
    const decode = deferred()
    harness.decodeWith(() => decode.promise)
    const importing = harness.local.importHtmlDocument('delayed compact input', { mode })
    const rejection = assert.rejects(importing, /文稿已切换/)
    const next = harness.document(`New-${mode}`)
    await harness.local.loadLocalDocument(next)
    decode.resolve(playback)
    await rejection
    assert.deepEqual(harness.local.getLocalDocument(), next)
    assert.deepEqual(harness.counts(), { snapshots: 0, resets: 1 })
  }
})

test('a document switch queued during decompression is checked again before mutation', async () => {
  const harness = await createHarness()
  const decode = deferred()
  const font = deferred()
  harness.decodeWith(() => decode.promise)
  harness.prepareFontsWith(font.promise)
  const importing = harness.local.importHtmlDocument('delayed compact input', { mode: 'append' })
  const rejection = assert.rejects(importing, /文稿已切换/)
  const next = harness.document('Queued switch')
  const loading = harness.local.loadLocalDocument(next)
  decode.resolve(playback)
  // Let import complete parsing and join the queue while the earlier load is
  // still preparing fonts. Its second session check protects this exact race.
  await new Promise(resolve => setImmediate(resolve))
  font.resolve()
  await loading
  await rejection
  assert.deepEqual(harness.local.getLocalDocument(), next)
  assert.deepEqual(harness.counts(), { snapshots: 0, resets: 1 })
})
