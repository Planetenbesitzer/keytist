/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { Schema, Slice, Fragment } from 'prosemirror-model'
import { EditorState, AllSelection, NodeSelection, TextSelection } from 'prosemirror-state'
import { history, undo, redo } from 'prosemirror-history'

// Exercise the actual selection plugin with ProseMirror's replacement,
// deletion, paste and history implementations, without browser/user storage.
const source = await readFile(new URL('../../src/utils/prosemirror/plugins/textSelection.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replaceAll("from 'prosemirror-state'", `from '${import.meta.resolve('prosemirror-state')}'`)
const { textSelectionPlugin } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', attrs: { align: { default: 'left' } } },
    text: { group: 'inline' },
    inline_math: { group: 'inline', inline: true, atom: true, attrs: { latex: {} } },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    divider: { group: 'block', atom: true },
  },
  marks: {
    strong: {},
    em: {},
    underline: {},
    fontsize: { attrs: { fontsize: {} } },
    fontname: { attrs: { fontname: {} } },
    forecolor: { attrs: { color: {} } },
    link: { attrs: { href: {} }, inclusive: false },
  },
})
const styling = [
  schema.marks.strong.create(), schema.marks.underline.create(),
  schema.marks.fontsize.create({ fontsize: '36px' }),
  schema.marks.fontname.create({ fontname: 'Test Serif' }),
  schema.marks.forecolor.create({ color: '#123456' }),
]
const text = (value, marks = []) => schema.text(value, marks)
const paragraph = (nodes = [], align = 'left') => schema.nodes.paragraph.create({ align }, nodes)
const documentFor = nodes => schema.nodes.doc.create(null, nodes)
const stateFor = doc => EditorState.create({ doc, plugins: [textSelectionPlugin, history()] })
const selectEverything = state => state.apply(state.tr.setSelection(new AllSelection(state.doc)))
const textNodes = doc => {
  const result = []
  doc.descendants(node => {
    if (node.isText) result.push(node)
  })
  return result
}
const expectedMarks = marks => schema.text('x', marks).marks

test('select-all becomes a complete text range and replacement keeps font, size, color and emphasis', () => {
  let state = selectEverything(stateFor(documentFor([paragraph([text('Original styled title', styling)])])))
  assert.equal(state.selection instanceof TextSelection, true)
  assert.equal(state.selection.from, 1)
  assert.equal(state.selection.to, state.doc.content.size - 1)
  state = state.apply(state.tr.insertText('Replacement title'))
  assert.equal(state.doc.textContent, 'Replacement title')
  assert.deepEqual(textNodes(state.doc)[0].marks, expectedMarks(styling))
  state = state.apply(state.tr.insertText('继续输入'))
  assert.equal(state.doc.textContent, 'Replacement title继续输入')
  assert.deepEqual(textNodes(state.doc)[0].marks, expectedMarks(styling))
})

test('deleting all text retains pending typography for subsequent typing', () => {
  let state = selectEverything(stateFor(documentFor([paragraph([text('Erase me', styling)])])))
  state = state.apply(state.tr.deleteSelection())
  assert.equal(state.doc.textContent, '')
  assert.equal(state.selection.empty, true)
  assert.deepEqual(state.storedMarks, expectedMarks(styling))
  state = state.apply(state.tr.insertText('New words'))
  assert.deepEqual(textNodes(state.doc)[0].marks, expectedMarks(styling))
})

for (const backward of [false, true]) {
  test(`${backward ? 'backward' : 'forward'} partial selection is unchanged and only its text is replaced`, () => {
    const doc = documentFor([paragraph([text('before ', []), text('middle', styling), text(' after', [])])])
    let state = stateFor(doc)
    const selection = TextSelection.create(doc, backward ? 14 : 8, backward ? 8 : 14)
    const applied = state.applyTransaction(state.tr.setSelection(selection))
    state = applied.state
    assert.equal(applied.transactions.length, 1, 'The plugin must not append a transaction for a partial text selection')
    assert.equal(state.selection.anchor, selection.anchor)
    assert.equal(state.selection.head, selection.head)
    state = state.apply(state.tr.insertText('new'))
    assert.equal(state.doc.textContent, 'before new after')
    assert.deepEqual(textNodes(state.doc).map(node => node.marks), [[], expectedMarks(styling), []])
  })
}

