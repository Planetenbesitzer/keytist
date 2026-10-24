/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Node 25 exposes a placeholder localStorage without browser methods. Pinia's
// optional devtools must see a harmless in-memory surface in this test process.
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { createPinia, setActivePinia } = createRequire(import.meta.url)('pinia')

const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({
  stdin: { contents: "export * from './src/utils/pageNumbers.ts'; export { useSlidesStore } from './src/store/slides.ts'; export { useSnapshotStore } from './src/store/snapshot.ts'; export { default as useHistorySnapshot } from './src/hooks/useHistorySnapshot.ts'; export { normalizeLocalDocument, setAutomaticPageNumbers, removeAutomaticPageNumbers } from './src/services/localDocument.ts'", resolveDir: root },
  absWorkingDir: root, tsconfig: 'tsconfig.app.json', bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external',
})
// Loading the validator does not open a database or touch a browser profile.
// Its picker capability check only needs the existence of this empty window.
globalThis.window = {}
const sourceModule = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), sourceModule, sourceModule.exports)
const { applyAutoPageNumbers, synchronizeAutoPageNumbers, removeAutoPageNumbers, inheritAutoPageNumbers, getPageNumberText, normalizeAutomaticPageNumberConfig, getAutomaticPageNumberLabel, useSlidesStore, useSnapshotStore, useHistorySnapshot, normalizeLocalDocument, setAutomaticPageNumbers, removeAutomaticPageNumbers } = sourceModule.exports
delete globalThis.window

const config = { start: 1, format: 'number', hideOnFirst: true }
const layout = { width: 1000, height: 562.5, fontName: 'Arial', fontColor: '#32445a' }
const slides = () => Array.from({ length: 4 }, (_, index) => ({ id: `slide-${index}`, elements: [] }))
const fields = pages => pages.map(page => page.elements.find(element => element.type === 'text' && element.autoPageNumber))
const labels = pages => fields(pages).map(element => element && getPageNumberText(element.content))
const clone = value => JSON.parse(JSON.stringify(value))
const footer = (id, content, overrides = {}) => ({ id, type: 'text', content, left: 880, top: 522, width: 60, height: 24, rotate: 0, defaultFontName: 'Arial', defaultColor: '#1d1d1f', ...overrides })
const storeFor = pages => {
  setActivePinia(createPinia())
  const store = useSlidesStore()
  store.setSlides(pages)
  return store
}
const documentFor = pages => ({ title: 'Page number regression', width: layout.width, height: layout.height, theme: { themeColors: ['#fff'], backgroundColor: '#fff', fontName: 'Arial', fontColor: '#000', outline: {}, shadow: {} }, slides: pages, embeddedFonts: [] })

test('cover counts as 1 but is hidden; remaining pages begin at 2 without mutating input', () => {
  const source = slides()
  const before = clone(source)
  const numbered = applyAutoPageNumbers(source, config, layout)
  assert.deepEqual(source, before)
  assert.deepEqual(labels(numbered), ['1', '2', '3', '4'])
  assert.deepEqual(fields(numbered).map(element => element.autoPageNumber.hidden), [true, false, false, false])
  assert.equal(new Set(fields(numbered).map(element => element.id)).size, 4)
})

test('reorder and delete recalculate labels and move cover visibility with physical order', () => {
  const original = applyAutoPageNumbers(slides(), { ...config, format: 'fraction' }, layout)
  const result = synchronizeAutoPageNumbers([original[2], original[0], original[3]])
  assert.deepEqual(labels(result), ['1 / 3', '2 / 3', '3 / 3'])
  assert.deepEqual(fields(result).map(element => element.autoPageNumber.hidden), [true, false, false])
  assert.deepEqual(labels(original), ['1 / 4', '2 / 4', '3 / 4', '4 / 4'])
})

test('formats, custom start and explicit cover visibility are independent', () => {
  assert.equal(getAutomaticPageNumberLabel(2, 4, { ...config, start: 5, format: 'twoDigits' }), '07')
  assert.equal(getAutomaticPageNumberLabel(2, 4, { ...config, start: 5, format: 'fraction' }), '7 / 8')
  const result = applyAutoPageNumbers(slides(), { ...config, hideOnFirst: false }, layout)
  assert.ok(fields(result).every(element => element.autoPageNumber.hidden === false))
})

