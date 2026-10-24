/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { Schema } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { history, undo, redo } from 'prosemirror-history'

// Run the production session coordinator against actual ProseMirror state.
// A view seam avoids browser/user storage and gives precise stale-view checks.
const source = await readFile(new URL('../../src/utils/prosemirror/inlineEquations.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
  .replace("from 'prosemirror-state'", `from '${import.meta.resolve('prosemirror-state')}'`)
  .replace("from 'prosemirror-history'", `from '${import.meta.resolve('prosemirror-history')}'`)
const {
  registerEquationEditor, captureInlineEquationTarget, isInlineEquationTarget,
  applyInlineEquation, restoreInlineEquationTarget, focusEquationEditor, requestInlineEquation,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    inline_math: { group: 'inline', inline: true, atom: true, attrs: { latex: {} } },
  },
  marks: {
    fontsize: { attrs: { fontsize: {} } },
    forecolor: { attrs: { color: {} } },
    strong: {},
  },
})
const marks = [schema.marks.fontsize.create({ fontsize: '28px' }), schema.marks.forecolor.create({ color: '#336699' }), schema.marks.strong.create()]
const text = (value, styling = []) => schema.text(value, styling)
const equation = (latex, styling = []) => schema.nodes.inline_math.create({ latex }, null, styling)
const documentFor = children => schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, children))
const makeEditor = (doc, { from = 1, to = from, styling, plugins = [], focused = true } = {}) => {
  const calls = { flush: 0, beforeChange: 0, changed: 0, focus: 0, transactions: [], events: [] }
  const current = { identity: 'epoch-1:slide-1:text-1', editable: true, focused }
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, from, to), storedMarks: styling, plugins })
  const view = {
    state,
    isDestroyed: false,
    dom: { isConnected: true, ownerDocument: { defaultView: { dispatchEvent: event => calls.events.push(event) } } },
    hasFocus: () => current.focused,
    focus: () => {
      current.focused = true; calls.focus++
    },
    dispatch: transaction => {
      calls.transactions.push(transaction); view.state = view.state.apply(transaction)
    },
  }
  const unregister = registerEquationEditor({
    view, identity: () => current.identity, editable: () => current.editable,
    flush: () => calls.flush++, beforeChange: () => calls.beforeChange++, changed: () => calls.changed++,
  })
  return { view, current, calls, unregister }
}
const children = doc => [...doc.firstChild.content.content]

test('a captured caret inserts between mixed text and keeps typography for the equation and subsequent typing', () => {
  const fixture = makeEditor(documentFor([text('前文After', marks)]), { from: 3 })
  try {
    const target = captureInlineEquationTarget(fixture.view)
    assert.equal(isInlineEquationTarget(target), true)
    assert.equal(target.latex, '')
    assert.equal(fixture.calls.flush, 1)
    applyInlineEquation(target, String.raw`\frac{x}{y}`)
    assert.deepEqual(children(fixture.view.state.doc).map(node => node.isText ? node.text : node.attrs.latex), ['前文', String.raw`\frac{x}{y}`, 'After'])
    const atom = fixture.view.state.doc.nodeAt(3)
    assert.deepEqual(atom.marks, marks)
    assert.deepEqual(fixture.view.state.storedMarks, marks)
    assert.equal(fixture.view.state.selection.from, 4)
    assert.equal(fixture.calls.beforeChange, 1)
    assert.equal(fixture.calls.changed, 1)
    fixture.view.dispatch(fixture.view.state.tr.insertText('继续'))
    assert.equal(fixture.view.state.doc.nodeAt(4).text, '继续After')
    assert.deepEqual(fixture.view.state.doc.nodeAt(4).marks, marks)
    assert.throws(() => applyInlineEquation(target, 'z'), /文字已改变/)
  }
  finally {
    fixture.unregister()
  }
})

test('selected text is replaced once and explicit pending marks take priority over neighboring text', () => {
  const fixture = makeEditor(documentFor([text('alpha beta gamma')]), { from: 7, to: 11, styling: marks })
  try {
    applyInlineEquation(captureInlineEquationTarget(fixture.view), 'E=mc^2')
    assert.deepEqual(children(fixture.view.state.doc).map(node => node.isText ? node.text : node.attrs.latex), ['alpha ', 'E=mc^2', ' gamma'])
    assert.deepEqual(fixture.view.state.doc.nodeAt(7).marks, marks)
    assert.equal(fixture.view.state.selection.from, 8)
    assert.equal(fixture.view.state.selection.empty, true)
  }
  finally {
    fixture.unregister()
  }
})

