/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const script = source => source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const editor = script(await read('src/views/components/element/ProsemirrorEditor.vue'))
const toolbar = script(await read('src/views/Editor/CanvasTool/index.vue'))
const coordinator = await read('src/utils/prosemirror/inlineEquations.ts')
const hotkeys = await read('src/hooks/useGlobalHotkey.ts')
const declaration = (source, name) => {
  const ast = ts.createSourceFile('production.ts', source, ts.ScriptTarget.Latest, true)
  let found
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `Missing production declaration ${name}`)
  return `const ${found.getText(ast)};`
}
const evaluate = (source, dependencies = {}) => new Function(...Object.keys(dependencies), ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(...Object.values(dependencies))
const isInlineEquationShortcut = evaluate(`${declaration(coordinator, 'isInlineEquationShortcut')} return isInlineEquationShortcut;`)
const keyEvent = (values = {}) => ({
  key: 'e', code: 'KeyE', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false, isComposing: false,
  prevented: 0, stopped: 0,
  preventDefault() {
    this.prevented++
  },
  stopPropagation() {
    this.stopped++
  },
  ...values,
})

// Exercise the actual Vue entry points, rather than only the coordinator after
// a correctly formed request has already reached it.
const editorFixture = (editable = true, requestResult = true) => {
  const requests = [], view = {}
  const handleKeydown = evaluate(`let handlingHistoryKey = false; ${declaration(editor, 'handleKeydown')} return handleKeydown;`, {
    props: { editable }, isInlineEquationShortcut,
    requestInlineEquation: target => {
      requests.push(target); return requestResult
    },
    fontSizeShortcutDirection: () => 0, activeElementIdList: { value: [] },
    handleInput() {}, handleClick() {}, KEYS: { Z: 'Z', Y: 'Y' },
  })
  return { requests, view, handleKeydown }
}

for (const key of ['Process', 'Dead']) {
  test(`the editor handles the physical equation shortcut while IME reports ${key}`, () => {
    for (const modifier of ['metaKey', 'ctrlKey']) {
      const item = editorFixture(), event = keyEvent({ key, isComposing: true, metaKey: false, [modifier]: true })
      assert.equal(item.handleKeydown(item.view, event), true)
      assert.deepEqual(item.requests, [item.view])
      assert.equal(event.prevented, 1)
      assert.equal(event.stopped, 1)
    }
  })
}

test('locked editors and unrelated key combinations remain untouched', () => {
  for (const options of [{ editable: false }, { altKey: false }, { metaKey: false }, { code: 'KeyQ', key: 'q' }]) {
    const item = editorFixture(options.editable ?? true), event = keyEvent(options)
    item.handleKeydown(item.view, event)
    assert.deepEqual(item.requests, [])
    assert.equal(event.prevented, 0)
    assert.equal(event.stopped, 0)
  }
})

test('the editor also accepts a legacy letter event without a physical code', () => {
  const item = editorFixture(), event = keyEvent({ code: '', key: 'E' })
  assert.equal(item.handleKeydown(item.view, event), true)
  assert.deepEqual(item.requests, [item.view])
})

const toolbarFixture = ({ requested = false, synchronous = false, visible = false } = {}) => {
  const target = { latex: 'E=mc^2' }, calls = { request: 0, restore: [] }
  const refs = { latexEditorVisible: { value: visible }, inlineEquationTarget: { value: undefined }, equationValue: { value: '' }, equationRevision: { value: 0 } }
  const api = evaluate(`let equationIdentity = '', restoreEquationFocus; ${declaration(toolbar, 'openEquation')}
    return { openEquation, restore: () => restoreEquationFocus?.(), identity: () => equationIdentity };`, {
    ...refs, isInlineEquationTarget: value => value === target,
    requestInlineEquation: () => {
      calls.request++
      if (synchronous) api.openEquation({ detail: { inlineTarget: target } })
      return requested
    },
    currentEquationIdentity: () => 'epoch:slide', restoreInlineEquationTarget: value => calls.restore.push(value),
  })
  return { ...api, refs, calls, target }
}

test('a queued inline request never opens a standalone formula dialog', () => {
  const item = toolbarFixture({ requested: true })
  item.openEquation()
  assert.equal(item.calls.request, 1)
  assert.equal(item.refs.latexEditorVisible.value, false)
  assert.equal(item.refs.equationRevision.value, 0)
})

test('a synchronous inline event opens exactly one inline dialog instead of falling back', () => {
  const item = toolbarFixture({ requested: true, synchronous: true })
  item.openEquation()
  assert.equal(item.calls.request, 1)
  assert.equal(item.refs.latexEditorVisible.value, true)
  assert.equal(item.refs.inlineEquationTarget.value, item.target)
  assert.equal(item.refs.equationRevision.value, 1)
})

test('a validated inline event fills the dialog and restores the original text target', () => {
  const item = toolbarFixture()
  item.openEquation({ detail: { inlineTarget: item.target } })
  assert.equal(item.calls.request, 0)
  assert.equal(item.refs.inlineEquationTarget.value, item.target)
  assert.equal(item.refs.equationValue.value, 'E=mc^2')
  assert.equal(item.identity(), 'epoch:slide')
  item.restore()
  assert.deepEqual(item.calls.restore, [item.target])
})

test('without a text context the toolbar preserves standalone formula insertion', () => {
  const item = toolbarFixture()
  item.openEquation()
  assert.equal(item.calls.request, 1)
  assert.equal(item.refs.latexEditorVisible.value, true)
  assert.equal(item.refs.inlineEquationTarget.value, undefined)
  assert.equal(item.refs.equationValue.value, '')
  item.restore()
  assert.deepEqual(item.calls.restore, [])
})

test('an open formula dialog ignores a second request', () => {
  const item = toolbarFixture({ visible: true, requested: true })
  item.openEquation()
  assert.equal(item.calls.request, 0)
  assert.equal(item.refs.equationRevision.value, 0)
})

test('the global shortcut leaves ordinary input fields alone but still works on the canvas', () => {
  class Element {
    constructor(field) {
      this.field = field
    }
    closest() {
      return this.field ? this : null
    }
  }
  const events = []
  const handleKeydown = evaluate(`${declaration(hotkeys, 'keydownListener')} return keydownListener;`, {
    Element, window: { dispatchEvent: event => events.push(event.type) },
    ctrlKeyState: { value: false }, shiftKeyState: { value: false }, disableHotkeys: { value: false },
    keyboardStore: { setCtrlKeyState() {}, setShiftKeyState() {}, setSpaceKeyState() {} },
    editorAreaFocus: { value: false }, thumbnailsFocus: { value: false }, fontSizeShortcutDirection: () => 0,
    KEYS: { SPACE: ' ', P: 'P', F5: 'F5', F: 'F', Z: 'Z', Y: 'Y', DIGIT_0: '0' },
  })
  for (const field of ['input', 'textarea', 'select', 'contenteditable']) {
    const event = keyEvent({ target: new Element(field) })
    handleKeydown(event)
    assert.equal(event.prevented, 0)
  }
  assert.deepEqual(events, [])
  const event = keyEvent({ target: new Element(false) })
  handleKeydown(event)
  assert.equal(event.prevented, 1)
  assert.deepEqual(events, ['keynote-local:insert-equation'])
})