test('opt-in stale-footer conversion preserves source typography, geometry and IDs', () => {
  const source = slides()
  source[2].elements = [footer('old-footer', '<p style="text-align:right;"><span style="font-size:11px;color:#445566;font-family:Times New Roman;">02</span></p>')]
  const result = applyAutoPageNumbers(source, { ...config, format: 'twoDigits' }, { ...layout, replaceExisting: true })
  const element = fields(result)[2]
  assert.equal(element.id, 'old-footer')
  for (const key of ['left', 'top', 'width', 'height', 'defaultFontName', 'defaultColor']) assert.equal(element[key], source[2].elements[0][key])
  assert.equal(element.content, source[2].elements[0].content.replace('>02<', '>03<'))
  assert.equal(result[2].elements.length, 1)
  assert.equal(source[2].elements[0].autoPageNumber, undefined)
})

test('conversion is opt-in and leaves body equations, years and unrelated footers intact', () => {
  const source = slides()
  source[1].elements = [footer('manual', '<p>2</p>'), footer('year', '<p>2026</p>'), footer('body', '<p>2</p>', { top: 170 }), footer('equation', '<p>E=2</p>'), footer('inline-equation', '<p><span data-inline-math="1"><svg><title>2</title></svg></span></p>')]
  const ordinary = applyAutoPageNumbers(source, config, layout)
  assert.equal(ordinary[1].elements.length, 6)
  assert.ok(ordinary[1].elements.slice(0, 5).every(element => !element.autoPageNumber))
  const converted = applyAutoPageNumbers(source, config, { ...layout, replaceExisting: true })
  assert.equal(fields(converted)[1].id, 'manual')
  assert.ok(converted[1].elements.filter(element => element.id !== 'manual').every(element => !element.autoPageNumber))
})

test('existing automatic fields prevent converting a second nearby manual number', () => {
  const source = applyAutoPageNumbers(slides(), config, layout)
  source[1].elements.unshift(footer('keep-manual', '<p>2</p>'))
  const result = applyAutoPageNumbers(source, config, { ...layout, replaceExisting: true })
  assert.equal(result[1].elements.filter(element => element.autoPageNumber).length, 1)
  assert.equal(result[1].elements[0].autoPageNumber, undefined)
})