test('editing an existing formula preserves its marks and neighbors without inserting a second atom', () => {
  const fixture = makeEditor(documentFor([text('a'), equation('old', marks), text('b')]))
  try {
    const target = captureInlineEquationTarget(fixture.view, 2)
    assert.equal(target.latex, 'old')
    applyInlineEquation(target, 'new')
    assert.deepEqual(children(fixture.view.state.doc).map(node => node.isText ? node.text : node.attrs.latex), ['a', 'new', 'b'])
    assert.deepEqual(fixture.view.state.doc.nodeAt(2).marks, marks)
    assert.equal(fixture.view.state.selection.from, 3)
    assert.equal(captureInlineEquationTarget(fixture.view, 1), undefined)
  }
  finally {
    fixture.unregister()
  }
})

test('a selected formula is captured for editing without an explicit node position', () => {
  const fixture = makeEditor(documentFor([text('a'), equation('x', marks), text('b')]))
  try {
    fixture.view.dispatch(fixture.view.state.tr.setSelection(NodeSelection.create(fixture.view.state.doc, 2)))
    const target = captureInlineEquationTarget(fixture.view)
    assert.equal(target.position, 2)
    assert.equal(target.latex, 'x')
    assert.deepEqual(target.marks, marks)
    applyInlineEquation(target, 'y')
    assert.equal(fixture.view.state.doc.nodeAt(2).attrs.latex, 'y')
    assert.equal(fixture.view.state.doc.firstChild.childCount, 3)
  }
  finally {
    fixture.unregister()
  }
})

test('cancel restores the original backward selection, its typography and focus without changing content', () => {
  const fixture = makeEditor(documentFor([text('abcdef', marks)]), { from: 5, to: 2, styling: marks })
  try {
    const original = fixture.view.state.doc
    const target = captureInlineEquationTarget(fixture.view)
    fixture.view.dispatch(fixture.view.state.tr.setSelection(TextSelection.create(original, 6)))
    fixture.current.focused = false
    assert.equal(restoreInlineEquationTarget(target), true)
    assert.equal(fixture.view.state.doc, original)
    assert.equal(fixture.view.state.selection.anchor, 5)
    assert.equal(fixture.view.state.selection.head, 2)
    // ProseMirror keeps stored marks only for an empty text selection. A range
    // recovers its typography from the preserved document instead.
    assert.equal(fixture.view.state.storedMarks, null)
    assert.deepEqual(fixture.view.state.selection.$from.marks(), marks)
    assert.equal(fixture.calls.focus, 1)
    assert.equal(fixture.calls.beforeChange, 0)
    assert.equal(fixture.calls.changed, 0)
  }
  finally {
    fixture.unregister()
  }
})

test('cancel at a caret restores explicit pending typography without changing neighboring text', () => {
  const fixture = makeEditor(documentFor([text('abcdef')]), { from: 3, styling: marks })
  try {
    const original = fixture.view.state.doc
    const target = captureInlineEquationTarget(fixture.view)
    fixture.view.dispatch(fixture.view.state.tr.setSelection(TextSelection.create(original, 6)))
    assert.equal(restoreInlineEquationTarget(target), true)
    assert.equal(fixture.view.state.selection.from, 3)
    assert.equal(fixture.view.state.doc, original)
    assert.deepEqual(fixture.view.state.storedMarks, marks)
    assert.equal(fixture.calls.changed, 0)
  }
  finally {
    fixture.unregister()
  }
})

test('confirming an unchanged formula preserves the document and history without committing another change', () => {
  const fixture = makeEditor(documentFor([text('a'), equation('x', marks), text('b')]))
  try {
    const original = fixture.view.state.doc
    const target = captureInlineEquationTarget(fixture.view, 2)
    assert.equal(applyInlineEquation(target, 'x'), fixture.view)
    assert.equal(fixture.view.state.doc, original)
    assert.equal(fixture.calls.beforeChange, 0)
    assert.equal(fixture.calls.changed, 0)
    assert.throws(() => applyInlineEquation(target, 'y'), /文字已改变/)
  }
  finally {
    fixture.unregister()
  }
})

test('an equation is its own undo step and can be redone using ProseMirror history', () => {
  const original = documentFor([text('beforeafter')])
  const fixture = makeEditor(original, { from: 7, plugins: [history()] })
  try {
    applyInlineEquation(captureInlineEquationTarget(fixture.view), 'x^2')
    const changed = fixture.view.state.doc
    assert.equal(undo(fixture.view.state, fixture.view.dispatch), true)
    assert.equal(fixture.view.state.doc.eq(original), true)
    assert.equal(redo(fixture.view.state, fixture.view.dispatch), true)
    assert.equal(fixture.view.state.doc.eq(changed), true)
  }
  finally {
    fixture.unregister()
  }
})

