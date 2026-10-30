/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { Schema } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { selectAll, toggleMark } from 'prosemirror-commands'
import { history, undoDepth } from 'prosemirror-history'

const component = await readFile(new URL('../../src/views/components/element/ProsemirrorEditor.vue', import.meta.url), 'utf8')
const source = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const utilities = await readFile(new URL('../../src/utils/prosemirror/utils.ts', import.meta.url), 'utf8')
const compile = value => ts.transpileModule(value, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const declaration = (value, name) => {
  const ast = ts.createSourceFile('production.ts', value, ts.ScriptTarget.Latest, true)
  let found
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `Missing production declaration ${name}`)
  return `const ${found.getText(ast)};`
}
const watcher = () => {
  const ast = ts.createSourceFile('editor.ts', source, ts.ScriptTarget.Latest, true)
  let callback
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'watch' &&
      node.arguments[0]?.getText(ast).includes('getSnapshotHistoryEpoch()')) callback = node.arguments[1]
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(callback && ts.isArrowFunction(callback), 'Missing production content watcher')
  return callback.getText(ast)
}

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', group: 'block' },
    text: {},
  },
  marks: {
    strong: {},
    em: {},
    underline: {},
    fontname: { attrs: { fontname: {} } },
    fontsize: { attrs: { fontsize: {} } },
    forecolor: { attrs: { color: {} } },
  },
})
const makeDocument = value => schema.node('doc', null, [schema.node('paragraph', null, value ? [schema.text(value)] : [])])
const escapeText = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const serializeDocument = view => view.state.doc.content.content.map(paragraph => `<p>${paragraph.content.content.map(node => escapeText(node.text)).join('')}</p>`).join('')
const normalizeHtmlText = value => value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t\r\n]+/g, ' ').trim()
const load = (value, dependencies) => new Function(...Object.keys(dependencies), compile(value))(...Object.values(dependencies))
const { autoSelectAll, addMark } = load(`${declaration(utilities, 'autoSelectAll')} ${declaration(utilities, 'addMark')} return { autoSelectAll, addMark };`, { selectAll })
const buildWatcher = new Function('environment', 'dependencies', compile(`
  const { editorView, textContent, slidesStore, handleInput, handleClick, createDocument, getEmptyTextMarks, serializeDocument, EditorState } = dependencies;
  let contentEpoch = environment.epoch;
  let contentSlideId = slidesStore.currentSlide?.id;
  const getSnapshotHistoryEpoch = () => environment.epoch;
  ${declaration(source, 'isCurrentContent')}
  const synchronize = ${watcher()};
  return { synchronize, identity: () => ({ contentEpoch, contentSlideId }) };
`))

// The seam deliberately reproduces HTML parsing's whitespace normalization.
// Actual ProseMirror documents, selection mapping, history and format commands
// run unchanged; no browser, user document or storage is touched.
const fixture = ({ text = 'Before  selected words  after ', from = 9, to = 23, styling, focused = false } = {}) => {
  const document = makeDocument(text)
  const calls = { parse: 0, marks: 0, dispatch: 0, reset: 0, cancelInput: 0, cancelClick: 0, focus: 0 }
  const environment = { epoch: 1, focused }
  const state = EditorState.create({ doc: document, selection: TextSelection.create(document, from, to), storedMarks: styling, plugins: [history()] })
  const view = {
    state,
    hasFocus: () => environment.focused,
    updateState: next => {
      calls.reset++; view.state = next
    },
    dispatch: transaction => {
      calls.dispatch++; view.state = view.state.apply(transaction)
    },
    focus: () => {
      calls.focus++; environment.focused = true
    },
  }
  const handleInput = Object.assign(() => {}, { cancel: () => calls.cancelInput++ })
  const handleClick = Object.assign(() => {}, { cancel: () => calls.cancelClick++ })
  const textContent = { value: serializeDocument(view) }
  const slidesStore = { currentSlide: { id: 'slide-1' } }
  const createDocument = value => {
    calls.parse++; return makeDocument(normalizeHtmlText(value))
  }
  const getEmptyTextMarks = value => {
    calls.marks++
    return normalizeHtmlText(value) === '' && value.includes('font-weight:bold') ? [schema.marks.strong.create()] : undefined
  }
  const coordinator = buildWatcher(environment, {
    editorView: view, textContent, slidesStore, handleInput, handleClick,
    createDocument, getEmptyTextMarks, serializeDocument, EditorState,
  })
  const execCommand = load(`${declaration(source, 'execCommand')} return execCommand;`, {
    editorView: view,
    handleElementId: { value: 'text-1' },
    props: { elementId: 'text-1' },
    autoSelectAll, addMark, toggleMark, handleInput, handleClick,
    document: { fonts: { check: () => true } },
    message: { warning: () => assert.fail('The fixture font is available') },
  })
  return { view, calls, environment, textContent, slidesStore, coordinator, synchronize: coordinator.synchronize, createDocument, execCommand }
}
const assertMarkedRange = (doc, from, to, name, expected = true) => {
  for (let pos = 1; pos <= doc.textContent.length; pos++) {
    const present = doc.nodeAt(pos).marks.some(mark => mark.type.name === name)
    assert.equal(present, pos >= from && pos < to ? expected : false, `Unexpected ${name} mark at character ${pos}`)
  }
}