test('conversion fills missing fields with body typography, never the cover color', () => {
  const source = slides()
  source[0].elements = [footer('white-cover', '<p><span style="font-size:26px;color:#ffffff;">1</span></p>')]
  source[1].elements = [footer('body-template', '<p><span style="font-size:19px;color:#222222;">2</span></p>', { left: 710, groupId: 'old', link: { type: 'slide', target: 'slide-2' } })]
  const result = applyAutoPageNumbers(source, config, { ...layout, replaceExisting: true })
  const missing = fields(result)[2]
  assert.equal(missing.left, 710)
  assert.match(missing.content, /font-size:19px;color:#222222/)
  assert.equal(getPageNumberText(missing.content), '3')
  assert.equal(missing.groupId, undefined)
  assert.equal(missing.link, undefined)
  assert.notEqual(missing.id, 'body-template')
  assert.equal(fields(result)[0].content, source[0].elements[0].content)
  assert.equal(fields(result)[1].id, 'body-template')
})

test('new native and embedded HTML pages inherit footer style but not group/link', () => {
  const source = applyAutoPageNumbers(slides(), config, layout)
  Object.assign(fields(source)[0], { groupId: 'old-group', link: { type: 'slide', target: source[1].id }, left: 33, top: 510, content: '<p><span style="font-size:18px;color:#bc4567;">1</span></p>' })
  const additions = [{ id: 'new-native', elements: [] }, { id: 'new-html', elements: [], html: { source: '<p>demo</p>' } }]
  const inherited = inheritAutoPageNumbers(additions, source)
  const result = synchronizeAutoPageNumbers([...source, ...inherited])
  assert.deepEqual(labels(result), ['1', '2', '3', '4', '5', '6'])
  for (const element of fields(result).slice(4)) {
    assert.equal(element.left, 33)
    assert.equal(element.groupId, undefined)
    assert.equal(element.link, undefined)
    assert.match(element.content, /font-size:18px;color:#bc4567/)
  }
  assert.deepEqual(additions[0].elements, [])
  assert.equal(result[5].html.source, '<p>demo</p>')
})

test('deleted auto fields stay deleted during sync/reorder and all fields can be removed', () => {
  const source = applyAutoPageNumbers(slides(), config, layout)
  source[1] = { ...source[1], elements: [] }
  assert.equal(fields(synchronizeAutoPageNumbers(source))[1], undefined)
  assert.ok(removeAutoPageNumbers(source).every(slide => slide.elements.length === 0))
  assert.equal(fields(source)[0].autoPageNumber.hidden, true)
})

test('JSON normalization updates stale text before saving/history and retains custom settings', () => {
  const source = applyAutoPageNumbers(slides(), { ...config, format: 'twoDigits' }, layout)
  fields(source)[2].content = '<p><span style="font-size:19px;">old</span></p>'
  fields(source)[0].autoPageNumber.hidden = false
  const document = documentFor(source)
  document.customUserField = { retained: true }
  const normalized = normalizeLocalDocument(JSON.stringify(document))
  assert.deepEqual(labels(normalized.slides), ['01', '02', '03', '04'])
  assert.equal(fields(normalized.slides)[0].autoPageNumber.hidden, true)
  assert.match(fields(normalized.slides)[2].content, /font-size:19px/)
  assert.deepEqual(normalized.customUserField, { retained: true })
  assert.equal(getPageNumberText(fields(source)[2].content), 'old')
  assert.deepEqual(normalizeLocalDocument(JSON.stringify(normalized)), normalized)
})

test('invalid metadata rejects imports without mutating existing source', () => {
  for (const setting of [{ ...config, start: -1 }, { ...config, start: 1.5 }, { ...config, format: 'bad' }, { ...config, hideOnFirst: 'yes' }, { ...config, hidden: 'yes' }]) {
    assert.throws(() => normalizeAutomaticPageNumberConfig(setting))
    const document = documentFor(applyAutoPageNumbers(slides(), config, layout))
    fields(document.slides)[1].autoPageNumber = setting
    const before = clone(document)
    assert.throws(() => normalizeLocalDocument(document))
    assert.deepEqual(document, before)
  }
})

test('ordinary old documents remain byte-for-byte unchanged after normalization', () => {
  const source = documentFor(slides())
  source.slides[1].elements = [footer('legacy', '<p><span style="font-size:12px;">02</span></p>')]
  assert.deepEqual(normalizeLocalDocument(source), source)
})

test('store add/delete/reorder integrates numbering, while undo snapshots preserve opt-out', () => {
  const store = storeFor(slides())
  store.setAutomaticPageNumbers(config)
  const stable = clone(store.slides)
  store.updateSlideIndex(1)
  store.addSlide({ id: 'inserted', elements: [] })
  assert.deepEqual(labels(store.slides), ['1', '2', '3', '4', '5'])
  store.deleteSlide('slide-1')
  assert.deepEqual(labels(store.slides), ['1', '2', '3', '4'])
  store.setSlides([...store.slides].reverse())
  assert.equal(fields(store.slides)[0].autoPageNumber.hidden, true)
  assert.equal(fields(store.slides)[1].autoPageNumber.hidden, false)
  store.setSlides(stable)
  assert.deepEqual(clone(store.slides), stable)
  store.updateSlideIndex(1)
  store.deleteElement(fields(store.slides)[1].id)
  const withoutOne = clone(store.slides)
  store.setSlides(stable)
  store.setSlides(withoutOne)
  assert.equal(fields(store.slides)[1], undefined)
})

test('text formatting retains automation; editing visible number detaches only that field', () => {
  const store = storeFor(applyAutoPageNumbers(slides(), config, layout))
  const field = fields(store.slides)[1]
  store.updateElement({ id: field.id, slideId: 'slide-1', props: { content: '<p><span style="font-size:22px;color:#ff0000;">2</span></p>' } })
  assert.ok(fields(store.slides)[1].autoPageNumber)
  assert.match(fields(store.slides)[1].content, /font-size:22px/)
  store.updateElement({ id: field.id, slideId: 'slide-1', props: { content: '<p>Appendix</p>' } })
  assert.equal(fields(store.slides)[1], undefined)
  assert.equal(store.slides[1].elements[0].content, '<p>Appendix</p>')
  assert.ok(fields(store.slides)[2].autoPageNumber)
  store.removeAutomaticPageNumbers()
  assert.deepEqual(store.slides[1].elements.map(element => element.content), ['<p>Appendix</p>'])
})

test('page-number services await pending typing snapshot before changing the document', async () => {
  const store = storeFor(slides())
  const snapshots = useSnapshotStore()
  const original = snapshots.addSnapshot
  const captured = []
  snapshots.addSnapshot = () => {
    captured.push(clone(store.slides))
    return Promise.resolve()
  }
  try {
    const history = useHistorySnapshot()
    history.addHistorySnapshot()
    await setAutomaticPageNumbers(config)
    assert.equal(captured.length, 2)
    assert.ok(captured[0].every(slide => slide.elements.length === 0))
    assert.deepEqual(labels(captured[1]), ['1', '2', '3', '4'])
    history.addHistorySnapshot()
    await removeAutomaticPageNumbers()
    assert.equal(captured.length, 4)
    assert.deepEqual(labels(captured[2]), ['1', '2', '3', '4'])
    assert.ok(captured[3].every(slide => slide.elements.length === 0))
  }
  finally {
    snapshots.addSnapshot = original
  }
})
