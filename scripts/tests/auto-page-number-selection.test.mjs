/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { computed } from 'vue'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const declaration = (source, name) => {
  const ast = ts.createSourceFile('selection.ts', source, ts.ScriptTarget.Latest, true)
  let found
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `Missing production selection declaration ${name}`)
  return `const ${found.getText(ast)};`
}
const fixture = () => [
  { id: 'cover-page-number', type: 'text', autoPageNumber: { hidden: true }, groupId: 'g' },
  { id: 'ordinary', type: 'text', groupId: 'g' },
  { id: 'visible-page-number', type: 'text', autoPageNumber: { hidden: false } },
  { id: 'locked', type: 'shape', lock: true },
  { id: 'user-hidden', type: 'image' },
]

test('select-all and direct list/animation selection never select the hidden cover field', async () => {
  const currentSlide = { value: { elements: fixture() } }
  const mainStore = {
    hiddenElementIdList: { value: ['user-hidden'] }, handleElementId: { value: '' },
    active: [], setActiveElementIdList(ids) {
      this.active = ids
    },
  }
  const dependencies = {
    pinia: { storeToRefs: value => value },
    '@/store': { useMainStore: () => mainStore, useSlidesStore: () => ({ currentSlide }) },
  }
  const exports = {}
  const source = await fs.readFile(new URL('../../src/hooks/useSelectElement.ts', import.meta.url), 'utf8')
  new Function('require', 'exports', compile(source))(id => {
    assert.ok(id in dependencies, `Unexpected selection dependency ${id}`)
    return dependencies[id]
  }, exports)
  const { selectAllElements, selectElement } = exports.default()
  selectAllElements()
  assert.deepEqual(mainStore.active, ['ordinary', 'visible-page-number'])
  selectElement('cover-page-number')
  assert.deepEqual(mainStore.active, ['ordinary', 'visible-page-number'])
  for (const id of ['locked', 'user-hidden']) {
    selectElement(id)
    assert.deepEqual(mainStore.active, ['ordinary', 'visible-page-number'])
  }
  selectElement('visible-page-number')
  assert.deepEqual(mainStore.active, ['visible-page-number'])
  selectElement('ordinary')
  assert.deepEqual(mainStore.active, ['ordinary'])
})

test('Tab navigation skips hidden cover fields and safely handles a cover with no visible objects', async () => {
  const source = await fs.readFile(new URL('../../src/hooks/useGlobalHotkey.ts', import.meta.url), 'utf8')
  const currentSlide = { value: { elements: fixture().slice(0, 3) } }
  const handleElementId = { value: '' }
  let active = []
  const mainStore = { setActiveElementIdList(ids) {
    active = ids; handleElementId.value = ids[0] || ''
  } }
  const tab = new Function('currentSlide', 'handleElementId', 'mainStore', compile(`${declaration(source, 'tabActiveElement')} return tabActiveElement;`))(currentSlide, handleElementId, mainStore)
  tab()
  assert.deepEqual(active, ['ordinary'])
  tab()
  assert.deepEqual(active, ['visible-page-number'])
  tab()
  assert.deepEqual(active, ['ordinary'])
  handleElementId.value = 'cover-page-number'
  tab()
  assert.deepEqual(active, ['ordinary'])
  currentSlide.value.elements = [fixture()[0]]
  active = []
  handleElementId.value = ''
  tab()
  assert.deepEqual(active, [])
})

test('the layer list and its count exclude a hidden field even inside a group', async () => {
  const component = await fs.readFile(new URL('../../src/views/Editor/SelectPanel.vue', import.meta.url), 'utf8')
  const source = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
  const currentSlide = { value: { elements: fixture() } }
  const get = new Function('currentSlide', 'computed', compile(`${declaration(source, 'visibleElements')} ${declaration(source, 'elements')} return { visibleElements, elements };`))
  const { visibleElements, elements } = get(currentSlide, computed)
  assert.equal(visibleElements.value.length, 4)
  const listedIds = elements.value.flatMap(item => item.type === 'group' ? item.elements.map(element => element.id) : [item.id])
  assert.deepEqual(listedIds, ['ordinary', 'visible-page-number', 'locked', 'user-hidden'])
  assert.deepEqual(elements.value[0].elements.map(element => element.id), ['ordinary'])
})
