/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import ts from 'typescript'

const clone = value => JSON.parse(JSON.stringify(value))
const rows = []
let nextId = 0
const snapshots = {
  async clear() {
    rows.length = 0; nextId = 0
    await Promise.resolve()
  },
  async add(value) {
    const id = ++nextId
    rows.push({ ...clone(value), id })
    return await Promise.resolve(id)
  },
  async update(id, update) {
    Object.assign(rows.find(row => row.id === id), clone(update))
    await Promise.resolve()
  },
  async bulkDelete(ids) {
    for (let index = rows.length - 1; index >= 0; index--) {
      if (ids.includes(rows[index].id)) rows.splice(index, 1)
    }
    await Promise.resolve()
  },
  orderBy(name) {
    assert.equal(name, 'id')
    return { keys: () => Promise.resolve(rows.map(row => row.id)), toArray: () => Promise.resolve(clone(rows)) }
  },
}
const database = { snapshots, transaction: (_mode, _table, operation) => operation() }
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const require = createRequire(import.meta.url)
const { createPinia, setActivePinia } = require('pinia')
const { ref, computed } = require('vue')
const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({
  stdin: {
    contents: "export { default as useSlideHandler } from './src/hooks/useSlideHandler.ts'; export { default as useDragElement } from './src/views/Editor/Canvas/hooks/useDragElement.ts'; export { default as useRotateElement } from './src/views/Editor/Canvas/hooks/useRotateElement.ts'; export { default as useScaleElement } from './src/views/Editor/Canvas/hooks/useScaleElement.ts'; export { useMainStore, useSlidesStore, useSnapshotStore } from './src/store/index.ts'; export { getPageNumberText } from './src/utils/pageNumbers.ts'",
    resolveDir: root,
  },
  absWorkingDir: root, tsconfig: 'tsconfig.app.json', bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'inert-browser-seams', setup(builder) {
    builder.onResolve({ filter: /^@\/(?:utils\/(?:database|message|clipboard)|hooks\/usePasteTextClipboardData)$/ }, args => ({ path: args.path, namespace: 'inert' }))
    builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => {
      if (args.path.endsWith('/database')) return { contents: 'export const db = globalThis.__slideReorderTestDatabase;' }
      if (args.path.endsWith('/message')) return { contents: 'export default { warning() { throw new Error("Unexpected message in reorder test"); } };' }
      if (args.path.endsWith('/clipboard')) return { contents: 'export const copyText = () => { throw new Error("No clipboard access in tests"); }; export const readClipboard = copyText;' }
      return { contents: 'export default () => ({ pasteTextClipboardData() { throw new Error("No clipboard paste in tests"); } });' }
    })
  } }],
})
// Only the database and unused browser seams are substituted. The actual hook,
// debounce/flush coordinator, Pinia stores and serialized history actions run.
globalThis.__slideReorderTestDatabase = database
const sourceModule = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, sourceModule, sourceModule.exports)
delete globalThis.__slideReorderTestDatabase
const { useSlideHandler, useDragElement, useRotateElement, useScaleElement, useMainStore, useSlidesStore, useSnapshotStore, getPageNumberText } = sourceModule.exports
const labels = slides => slides.map(slide => {
  const field = slide.elements.find(element => element.autoPageNumber)
  return [getPageNumberText(field.content), field.autoPageNumber.hidden]
})
const create = async () => {
  setActivePinia(createPinia())
  const slides = useSlidesStore()
  slides.setSlides(['a', 'b', 'c'].map(id => ({ id, elements: [] })))
  slides.setAutomaticPageNumbers({ start: 1, format: 'number', hideOnFirst: true })
  const history = useSnapshotStore()
  await history.initSnapshotDatabase()
  return { slides, history, handler: useSlideHandler() }
}

test('actual thumbnail reorder can be undone immediately and redo restores numbering and cover visibility', async () => {
  const { slides, history, handler } = await create()
  const before = clone(slides.slides)
  handler.sortSlides(0, 2)
  assert.deepEqual(slides.slides.map(slide => slide.id), ['c', 'a', 'b'])
  assert.deepEqual(labels(slides.slides), [['1', true], ['2', false], ['3', false]])
  assert.equal(slides.slideIndex, 0)
  await history.unDo()
  assert.deepEqual(clone(slides.slides), before)
  assert.equal(history.snapshotLength, 2)
  await history.reDo()
  assert.deepEqual(slides.slides.map(slide => slide.id), ['c', 'a', 'b'])
  assert.deepEqual(labels(slides.slides), [['1', true], ['2', false], ['3', false]])
})

