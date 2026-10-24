/* eslint-env node, es2020 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-html-test-'))
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
const { getHtmlPlacement, getHtmlPlacementTransform, HTML_MIN_SCALE, HTML_MAX_SCALE } = await server.ssrLoadModule('/src/utils/htmlPlacement.ts')
const { normalizeHtmlSlide } = await server.ssrLoadModule('/src/services/htmlDocument.ts')
const { htmlViewerScript } = await server.ssrLoadModule('/src/utils/htmlViewer.ts')

test('legacy HTML stays full-slide, and placement survives a JSON round trip without rewriting source', () => {
  const source = '<!doctype html><html><body><canvas></canvas><script>window.example = "<unmodified>"</script></body></html>'
  const legacy = { source, width: 800, height: 600 }
  assert.deepEqual(normalizeHtmlSlide(legacy), legacy)
  assert.deepEqual(getHtmlPlacement(legacy), { left: 0, top: 0, scale: 1 })
  assert.equal(getHtmlPlacementTransform(legacy), 'translate(0px, 0px) scale(1)')
  const placed = { ...legacy, left: -150.25, top: 80.5, scale: 0.375, extension: { retained: true } }
  const original = JSON.stringify(placed)
  assert.deepEqual(normalizeHtmlSlide(JSON.parse(original)), placed)
  assert.equal(JSON.stringify(placed), original)
  assert.equal(getHtmlPlacementTransform(placed), 'translate(-150.25px, 80.5px) scale(0.375)')
})

test('placement rejects invalid geometry while accepting negative offsets and both scale limits', () => {
  const source = '<p>Page</p>'
  for (const field of ['left', 'top']) {
    for (const value of [NaN, Infinity, -Infinity, '1', null]) assert.throws(() => normalizeHtmlSlide({ source, [field]: value }))
  }
  for (const scale of [0, -1, NaN, Infinity, '1', null, HTML_MIN_SCALE - 0.001, HTML_MAX_SCALE + 0.001]) {
    assert.throws(() => normalizeHtmlSlide({ source, scale }))
  }
  for (const scale of [HTML_MIN_SCALE, HTML_MAX_SCALE]) {
    assert.equal(normalizeHtmlSlide({ source, left: -1000, top: 0, scale }).scale, scale)
  }
})

// Run the standalone viewer itself against a minimal DOM, so its page switching,
// trusted viewport probe and placement serialization are tested together.
const createViewer = payload => {
  const listeners = new Map()
  const nodes = new Map()
  const events = () => new Map()
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag
      this.style = {}
      this.dataset = {}
      this.children = []
      this.attributes = {}
      this.listeners = events()
      this.contentWindow = {}
      this.isConnected = false
      this.classList = { add() {}, remove() {} }
    }
    set srcdoc(value) {
      this.source = value
      const match = value.match(/studioViewport:("[^"]+")/)
      if (match) {
        queueMicrotask(() => {
          for (const listener of listeners.get('message') || []) {
            listener({
              source: this.contentWindow,
              data: { studioViewport: JSON.parse(match[1]), width: Math.round(Number(this.width)), height: Math.round(Number(this.height)) },
            })
          }
        })
      }
      else queueMicrotask(() => this.listeners.get('load')?.())
    }
    get srcdoc() {
      return this.source
    }
    appendChild(child) {
      this.children.push(child); child.parent = this; child.isConnected = true; return child
    }
    insertBefore(child) {
      this.children.unshift(child); child.parent = this; child.isConnected = true; return child
    }
    get firstChild() {
      return this.children[0]
    }
    setAttribute(name, value) {
      this.attributes[name] = value
    }
    addEventListener(name, fn) {
      this.listeners.set(name, fn)
    }
    querySelector(selector) {
      if (selector === ':scope > .html-content') return this.children.find(child => child.className === 'html-content')
      if (selector === ':scope > .html-content > iframe') return this.querySelector(':scope > .html-content')?.children.find(child => child.tagName === 'iframe')
      return undefined
    }
    querySelectorAll() {
      return []
    }
    remove() {
      this.parent.children = this.parent.children.filter(child => child !== this); this.isConnected = false
    }
  }
  for (const id of ['stage', 'page-number', 'previous', 'next', 'fullscreen', 'print', 'slide-studio-viewer']) nodes.set(id, new Element())
  const stage = nodes.get('stage')
  stage.clientWidth = payload.width
  stage.clientHeight = payload.height
  nodes.get('slide-studio-viewer').textContent = JSON.stringify(payload)
  const document = {
    getElementById: id => nodes.get(id), createElement: tag => new Element(tag),
    addEventListener() {}, fonts: { ready: Promise.resolve() }, images: [], body: new Element(),
  }
  const window = {
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn)
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn)
    },
  }
  vm.runInNewContext(htmlViewerScript, {
    document, window, location: { hash: '' }, history: { replaceState() {} }, console,
    setTimeout() {}, requestAnimationFrame: callback => callback(),
  })
  return { stage, nodes }
}

test('published HTML preserves placement, source viewport, sandbox and page switching', async () => {
  const source = '<!doctype html><script>window.demoRuns = (window.demoRuns || 0) + 1</script>'
  const payload = {
    width: 1000, height: 562.5,
    pages: [
      { id: 'legacy', source, markup: '' },
      { id: 'moved', source, width: 800, height: 600, left: 200, top: -30, scale: 0.5, markup: '' },
    ],
  }
  const { stage, nodes } = createViewer(payload)
  await new Promise(resolve => setImmediate(resolve))
  let content = stage.children[0].querySelector(':scope > .html-content')
  let frame = content.children[0]
  assert.match(content.style.cssText, /width:1000px;height:562.5px/)
  assert.match(content.style.cssText, /transform:translate\(0px, 0px\) scale\(1\)/)
  assert.equal(frame.width, '1000')
  assert.equal(frame.height, '562.5')
  assert.equal(frame.srcdoc, source)
  assert.equal(frame.attributes.sandbox, 'allow-scripts allow-forms')

  nodes.get('next').listeners.get('click')()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stage.children[0].querySelector(':scope > .html-content'), undefined)
  content = stage.children[1].querySelector(':scope > .html-content')
  frame = content.children[0]
  assert.match(content.style.cssText, /transform:translate\(200px, -30px\) scale\(0.5\)/)
  assert.equal(frame.width, '800')
  assert.equal(frame.height, '600')
  assert.match(frame.style.cssText, /left:125px;top:0px;width:800px;height:600px;transform:scale\(0.9375\)/)
  assert.equal(frame.srcdoc, source)
  assert.equal(frame.attributes.sandbox.includes('allow-same-origin'), false)

  nodes.get('previous').listeners.get('click')()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stage.children[1].querySelector(':scope > .html-content'), undefined)
  assert.equal(stage.children[0].children.length, 1)
  assert.equal(stage.children[0].querySelector(':scope > .html-content').children[0].width, '1000')
})
