/* eslint-env node, es2022 */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({ entryPoints: ['src/utils/htmlViewer.ts'], absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm' })
const { htmlViewerScript, loadViewerFontCss } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const css = '@font-face{font-family:"Fixture";src:url(data:font/woff2;base64,AA==);font-weight:700;font-style:italic;unicode-range:U+20-7E;}'
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject; const promise = new Promise((yes, no) => {
    resolve = yes; reject = no
  }); return { promise, resolve, reject }
}

const fakeDocument = () => {
  const declarations = { fontFamily: '"Fixture"', fontWeight: '700', fontStyle: 'italic', fontStretch: '', getPropertyValue: name => name === 'src' ? 'url(data:font/woff2;base64,AA==)' : name === 'unicode-range' ? 'U+20-7E' : '' }
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.contentWindow = { messages: [], postMessage(data) {
        this.messages.push(data)
      } }; this.isConnected = false
    }
    appendChild(child) {
      this.children.push(child); child.parent = this; child.isConnected = true; return child
    }
    insertBefore(child) {
      return this.appendChild(child)
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.isConnected = false
    }
    setAttribute(name, value) {
      this.attributes[name] = value
    }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback)
    }
    querySelector(selector) {
      const content = this.children.find(child => child.className === 'html-content'); return selector.includes('iframe') ? content?.children.find(child => child.tag === 'iframe') : content
    }
    querySelectorAll() {
      return []
    }
    set textContent(value) {
      this.text = value; if (this.tag === 'style') this.sheet = { cssRules: value ? [{ type: 5, style: declarations }] : [] }
    }
    get textContent() {
      return this.text || ''
    }
  }
  const nodes = new Map(['stage', 'page-number', 'previous', 'next', 'fullscreen', 'print', 'slide-studio-viewer'].map(id => [id, new Element()]))
  const fonts = { ready: Promise.resolve(), values: [], add(face) {
    this.values.push(face)
  } }
  const document = { head: new Element('head'), body: new Element('body'), fonts, images: [], getElementById: id => nodes.get(id), createElement: tag => new Element(tag), addEventListener() {} }
  nodes.get('stage').clientWidth = 1000; nodes.get('stage').clientHeight = 562.5
  return { document, nodes, Element }
}

const viewer = (payload, fontGate) => {
  const environment = fakeDocument(), listeners = new Map(), faces = []
  environment.nodes.get('slide-studio-viewer').textContent = JSON.stringify(payload)
  class Face {
    constructor(family, source, descriptors) {
      this.family = family; this.source = source; this.descriptors = descriptors; faces.push(this)
    }
    load() {
      return fontGate.promise.then(() => this)
    }
  }
  const window = { addEventListener(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn)
  }, removeEventListener(name, fn) {
    listeners.get(name)?.delete(fn)
  } }
  const context = vm.createContext({ document: environment.document, window, FontFace: Face, location: { hash: '' }, history: { replaceState() {} }, setTimeout() {}, requestAnimationFrame: callback => callback(), console })
  vm.runInContext(htmlViewerScript, context)
  return { ...environment, window, listeners, faces, context }
}

test('native pages stay hidden until every declared webfont finishes loading', async () => {
  const gate = deferred(), state = viewer({ width: 1000, height: 562.5, fontCss: css, pages: [{ id: 'native', markup: '' }] }, gate)
  assert.equal(state.nodes.get('stage').children[0].style.visibility, 'hidden')
  assert.equal(state.window.__slideStudioFontStatus.state, 'loading')
  assert.equal(state.faces[0].descriptors.weight, '700')
  assert.equal(state.faces[0].descriptors.style, 'italic')
  gate.resolve(); await tick()
  assert.equal(state.nodes.get('stage').children[0].style.visibility, '')
  assert.equal(state.window.__slideStudioFontStatus.state, 'ready')
  assert.equal(state.document.fonts.values.length, 1)
  assert.equal(state.nodes.get('page-number').textContent, '1 / 1')
})

test('a rejected native font shows an explicit error and never presents fallback text', async () => {
  const gate = deferred(), state = viewer({ width: 1000, height: 562.5, fontCss: css, pages: [{ id: 'native', markup: '' }] }, gate)
  gate.reject(new Error('font resource rejected')); await tick()
  assert.equal(state.window.__slideStudioFontStatus.state, 'error')
  assert.equal(state.nodes.get('stage').children[0].style.visibility, 'hidden')
  assert.match(state.nodes.get('stage').children[1].textContent, /停止展示.*font resource rejected/)
  assert.equal(state.document.fonts.values.length, 0)
})

test('iframe protocol waits for fonts, validates source and token, and restores loaded faces before writing unchanged JS', async () => {
  const original = '<!doctype html><style>body{font-family:Fixture}</style><script>window.originalScript = "kept verbatim"</script>'
  const parentGate = deferred(); parentGate.resolve()
  const state = viewer({ width: 1000, height: 562.5, pages: [{ id: 'web', source: original, fontCss: css, markup: '' }] }, parentGate)
  const frame = state.nodes.get('stage').children[0].children[0].children[0]
  assert.equal(frame.attributes.sandbox, 'allow-scripts allow-forms')
  assert.notEqual(frame.srcdoc, original)
  const probe = frame.srcdoc.match(/<script>([\s\S]*)<\/script>/)[1]
  const child = fakeDocument(), childGate = deferred(), messages = [], childListeners = new Map(), faces = []
  const parent = { postMessage: data => messages.push(data) }
  class Face {
    constructor() {
      faces.push(this)
    } load() {
      return childGate.promise.then(() => this)
    }
  }
  const writes = []
  child.document.open = () => {
    child.document.fonts.values = []
  }
  child.document.write = source => writes.push({ source, loadedFaces: [...child.document.fonts.values] })
  child.document.close = () => {}
  const childWindow = {}, childContext = vm.createContext({ document: child.document, window: childWindow, parent, FontFace: Face, innerWidth: 1000, innerHeight: 563, setTimeout() {}, addEventListener: (name, fn) => childListeners.set(name, fn), removeEventListener: name => childListeners.delete(name) })
  vm.runInContext(probe, childContext)
  await tick(); assert.equal(messages.length, 0); assert.equal(writes.length, 0)
  childGate.resolve(); await tick()
  assert.equal(messages.length, 1); assert.equal(messages[0].fontCount, 1)
  for (const callback of state.listeners.get('message')) callback({ source: frame.contentWindow, data: messages[0] })
  assert.equal(frame.contentWindow.messages.length, 1)
  const sourceMessage = frame.contentWindow.messages[0], receive = childListeners.get('message')
  receive({ source: {}, data: sourceMessage }); assert.equal(writes.length, 0)
  receive({ source: parent, data: { ...sourceMessage, studioSource: 'incorrect' } }); assert.equal(writes.length, 0)
  receive({ source: parent, data: sourceMessage })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].source, original)
  assert.deepEqual(writes[0].loadedFaces, faces)
  assert.equal(childWindow.__slideStudioPreloadedFonts, 1)
  assert.equal(childListeners.has('message'), false)
})

test('font CSS helper removes its parsing stylesheet even when a font rejects', async () => {
  const { document } = fakeDocument(), gate = deferred()
  class Face {
    load() {
      return gate.promise
    }
  }
  const context = vm.createContext({ document, FontFace: Face })
  const operation = vm.runInContext(`(${loadViewerFontCss.toString()})(${JSON.stringify(css)})`, context)
  assert.equal(document.head.children.length, 0)
  gate.reject(new Error('invalid font'))
  await assert.rejects(operation, /invalid font/)
  assert.equal(document.fonts.values.length, 0)
})