test('reorder flushes a pending prior edit into its own undo step without losing the new slide', async () => {
  const { slides, history, handler } = await create()
  handler.createSlide() // Its real history debounce is still pending.
  const inserted = slides.currentSlide.id
  slides.updateSlide({ remark: 'Do not lose this edit before reorder' })
  const edited = clone(slides.slides)
  handler.sortSlides(3, 1)
  assert.deepEqual(slides.slides.map(slide => slide.id), ['a', 'b', 'c', inserted])
  await history.unDo()
  assert.deepEqual(clone(slides.slides), edited)
  assert.equal(slides.slides[1].remark, 'Do not lose this edit before reorder')
  assert.equal(history.snapshotLength, 3)
  await history.unDo()
  assert.deepEqual(slides.slides.map(slide => slide.id), ['a', 'b', 'c'])
  await history.reDo()
  assert.deepEqual(clone(slides.slides), edited)
  await history.reDo()
  assert.deepEqual(slides.slides.map(slide => slide.id), ['a', 'b', 'c', inserted])
  assert.deepEqual(labels(slides.slides), [['1', true], ['2', false], ['3', false], ['4', false]])
})

test('dropping a thumbnail back in the same position creates no history step', async () => {
  const { slides, history, handler } = await create()
  handler.sortSlides(1, 1)
  await history.unDo()
  assert.equal(history.snapshotLength, 1)
  assert.deepEqual(slides.slides.map(slide => slide.id), ['a', 'b', 'c'])
})

test('desktop and mobile transforms preserve the complete hidden cover field while filtering only its view', async () => {
  const surfaces = ['src/views/Editor/Canvas/index.vue', 'src/views/Mobile/MobileEditor/index.vue']
  class Mouse {
    constructor(pageX, pageY) {
      this.pageX = pageX; this.pageY = pageY
    }
  }
  const oldMouseEvent = globalThis.MouseEvent
  const oldDocument = globalThis.document
  globalThis.MouseEvent = Mouse
  globalThis.document = {}
  try {
    for (const filename of surfaces) {
      const component = await fs.readFile(new URL(`../../${filename}`, import.meta.url), 'utf8')
      const script = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
      const ast = ts.createSourceFile(filename, script, ts.ScriptTarget.Latest, true)
      const declaration = name => {
        let found
        const visit = node => {
          if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node
          ts.forEachChild(node, visit)
        }
        visit(ast)
        assert.ok(found, `Missing production canvas binding ${name}`)
        return `const ${found.getText(ast)};`
      }
      const compiledBindings = ts.transpileModule(`${declaration('setLocalElementList')} ${declaration('visibleElements')} setLocalElementList(); return visibleElements;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
      for (const transform of ['drag', 'rotate', 'scale']) {
        const { slides } = await create()
        slides.addElement({ id: 'body', type: 'shape', left: 100, top: 100, width: 150, height: 80, rotate: 0, fill: '#123456', viewBox: [150, 80], path: 'M0 0H150V80H0Z' })
        const hidden = clone(slides.currentSlide.elements.find(element => element.autoPageNumber))
        const elementList = ref([])
        const visibleElements = new Function('currentSlide', 'elementList', 'computed', compiledBindings)(computed(() => slides.currentSlide), elementList, computed)
        assert.equal(elementList.value.length, 2, `${filename} lost the hidden field before editing`)
        assert.deepEqual(visibleElements.value.map(element => element.id), ['body'])
        const body = elementList.value.find(element => element.id === 'body')
        const original = clone(body)
        useMainStore().setActiveElementIdList(['body'])
        const scale = ref(1)
        if (transform === 'drag') useDragElement(elementList, ref([]), scale).dragElement(new Mouse(100, 100), body)
        else if (transform === 'rotate') useRotateElement(elementList, ref({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }), scale).rotateElement(new Mouse(100, 100), body)
        else useScaleElement(elementList, ref([]), scale).scaleElement(new Mouse(250, 180), body, 'right-bottom')
        document.onmousemove(new Mouse(310, 230))
        document.onmouseup(new Mouse(310, 230))
        assert.notDeepEqual(slides.currentSlide.elements.find(element => element.id === 'body'), original, `${transform} did not commit`)
        assert.deepEqual(clone(slides.currentSlide.elements.find(element => element.autoPageNumber)), hidden, `${filename} ${transform} deleted or changed the hidden cover field`)
        // Let this transform's real history debounce settle before changing the
        // active test Pinia. The history itself stays in the in-memory database.
        await new Promise(resolve => setTimeout(resolve, 320))
      }
    }
  }
  finally {
    if (oldMouseEvent === undefined) delete globalThis.MouseEvent
    else globalThis.MouseEvent = oldMouseEvent
    if (oldDocument === undefined) delete globalThis.document
    else globalThis.document = oldDocument
  }
})