test('typing after inserting a formula is undone before the formula and both steps can be redone', () => {
  const original = documentFor([text('beforeafter', marks)])
  const fixture = makeEditor(original, { from: 7, plugins: [history()] })
  try {
    applyInlineEquation(captureInlineEquationTarget(fixture.view), 'x^2')
    const withEquation = fixture.view.state.doc
    fixture.view.dispatch(fixture.view.state.tr.insertText('new words'))
    const withTyping = fixture.view.state.doc
    assert.equal(withTyping.nodeAt(7).attrs.latex, 'x^2')
    assert.equal(withTyping.nodeAt(8).text, 'new wordsafter')

    assert.equal(undo(fixture.view.state, fixture.view.dispatch), true)
    assert.equal(fixture.view.state.doc.eq(withEquation), true)
    assert.equal(fixture.view.state.doc.nodeAt(7).attrs.latex, 'x^2')
    assert.equal(undo(fixture.view.state, fixture.view.dispatch), true)
    assert.equal(fixture.view.state.doc.eq(original), true)
    assert.equal(redo(fixture.view.state, fixture.view.dispatch), true)
    assert.equal(fixture.view.state.doc.eq(withEquation), true)
    assert.equal(redo(fixture.view.state, fixture.view.dispatch), true)
    assert.equal(fixture.view.state.doc.eq(withTyping), true)
  }
  finally {
    fixture.unregister()
  }
})

test('changed identity or document invalidates a pending target instead of writing into another document', () => {
  for (const change of ['identity', 'document']) {
    const fixture = makeEditor(documentFor([text('same-id-text')]))
    try {
      const target = captureInlineEquationTarget(fixture.view)
      if (change === 'identity') fixture.current.identity = 'epoch-2:slide-1:text-1'
      else fixture.view.dispatch(fixture.view.state.tr.insertText('changed'))
      const current = fixture.view.state.doc
      assert.throws(() => applyInlineEquation(target, 'x'), /文字已改变/)
      assert.equal(restoreInlineEquationTarget(target), false)
      assert.equal(fixture.view.state.doc, current)
      assert.equal(fixture.calls.changed, 0)
      assert.equal(fixture.calls.beforeChange, 0)
    }
    finally {
      fixture.unregister()
    }
  }
})

test('destroyed, detached, locked and unregistered editors reject pending targets and new capture', () => {
  for (const change of ['destroyed', 'detached', 'locked', 'unregistered']) {
    const fixture = makeEditor(documentFor([text('original')]))
    try {
      const target = captureInlineEquationTarget(fixture.view)
      if (change === 'destroyed') fixture.view.isDestroyed = true
      if (change === 'detached') fixture.view.dom.isConnected = false
      if (change === 'locked') fixture.current.editable = false
      if (change === 'unregistered') fixture.unregister()
      assert.equal(captureInlineEquationTarget(fixture.view), undefined)
      assert.throws(() => applyInlineEquation(target, 'x'), /文字已改变/)
      assert.equal(restoreInlineEquationTarget(target), false)
      focusEquationEditor(fixture.view)
      assert.equal(fixture.calls.focus, 0)
      assert.equal(fixture.calls.changed, 0)
    }
    finally {
      fixture.unregister()
    }
  }
})

test('only a currently focused editor is captured implicitly; forged targets are not recognized', () => {
  const idle = makeEditor(documentFor([text('old-focus')]), { focused: false })
  const focused = makeEditor(documentFor([text('live-focus')]))
  try {
    assert.equal(captureInlineEquationTarget().editor.view, focused.view)
    focused.current.focused = false
    assert.equal(captureInlineEquationTarget(), undefined)
    assert.equal(isInlineEquationTarget({ editor: idle.view }), false)
    assert.equal(isInlineEquationTarget(null), false)
    assert.equal(isInlineEquationTarget('target'), false)
  }
  finally {
    idle.unregister(); focused.unregister()
  }
})

test('an editor request dispatches the captured target and does not create a fallback request when unavailable', () => {
  const originalCustomEvent = globalThis.CustomEvent
  globalThis.CustomEvent = class {
    constructor(type, options) {
      this.type = type; this.detail = options.detail
    }
  }
  const fixture = makeEditor(documentFor([text('a'), equation('x'), text('b')]))
  try {
    assert.equal(requestInlineEquation(fixture.view, 2), true)
    const event = fixture.calls.events[0]
    assert.equal(event.type, 'keynote-local:insert-equation')
    assert.equal(isInlineEquationTarget(event.detail.inlineTarget), true)
    assert.equal(event.detail.inlineTarget.latex, 'x')
    fixture.current.editable = false
    assert.equal(requestInlineEquation(fixture.view, 2), false)
    assert.equal(fixture.calls.events.length, 1)
  }
  finally {
    fixture.unregister()
    if (originalCustomEvent === undefined) delete globalThis.CustomEvent
    else globalThis.CustomEvent = originalCustomEvent
  }
})
