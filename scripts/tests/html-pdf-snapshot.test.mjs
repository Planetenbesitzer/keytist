/* eslint-env node, es2022 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({
  entryPoints: ['src/utils/htmlPdfSnapshot.ts'], absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'raw-snapshot-library', setup(builder) {
    builder.onResolve({ filter: /html-to-image\/dist\/html-to-image\.js\?raw$/ }, () => ({ path: require.resolve('html-to-image/dist/html-to-image.js'), namespace: 'raw-library' }))
    builder.onLoad({ filter: /.*/, namespace: 'raw-library' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }))
  } }],
})
const { buildHtmlPdfSnapshotSource, captureHtmlPdfSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const options = { token: 'isolated-snapshot-token', width: 1, height: 1, pixelRatio: 1 }

function harness(onPost, config = {}) {
  const listeners = new Set(), requests = []
  let decodeCount = 0
  const host = { addEventListener: (_name, callback) => listeners.add(callback), removeEventListener: (_name, callback) => listeners.delete(callback) }
  const frame = {
    isConnected: true, srcdoc: 'independent PDF preview', hasAttribute: name => name === 'sandbox',
    sandbox: { contains: name => name === 'allow-scripts' },
    ownerDocument: { defaultView: host, createElement: () => ({
      naturalWidth: config.naturalWidth ?? 1, naturalHeight: config.naturalHeight ?? 1,
      async decode() {
        decodeCount++; if (config.decodeError) throw new Error('Decoder refused image'); await config.decodePromise
      },
    }) },
    contentWindow: { postMessage(data) {
      requests.push(data); onPost?.(data, api)
    } },
  }
  const api = {
    frame, requests, listeners,
    get decodeCount() {
      return decodeCount
    },
    respond(request, overrides = {}, source = frame.contentWindow) {
      const data = { type: 'keytist:html-pdf-snapshot:response', token: request.token, requestId: request.requestId, dataUrl: png, width: 1, height: 1, ...overrides }
      queueMicrotask(() => {
        for (const callback of listeners) callback({ source, data })
      })
    },
  }
  return api
}

test('only the matching frame, token and request can return a decoded PNG', async () => {
  const h = harness((request, api) => {
    assert.equal(api.listeners.size, 1, 'listen before posting a request')
    api.respond(request, {}, {})
    api.respond(request, { token: 'another-preview' })
    api.respond(request, { requestId: 'an-old-request' })
    api.respond(request)
  })
  assert.deepEqual(await captureHtmlPdfSnapshot(h.frame, options), { dataUrl: png, width: 1, height: 1 })
  assert.equal(h.decodeCount, 1)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.requests[0].type, 'keytist:html-pdf-snapshot:request')
  assert.equal(h.requests[0].pixelRatio, 1)
})