for (const backward of [false, true]) {
  test(`blur echo preserves a ${backward ? 'backward' : 'forward'} range, repeated/trailing spaces and local font changes`, () => {
    const item = fixture(backward ? { from: 23, to: 9 } : {})
    const original = item.view.state
    assert.equal(original.doc.eq(item.createDocument(item.textContent.value)), false, 'This fixture must reproduce the parser mismatch')
    item.calls.parse = 0
    item.synchronize()
    assert.equal(item.view.state, original)
    assert.equal(item.view.state.selection.anchor, backward ? 23 : 9)
    assert.equal(item.view.state.selection.head, backward ? 9 : 23)
    assert.equal(item.calls.parse, 0)
    assert.equal(item.calls.dispatch, 0)
    item.execCommand({ action: { command: 'fontname', value: 'Test Serif' } })
    assert.equal(item.view.state.doc.textContent, original.doc.textContent)
    assertMarkedRange(item.view.state.doc, 9, 23, 'fontname')
    assert.equal(item.view.state.selection.anchor, original.selection.anchor)
    assert.equal(item.view.state.selection.head, original.selection.head)
  })
}

for (const [command, mark] of [['bold', 'strong'], ['em', 'em'], ['underline', 'underline']]) {
  test(`${command} applies to the preserved range and can be toggled off again`, () => {
    const item = fixture()
    const text = item.view.state.doc.textContent
    item.synchronize()
    item.execCommand({ action: { command } })
    assertMarkedRange(item.view.state.doc, 9, 23, mark)
    item.execCommand({ action: { command } })
    assertMarkedRange(item.view.state.doc, 9, 23, mark, false)
    assert.equal(item.view.state.doc.textContent, text)
    assert.equal(item.view.state.selection.from, 9)
    assert.equal(item.view.state.selection.to, 23)
  })
}

test('an echo with empty style attributes preserves caret insertion marks and undo history', () => {
  const styling = [schema.marks.strong.create(), schema.marks.fontsize.create({ fontsize: '28px' })]
  const item = fixture({ from: 9, to: 9, styling })
  item.view.dispatch(item.view.state.tr.insertText('x'))
  item.view.dispatch(item.view.state.tr.setStoredMarks(styling))
  item.textContent.value = serializeDocument(item.view).replace('<p>', '<p style="">')
  const original = item.view.state
  const depth = undoDepth(original)
  assert.ok(depth > 0)
  item.synchronize()
  assert.equal(item.view.state, original)
  assert.deepEqual(item.view.state.storedMarks, styling)
  assert.equal(undoDepth(item.view.state), depth)
  assert.equal(item.calls.parse, 0)
})

test('a real external content change still replaces the editor document', () => {
  const item = fixture()
  item.textContent.value = '<p>External replacement</p>'
  item.synchronize()
  assert.equal(item.view.state.doc.textContent, 'External replacement')
  assert.equal(item.calls.parse, 1)
  assert.equal(item.calls.dispatch, 1)
})

test('focused editor defers incoming content while retaining its live selection', () => {
  const item = fixture({ focused: true })
  const original = item.view.state
  item.textContent.value = '<p>Deferred replacement</p>'
  item.synchronize()
  assert.equal(item.view.state, original)
  assert.equal(item.calls.parse, 0)
  assert.equal(item.calls.dispatch, 0)
})

test('semantically identical external HTML preserves the existing range', () => {
  const item = fixture({ text: 'simple text', from: 2, to: 6 })
  item.textContent.value = '<p data-import="1">simple text</p>'
  const original = item.view.state
  item.synchronize()
  assert.equal(item.view.state, original)
  assert.equal(item.calls.parse, 1)
  assert.equal(item.calls.dispatch, 0)
})

test('empty externally styled text still updates pending insertion marks', () => {
  const item = fixture({ text: '', from: 1, to: 1 })
  item.textContent.value = '<p style="font-weight:bold"></p>'
  item.synchronize()
  assert.equal(item.view.state.doc.textContent, '')
  assert.deepEqual(item.view.state.storedMarks, [schema.marks.strong.create()])
  assert.equal(item.calls.dispatch, 1)
})

for (const change of ['history epoch', 'slide']) {
  test(`${change} changes reset editor state even when focused and the incoming HTML is an exact echo`, () => {
    const item = fixture({ focused: true })
    item.view.dispatch(item.view.state.tr.insertText('x'))
    assert.ok(undoDepth(item.view.state) > 0)
    item.textContent.value = serializeDocument(item.view)
    if (change === 'history epoch') item.environment.epoch++
    else item.slidesStore.currentSlide = { id: 'slide-2' }
    const original = item.view.state
    item.synchronize()
    assert.notEqual(item.view.state, original)
    assert.equal(undoDepth(item.view.state), 0)
    assert.equal(item.calls.reset, 1)
    assert.equal(item.calls.cancelInput, 1)
    assert.equal(item.calls.cancelClick, 1)
    assert.equal(item.calls.parse, 1)
    assert.deepEqual(item.coordinator.identity(), {
      contentEpoch: item.environment.epoch,
      contentSlideId: item.slidesStore.currentSlide.id,
    })
  })
}