test('mixed typography inherits the first selected run without merging later styles', () => {
  const secondStyle = [schema.marks.em.create(), schema.marks.fontsize.create({ fontsize: '18px' })]
  let state = selectEverything(stateFor(documentFor([paragraph([text('first', styling), text('second', secondStyle)])])))
  state = state.apply(state.tr.insertText('New'))
  assert.deepEqual(textNodes(state.doc)[0].marks, expectedMarks(styling))
})

test('replacing or deleting a full link keeps typography but does not inherit its hyperlink', () => {
  const linked = [...styling, schema.marks.link.create({ href: 'https://example.test' })]
  for (const deleteFirst of [false, true]) {
    let state = selectEverything(stateFor(documentFor([paragraph([text('Linked text', linked)])])))
    if (deleteFirst) state = state.apply(state.tr.deleteSelection())
    state = state.apply(state.tr.insertText('Ordinary text'))
    assert.deepEqual(textNodes(state.doc)[0].marks, expectedMarks(styling))
    assert.equal(textNodes(state.doc)[0].marks.some(mark => mark.type.name === 'link'), false)
  }
})

test('an empty text document normalizes to a usable caret without an append loop', () => {
  let state = stateFor(documentFor([paragraph()]))
  const result = state.applyTransaction(state.tr.setSelection(new AllSelection(state.doc)))
  state = result.state
  assert.equal(result.transactions.length, 2)
  assert.equal(state.selection instanceof TextSelection, true)
  assert.equal(state.selection.empty, true)
  assert.equal(state.selection.from, 1)
  state = state.apply(state.tr.insertText('First words'))
  assert.equal(state.doc.textContent, 'First words')
})

test('select-all includes an inline equation and inherits its typography on replacement', () => {
  const equation = schema.nodes.inline_math.create({ latex: 'E=mc^2' }, null, styling)
  const doc = documentFor([paragraph([equation, text(' trailing')])])
  let state = selectEverything(stateFor(doc))
  assert.equal(state.selection.from, 1)
  assert.equal(state.selection.to, doc.content.size - 1)
  state = state.apply(state.tr.insertText('Energy'))
  assert.equal(state.doc.textContent, 'Energy')
  assert.equal(state.doc.firstChild.childCount, 1)
  assert.deepEqual(textNodes(state.doc)[0].marks, expectedMarks(styling))
  const atomState = stateFor(doc)
  const selected = atomState.applyTransaction(atomState.tr.setSelection(NodeSelection.create(doc, 1)))
  assert.equal(selected.transactions.length, 1)
  assert.equal(selected.state.selection instanceof NodeSelection, true)
})

test('multiple paragraphs retain the first paragraph alignment and typography after replacement', () => {
  const doc = documentFor([paragraph([text('Heading', styling)], 'center'), paragraph([text('More text')])])
  let state = selectEverything(stateFor(doc))
  assert.equal(state.selection.from, 1)
  assert.equal(state.selection.to, doc.content.size - 1)
  state = state.apply(state.tr.insertText('New heading'))
  assert.equal(state.doc.childCount, 1)
  assert.equal(state.doc.firstChild.attrs.align, 'center')
  assert.equal(state.doc.textContent, 'New heading')
  assert.deepEqual(textNodes(state.doc)[0].marks, expectedMarks(styling))
})

test('select-all inside a list replaces all items while retaining the first item wrapper and style', () => {
  const item = nodes => schema.nodes.list_item.create(null, paragraph(nodes))
  const doc = documentFor([schema.nodes.bullet_list.create(null, [item([text('One', styling)]), item([text('Two')])])])
  let state = selectEverything(stateFor(doc))
  assert.equal(state.selection.from, 3)
  assert.equal(state.selection.to, doc.content.size - 3)
  state = state.apply(state.tr.insertText('New item'))
  assert.equal(state.doc.firstChild.type.name, 'bullet_list')
  assert.equal(state.doc.firstChild.childCount, 1)
  assert.equal(state.doc.textContent, 'New item')
  assert.deepEqual(textNodes(state.doc)[0].marks, expectedMarks(styling))
})