test('wrong image formats, invalid PNG signatures and dimensions fail before decoding', async () => {
  const cases = [
    { dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
    { dataUrl: 'data:image/png;base64,AAAA' },
    { width: 2 }, { height: 2 },
  ]
  const wrongHeader = Buffer.from(png.split(',')[1], 'base64')
  wrongHeader.writeUInt32BE(9000, 16)
  cases.push({ dataUrl: `data:image/png;base64,${wrongHeader.toString('base64')}` })
  for (const reply of cases) {
    const h = harness((request, api) => api.respond(request, reply))
    await assert.rejects(captureHtmlPdfSnapshot(h.frame, options), /无效.*PNG|尺寸/)
    assert.equal(h.decodeCount, 0)
    assert.equal(h.listeners.size, 0)
  }
})

test('a valid header is insufficient when the browser refuses or changes the decoded image', async () => {
  for (const config of [{ decodeError: true }, { naturalWidth: 2 }, { naturalHeight: 2 }]) {
    const h = harness((request, api) => api.respond(request), config)
    await assert.rejects(captureHtmlPdfSnapshot(h.frame, options), /无法完整解码/)
    assert.equal(h.decodeCount, 1)
    assert.equal(h.listeners.size, 0)
  }
})

test('preview errors, navigation and disconnect cannot leave a pending capture', async () => {
  const failure = harness((request, api) => api.respond(request, { error: '网页画布包含跨域图片，无法冻结。' }))
  await assert.rejects(captureHtmlPdfSnapshot(failure.frame, options), /跨域图片/)
  for (const change of [frame => {
    frame.srcdoc = 'different preview'
  }, frame => {
    frame.isConnected = false
  }]) {
    const h = harness((request, api) => {
      change(api.frame); api.respond(request)
    })
    await assert.rejects(captureHtmlPdfSnapshot(h.frame, options), /预览已切换/)
    assert.equal(h.listeners.size, 0)
    assert.equal(h.decodeCount, 0)
  }
  assert.equal(failure.listeners.size, 0)
})

test('timeout and cancellation remove their listeners and never resolve with late images', async () => {
  const timeout = harness()
  await assert.rejects(captureHtmlPdfSnapshot(timeout.frame, { ...options, timeoutMs: 2 }), /超时/)
  assert.equal(timeout.listeners.size, 0)
  const controller = new AbortController(), cancelled = harness()
  const pending = captureHtmlPdfSnapshot(cancelled.frame, { ...options, signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, /取消/)
  cancelled.respond(cancelled.requests[0])
  assert.equal(cancelled.listeners.size, 0)
  assert.equal(cancelled.decodeCount, 0)
})

test('duplicate replies cannot create multiple large image decodes', async () => {
  let resume
  const decodePromise = new Promise(resolve => {
    resume = resolve
  })
  const h = harness((request, api) => {
    api.respond(request); api.respond(request)
  }, { decodePromise })
  const pending = captureHtmlPdfSnapshot(h.frame, options)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.decodeCount, 1)
  resume()
  await pending
  assert.equal(h.listeners.size, 0)
})

test('unsafe sizes or frames are rejected before any message is posted', async () => {
  for (const extra of [{ width: 0 }, { height: NaN }, { width: 10000, height: 10000 }, { pixelRatio: 5 }, { timeoutMs: 0 }, { token: '' }]) {
    const h = harness()
    await assert.rejects(captureHtmlPdfSnapshot(h.frame, { ...options, ...extra }), /无效|过大/)
    assert.equal(h.requests.length, 0)
  }
  for (const change of [frame => {
    frame.isConnected = false
  }, frame => {
    frame.hasAttribute = () => false
  }, frame => {
    frame.sandbox.contains = () => true
  }]) {
    const h = harness(); change(h.frame)
    await assert.rejects(captureHtmlPdfSnapshot(h.frame, options), /参数无效/)
    assert.equal(h.requests.length, 0)
  }
  const controller = new AbortController(); controller.abort()
  const h = harness()
  await assert.rejects(captureHtmlPdfSnapshot(h.frame, { ...options, signal: controller.signal }), /取消/)
  assert.equal(h.requests.length, 0)
})

test('request ids are unique and postMessage failures clean up the request', async () => {
  const a = harness((request, api) => api.respond(request)), b = harness((request, api) => api.respond(request))
  await Promise.all([captureHtmlPdfSnapshot(a.frame, options), captureHtmlPdfSnapshot(b.frame, options)])
  assert.notEqual(a.requests[0].requestId, b.requests[0].requestId)
  const broken = harness(() => {
    throw new Error('Detached target')
  })
  await assert.rejects(captureHtmlPdfSnapshot(broken.frame, options), /无法向网页预览/)
  assert.equal(broken.listeners.size, 0)
})

test('the injected bridge escapes script literals and ignores messages from other sources or tokens', () => {
  let injected = ''
  const previousParser = globalThis.DOMParser
  globalThis.DOMParser = class {
    parseFromString() {
      return { createElement: () => ({ textContent: '' }), head: { appendChild: script => {
        injected = script.textContent
      } }, documentElement: { outerHTML: '<html><head></head><body></body></html>' } }
    }
  }
  try {
    const token = 'safe-token-</script><script>unsafe()</script>'
    buildHtmlPdfSnapshotSource('<!doctype html><html><body>Preview</body></html>', token)
    assert.equal(injected.toLowerCase().includes('</script'), false)
    const listeners = [], replies = []
    const context = { parent: { postMessage: data => replies.push(data) }, addEventListener: (_name, callback) => listeners.push(callback) }
    context.window = context
    const previousLibrary = { existingPageLibrary: true }
    context.htmlToImage = previousLibrary
    context.module = { exports: {} }
    context.exports = context.module.exports
    context.define = () => {
      throw new Error('Do not use the page AMD loader')
    }
    context.define.amd = {}
    vm.runInNewContext(injected, context)
    assert.equal(context.htmlToImage, previousLibrary)
    assert.equal(listeners.length, 1)
    const request = { type: 'keytist:html-pdf-snapshot:request', token, requestId: 'test', width: 0, height: 1, pixelRatio: 1 }
    listeners[0]({ source: {}, data: request })
    listeners[0]({ source: context.parent, data: { ...request, token: 'wrong' } })
    assert.equal(replies.length, 0)
    listeners[0]({ source: context.parent, data: request })
    assert.equal(replies.length, 1)
    assert.match(replies[0].error, /尺寸过大或无效/)
    assert.equal(replies[0].requestId, 'test')
  }
  finally {
    if (previousParser === undefined) delete globalThis.DOMParser
    else globalThis.DOMParser = previousParser
  }
})

test('CSS webfonts and unknown system families keep working when an occluded preview pauses animation frames', async () => {
  let injected = ''
  const previousParser = globalThis.DOMParser
  globalThis.DOMParser = class {
    parseFromString() {
      return { createElement: () => ({ textContent: '' }), head: { appendChild: script => {
        injected = script.textContent
      } }, documentElement: { outerHTML: '<html><head></head><body></body></html>' } }
    }
  }
  try {
    buildHtmlPdfSnapshotSource('<html><body>Snapshot text</body></html>', options.token)
    const variants = ['@font-face{font-family:PreviewOnlyFont;src:url(data:font/woff2;base64,d09GMg==)}', '']
    for (const { fontCss, paused } of variants.flatMap(fontCss => [false, true].map(paused => ({ fontCss, paused })))) {
      const listeners = [], replies = [], svgOptions = []
      let fontCalls = 0, library
      class Element {
        constructor() {
          this.parentElement = null
          this.localName = 'html'
          this.namespaceURI = 'http://www.w3.org/1999/xhtml'
          this.children = []
        } querySelectorAll() {
          return []
        } querySelector() {
          return null
        }
      }
      const root = new Element()
      const context = {
        parent: { postMessage: data => replies.push(data) }, addEventListener: (_name, callback) => listeners.push(callback),
        document: { documentElement: root, fonts: { ready: Promise.resolve() }, querySelectorAll: () => [] },
        getComputedStyle: () => ({ display: 'block', getPropertyValue: () => '' }),
        requestAnimationFrame: callback => paused ? 0 : callback(), setTimeout, clearTimeout, innerWidth: 1, innerHeight: 1,
        Element, HTMLIFrameElement: class {}, HTMLObjectElement: class {}, HTMLEmbedElement: class {},
        HTMLCanvasElement: class {}, HTMLImageElement: class {}, SVGImageElement: class {},
      }
      context.window = context
      root.ownerDocument = context.document
      Object.assign(context.document, { defaultView: context, URL: 'about:srcdoc', baseURI: 'about:srcdoc', styleSheets: [] })
      Object.defineProperty(context, 'htmlToImage', { configurable: true, set: value => {
        library = value
      }, get: () => library && new Proxy(library, { get(target, key) {
        if (key === 'getFontEmbedCSS') {
          return node => {
            assert.equal(node, root); fontCalls++; return Promise.resolve(fontCss)
          }
        }
        if (key === 'toSvg') {
          return (_node, value) => {
            svgOptions.push(value); return Promise.reject(new Error('Stop after SVG font handoff'))
          }
        }
        return target[key]
      } }) })
      vm.runInNewContext(injected, context)
      await listeners[0]({ source: context.parent, data: { type: 'keytist:html-pdf-snapshot:request', ...options, requestId: 'fonts' } })
      assert.equal(fontCalls, 1)
      assert.equal(svgOptions.length, 1)
      assert.equal(svgOptions[0].fontEmbedCSS, fontCss)
      assert.equal(svgOptions[0].skipFonts, true)
      assert.equal(typeof replies[0].error, 'string')
    }
  }
  finally {
    if (previousParser === undefined) delete globalThis.DOMParser
    else globalThis.DOMParser = previousParser
  }
})
