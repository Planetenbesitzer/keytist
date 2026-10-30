/* eslint-env node, es2022 */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({ entryPoints: ['src/utils/htmlSnapshotAppearance.ts'], absWorkingDir: repository, bundle: true, write: false, platform: 'node', format: 'esm' })
const { createHtmlSnapshotAppearance } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const html = 'http://www.w3.org/1999/xhtml', svg = 'http://www.w3.org/2000/svg'

class Style {
  values = new Map()
  constructor(values = {}) {
    for (const [name, value] of Object.entries(values)) this.values.set(name, { value, priority: '' })
  }
  [Symbol.iterator]() {
    return this.values.keys()
  }
  getPropertyValue(name) {
    return this.values.get(name)?.value || ''
  }
  setProperty(name, value, priority) {
    this.values.set(name, { value, priority })
  }
  get display() {
    return this.getPropertyValue('display')
  }
  get width() {
    return this.getPropertyValue('width')
  }
  get height() {
    return this.getPropertyValue('height')
  }
  get position() {
    return this.getPropertyValue('position')
  }
}
function element(name, children = [], options = {}) {
  const value = {
    localName: name, namespaceURI: options.namespace || html, nodeType: 1,
    children, parentElement: null, style: new Style(options.style),
    computed: new Style({ display: 'block', 'font-size': '16.34px', ...options.computed }), attributes: options.attributes || {},
    get firstElementChild() {
      return this.children[0] || null
    },
    matches: options.matches || (selector => selector === '*' || selector === name || (name === 'input' && selector === 'input[type="range"]')),
    appendChild(child) {
      child.parentElement = this; this.children.push(child); return child
    },
    remove() {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this)
    },
  }
  for (const child of children) child.parentElement = value
  return value
}
const vector = (name, children = [], options = {}) => element(name, children, { ...options, namespace: svg })
const dump = value => ({ name: value.localName, attributes: value.attributes, style: Object.fromEntries(value.style.values), children: value.children.map(dump) })
function harness(t, source, clone) {
  const document = {
    URL: 'about:srcdoc', baseURI: 'http://localhost/fixture.html', styleSheets: [],
    defaultView: {
      getComputedStyle: node => node.computed,
      matchMedia: media => ({ matches: media !== '(min-width: 9999px)' }),
      CSS: { supports: value => value === 'display: grid' },
    },
  }
  const connect = node => {
    node.ownerDocument = document
    for (const child of node.children) connect(child)
  }
  connect(source)
  const parsed = {
    documentElement: vector('svg', [vector('foreignObject', [clone])]), querySelector: () => null,
    createElementNS: (namespace, name) => element(name, [], { namespace }),
  }
  const oldParser = globalThis.DOMParser, oldSerializer = globalThis.XMLSerializer
  class Parser {
    parseFromString() {
      return parsed
    }
  }
  class Serializer {
    serializeToString() {
      return JSON.stringify(dump(clone))
    }
  }
  globalThis.DOMParser = Parser; globalThis.XMLSerializer = Serializer
  t.after(() => {
    if (oldParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = oldParser
    if (oldSerializer === undefined) delete globalThis.XMLSerializer; else globalThis.XMLSerializer = oldSerializer
  })
  return { document, Parser, Serializer, parsed, capture: () => createHtmlSnapshotAppearance(source)('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E') }
}

test('SVG descendant presentation, exact fractional fonts, markers and hidden nodes survive without changing the live DOM', async t => {
  const sourceText = vector('text', [], { computed: { 'font-size': '100px', 'font-family': '"Times New Roman"', fill: '#233dc3', 'text-anchor': 'middle' } })
  const sourcePath = vector('path', [], { computed: { fill: 'none', stroke: '#233447', 'stroke-width': '1.6px', 'marker-end': 'url("about:srcdoc#tip")' }, attributes: { d: 'M12 2Q0 64 12 126' } })
  const hidden = vector('g', [vector('path')], { computed: { display: 'none' } })
  const source = element('div', [vector('svg', [sourceText, sourcePath, hidden]), element('span', [], { computed: { 'font-size': '27.625px' } })])
  const cloneText = vector('text'), clonePath = vector('path', [], { attributes: { d: sourcePath.attributes.d } }), cloneHidden = vector('g', [vector('path')])
  const clone = element('div', [vector('svg', [cloneText, clonePath, cloneHidden]), element('span', [], { style: { 'font-size': '26.9px', 'background-image': 'url("data:image/png;base64,AA==")' } }), element('style')])
  const env = harness(t, source, clone), before = JSON.stringify(dump(source))
  await env.capture()
  assert.equal(cloneText.style.getPropertyValue('font-size'), '100px')
  assert.equal(cloneText.style.getPropertyValue('font-family'), '"Times New Roman"')
  assert.equal(cloneText.style.getPropertyValue('fill'), '#233dc3')
  assert.equal(clonePath.style.getPropertyValue('fill'), 'none')
  assert.equal(clonePath.style.getPropertyValue('stroke-width'), '1.6px')
  assert.equal(clonePath.style.getPropertyValue('marker-end'), 'url("#tip")')
  assert.equal(clonePath.attributes.d, sourcePath.attributes.d)
  assert.equal(cloneHidden.style.getPropertyValue('display'), 'none')
  assert.equal(clone.children[1].style.getPropertyValue('font-size'), '27.625px')
  assert.equal(clone.children[1].style.getPropertyValue('background-image'), 'url("data:image/png;base64,AA==")')
  assert.equal(cloneText.style.values.get('font-size').priority, 'important')
  assert.equal(cloneText.style.getPropertyValue('animation'), 'none')
  assert.equal(JSON.stringify(dump(source)), before)
})

test('source filtering mirrors the library, controls retain custom properties and SVG source sheets are removed after pairing', async t => {
  const source = element('div', [element('style'), element('div', [], { computed: { display: 'none' } }), element('input', [], { computed: { '--fill': '72%', '--slider-color': '#ff0000' } }), vector('svg', [vector('style'), vector('text')])])
  const clone = element('div', [element('input'), vector('svg', [vector('style'), vector('text')])])
  const env = harness(t, source, clone)
  await env.capture()
  assert.equal(clone.children[0].style.getPropertyValue('--fill'), '72%')
  assert.equal(clone.children[0].style.getPropertyValue('--slider-color'), '#ff0000')
  assert.deepEqual(clone.children[1].children.map(child => child.localName), ['text'])
})

test('canvas substitution and library-inserted hidden symbol definitions keep source-to-clone alignment', async t => {
  const source = element('div', [element('canvas', [], { computed: { 'font-size': '13.75px' } }), vector('svg', [vector('use')])])
  const extra = element('svg', [element('defs')], { style: { display: 'none', width: '0px', height: '0px', position: 'absolute' } })
  const clone = element('div', [element('img'), vector('svg', [vector('use'), extra])])
  const env = harness(t, source, clone)
  await env.capture()
  assert.equal(clone.children[0].style.getPropertyValue('font-size'), '13.75px')
  assert.equal(clone.children[1].children[0].style.getPropertyValue('font-size'), '16.34px')
})

test('the serialized factory has no module dependencies and uses styles recorded before asynchronous cloning', async t => {
  const text = vector('text', [], { computed: { 'font-size': '100px' } })
  const source = element('div', [vector('svg', [text])]), clone = element('div', [vector('svg', [vector('text')])])
  const env = harness(t, source, clone)
  const factory = vm.runInNewContext(`(${createHtmlSnapshotAppearance.toString()})`, { DOMParser: env.Parser, XMLSerializer: env.Serializer, URL, fetch, btoa, Uint8Array })
  const restore = factory(source)
  text.computed.setProperty('font-size', '10px', '')
  await restore('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
  assert.equal(clone.children[0].children[0].style.getPropertyValue('font-size'), '100px')
})

test('a changed clone structure fails explicitly instead of applying appearance to the wrong element', async t => {
  const source = element('div', [vector('svg', [vector('text')])]), clone = element('div', [vector('svg', [vector('path')])])
  const env = harness(t, source, clone)
  await assert.rejects(env.capture(), /网页结构在冻结时发生变化/)
})

test('an original hidden zero-size nested SVG is retained and canvas fallback children do not require clone counterparts', async t => {
  const hidden = vector('svg', [vector('defs')], { computed: { display: 'none' }, style: { display: 'none', width: '0px', height: '0px', position: 'absolute' } })
  const source = element('div', [vector('svg', [hidden]), element('canvas', [element('span')])])
  const cloneHidden = vector('svg', [vector('defs')], { style: { display: 'none', width: '0px', height: '0px', position: 'absolute' } })
  const clone = element('div', [vector('svg', [cloneHidden]), element('img')])
  const env = harness(t, source, clone)
  await env.capture()
  assert.equal(clone.children[0].children.length, 1)
  assert.equal(cloneHidden.style.getPropertyValue('display'), 'none')
  assert.equal(cloneHidden.children.length, 1)
})

test('shadow children and assigned slot nodes follow the library flattening order', async t => {
  const assigned = vector('svg', [vector('text', [], { computed: { 'font-size': '73.625px' } })])
  const slot = element('slot')
  slot.assignedNodes = () => [assigned]
  const source = element('div', [element('span')])
  source.shadowRoot = { children: [slot] }
  const clone = element('div', [element('slot', [vector('svg', [vector('text')])])])
  const env = harness(t, source, clone)
  await env.capture()
  assert.equal(clone.children[0].children[0].children[0].style.getPropertyValue('font-size'), '73.625px')
})

const skin = (selector, declarations, parentStyleSheet) => ({ type: 1, selectorText: selector, style: { cssText: declarations }, cssText: `${selector}{${declarations}}`, parentStyleSheet })
const sheet = (cssRules, href = 'http://localhost/styles/base.css') => ({ cssRules, href, media: { mediaText: '' } })

test('only matching native skin rules from active media, supports, imports and layers are retained', async t => {
  const source = element('div', [element('input')]), clone = element('div', [element('input')])
  const env = harness(t, source, clone)
  const selector = 'input[type="range"]::-webkit-slider-thumb'
  env.document.styleSheets = [sheet([
    skin('body', 'background-image:url(ordinary-page-image.png)'),
    { type: 5, cssText: '@font-face{src:url(unrelated-font.woff2)}' },
    skin('textarea::-webkit-slider-thumb', 'color:orange'),
    { type: 4, conditionText: '(min-width: 9999px)', cssRules: [skin(selector, 'color:green')] },
    { type: 4, conditionText: '(min-width: 1px)', cssRules: [skin(selector, 'border-color:red')] },
    { type: 12, conditionText: 'display: grid', cssRules: [skin(selector, 'width:17px')] },
    { type: 12, conditionText: 'display: unsupported', cssRules: [skin(selector, 'height:99px')] },
    { type: 3, layerName: 'imported', media: { mediaText: 'all' }, styleSheet: sheet([skin(selector, 'border-radius:50%')], 'http://localhost/skins/imported.css') },
    { type: 0, cssText: '@layer base, overrides;' },
    { type: 0, cssText: '@layer overrides {}', cssRules: [skin(selector, 'background:#ff0000!important')] },
  ])]
  await env.capture()
  const css = clone.children.at(-1).textContent
  assert.match(css, /border-color:red/)
  assert.match(css, /width:17px/)
  assert.match(css, /@layer imported\{/)
  assert.match(css, /@layer base, overrides;/)
  assert.match(css, /@layer overrides\{input/)
  assert.match(css, /background:#ff0000!important/)
  assert.match(css, /animation:none!important;transition:none!important/)
  assert.doesNotMatch(css, /ordinary-page-image|unrelated-font|orange|green|99px/)
})

test('skin URLs use their original stylesheet base and only selected skin assets are fetched once', async t => {
  const oldFetch = globalThis.fetch, requested = []
  globalThis.fetch = url => {
    requested.push(url)
    return Promise.resolve(new Response(new Blob(['<svg/>'], { type: 'image/svg+xml' }), { status: 200 }))
  }
  t.after(() => {
    globalThis.fetch = oldFetch 
  })
  const source = element('div', [element('input')]), clone = element('div', [element('input')])
  const env = harness(t, source, clone)
  const parent = { href: 'http://localhost/skins/current.css' }
  env.document.styleSheets = [sheet([
    skin('input::-webkit-slider-thumb', 'background-image:url("thumb.svg");mask-image:url(thumb.svg);filter:url(filters.svg#skin)', parent),
    skin('body', 'background-image:url(ignored.png)'),
  ])]
  await env.capture()
  assert.deepEqual(requested, ['http://localhost/skins/thumb.svg', 'http://localhost/skins/filters.svg#skin'])
  const css = clone.children.at(-1).textContent
  assert.match(css, /data:image\/svg\+xml;base64,/)
  assert.match(css, /filter:url\("data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+#skin"\)/)
  assert.doesNotMatch(css, /url\("?thumb\.svg|ignored\.png/)
})

test('an unreadable active control stylesheet or failed skin asset refuses a misleading successful capture', async t => {
  const source = element('div', [element('input')]), clone = element('div', [element('input')])
  const env = harness(t, source, clone)
  env.document.styleSheets = [{ get cssRules() {
    throw new Error('Cross-origin stylesheet') 
  } }]
  assert.throws(() => createHtmlSnapshotAppearance(source), /网页控件的样式表无法读取/)
  env.document.styleSheets = [sheet([skin('input::-webkit-slider-thumb', 'background-image:url(missing.png)')])]
  const oldFetch = globalThis.fetch
  globalThis.fetch = () => Promise.resolve(new Response('Unavailable', { status: 404 }))
  t.after(() => {
    globalThis.fetch = oldFetch 
  })
  await assert.rejects(env.capture(), /网页样式素材无法读取/)
})

test('unrelated unreadable stylesheets impose no new font or image requirement when there are no controls', async t => {
  const source = element('div', [vector('svg', [vector('text')])]), clone = element('div', [vector('svg', [vector('text')])])
  const env = harness(t, source, clone)
  env.document.styleSheets = [{ get cssRules() {
    throw new Error('Not needed for a native control') 
  } }]
  await env.capture()
  assert.equal(clone.children.length, 1)
})