test('undo and redo retain both the replaced document and its typography', () => {
  const doc = documentFor([paragraph([text('Old title', styling)])])
  let state = selectEverything(stateFor(doc))
  state = state.apply(state.tr.insertText('New title'))
  const replaced = state.doc
  const dispatch = tr => state = state.apply(tr)
  assert.equal(undo(state, dispatch), true)
  assert.equal(state.doc.eq(doc), true)
  assert.equal(redo(state, dispatch), true)
  assert.equal(state.doc.eq(replaced), true)
  assert.deepEqual(textNodes(state.doc)[0].marks, expectedMarks(styling))
})

test('rich-text paste preserves the pasted marks instead of inheriting the old text style', () => {
  const pastedStyle = [schema.marks.em.create(), schema.marks.fontsize.create({ fontsize: '18px' })]
  let state = selectEverything(stateFor(documentFor([paragraph([text('Old title', styling)])])))
  const slice = new Slice(Fragment.from(paragraph([text('Pasted words', pastedStyle)])), 0, 0)
  state = state.apply(state.tr.replaceSelection(slice).setMeta('uiEvent', 'paste'))
  assert.equal(state.doc.textContent, 'Pasted words')
  assert.deepEqual(textNodes(state.doc)[0].marks, expectedMarks(pastedStyle))
})

test('block-only documents retain AllSelection when text endpoints do not exist', () => {
  const doc = documentFor([schema.nodes.divider.create()])
  const state = stateFor(doc)
  const result = state.applyTransaction(state.tr.setSelection(new AllSelection(doc)))
  assert.equal(result.transactions.length, 1)
  assert.equal(result.state.selection instanceof AllSelection, true)
})

const inputFixture = ({ partial = false, caret = false, composing = false } = {}) => {
  const doc = documentFor([paragraph([text('Old heading', styling)], 'center'), paragraph([text('More words')])])
  let state = selectEverything(stateFor(doc))
  if (partial || caret) state = state.apply(state.tr.setSelection(TextSelection.create(doc, 2, caret ? 2 : 5)))
  const calls = { preventDefault: 0, dispatch: 0, scroll: false }
  const view = {
    get state() {
      return state
    },
    composing,
    dispatch: transaction => {
      calls.dispatch++
      calls.scroll = transaction.scrolledIntoView
      state = state.apply(transaction)
    },
  }
  const input = changes => {
    const event = {
      inputType: 'insertText', data: 'New words', isComposing: false, cancelable: true,
      preventDefault: () => calls.preventDefault++,
      ...changes,
    }
    return textSelectionPlugin.props.handleDOMEvents.beforeinput(view, event)
  }
  return { view, calls, input }
}

test('cancelable native input replacing a whole multi-paragraph range preserves complete typography', () => {
  const fixture = inputFixture()
  assert.equal(fixture.input({ data: 'Replacement 标题' }), true)
  assert.equal(fixture.calls.preventDefault, 1)
  assert.equal(fixture.calls.dispatch, 1)
  assert.equal(fixture.calls.scroll, true)
  assert.equal(fixture.view.state.doc.childCount, 1)
  assert.equal(fixture.view.state.doc.textContent, 'Replacement 标题')
  assert.equal(fixture.view.state.doc.firstChild.attrs.align, 'center')
  assert.deepEqual(textNodes(fixture.view.state.doc)[0].marks, expectedMarks(styling))
})

for (const [name, setup, event] of [
  ['partial selections', { partial: true }, {}],
  ['a normal typing caret', { caret: true }, {}],
  ['IME input flagged on the event', {}, { isComposing: true }],
  ['an active editor composition', { composing: true }, {}],
  ['composition input events', {}, { inputType: 'insertCompositionText' }],
  ['rich-text paste events', {}, { inputType: 'insertFromPaste' }],
  ['drag-and-drop input', {}, { inputType: 'insertFromDrop' }],
  ['native deletion events', {}, { inputType: 'deleteContentBackward' }],
  ['input without text data', {}, { data: null }],
  ['empty input data', {}, { data: '' }],
  ['noncancelable native input', {}, { cancelable: false }],
]) {
  test(`beforeinput leaves ${name} to the native editor without changing content`, () => {
    const fixture = inputFixture(setup)
    const original = fixture.view.state
    assert.equal(fixture.input(event), false)
    assert.equal(fixture.calls.preventDefault, 0)
    assert.equal(fixture.calls.dispatch, 0)
    assert.equal(fixture.view.state, original)
  })
}
