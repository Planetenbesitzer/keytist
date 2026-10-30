/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
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
  rememberInlineEquationTarget, forgetInlineEquationTarget, isInlineEquationShortcut,
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
const makeEditor = (doc, { from = 1, to = from, styling, plugins = [], focused = true, active = true, onBlur } = {}) => {
  const calls = { flush: 0, beforeChange: 0, changed: 0, focus: 0, blur: 0, transactions: [], events: [], focusListeners: new Set() }
  const current = { identity: 'epoch-1:slide-1:text-1', editable: true, focused, active }
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, from, to), storedMarks: styling, plugins })
  const ownerDocument = Object.assign(new EventTarget(), {
    defaultView: { dispatchEvent: event => calls.events.push(event) },
  })
  const addDocumentListener = ownerDocument.addEventListener.bind(ownerDocument)
  const removeDocumentListener = ownerDocument.removeEventListener.bind(ownerDocument)
  ownerDocument.addEventListener = (type, listener, options) => {
    if (type === 'focusin') calls.focusListeners.add(listener)
    addDocumentListener(type, listener, options)
  }
  ownerDocument.removeEventListener = (type, listener, options) => {
    if (type === 'focusin') calls.focusListeners.delete(listener)
    removeDocumentListener(type, listener, options)
  }
  const dom = Object.assign(new EventTarget(), {
    isConnected: true,
    ownerDocument,
    contains: target => target === dom || target?.editorDOM === dom,
    blur: () => {
      calls.blur++; current.focused = false
      onBlur?.(view, current, calls)
    },
  })
  const view = {
    state,
    isDestroyed: false,
    composing: false,
    dom,
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
    active: () => current.active,
    flush: () => calls.flush++, beforeChange: () => calls.beforeChange++, changed: () => calls.changed++,
  })
  return { view, current, calls, unregister }
}
const children = doc => [...doc.firstChild.content.content]
const focusElement = (fixture, kind, inside = false) => {
  const target = {
    editorDOM: inside ? fixture.view.dom : undefined,
    closest: () => ['input', 'textarea', 'select', 'contenteditable'].includes(kind) ? target : null,
  }
  const event = new Event('focusin')
  Object.defineProperty(event, 'target', { value: target })
  fixture.view.dom.ownerDocument.dispatchEvent(event)
}
const withCustomEvent = async operation => {
  const originalCustomEvent = globalThis.CustomEvent
  globalThis.CustomEvent = class {
    constructor(type, options) {
      this.type = type; this.detail = options.detail
    }
  }
  try {
    await operation()
  }
  finally {
    if (originalCustomEvent === undefined) delete globalThis.CustomEvent
    else globalThis.CustomEvent = originalCustomEvent
  }
}

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

test('a remembered blurred caret resumes in the same still-selected text object and retains its range and marks', async () => {
  await withCustomEvent(() => {
    const fixture = makeEditor(documentFor([text('before after', marks)]), { from: 8 })
    try {
      rememberInlineEquationTarget(fixture.view)
      fixture.current.focused = false
      const target = captureInlineEquationTarget()
      assert.equal(target.editor.view, fixture.view)
      assert.equal(target.bookmark.resolve(target.document).from, 8)
      assert.deepEqual(target.marks, marks)
      assert.equal(requestInlineEquation(), true)
      assert.equal(fixture.calls.events.length, 1)
      assert.equal(fixture.calls.events[0].detail.inlineTarget, target)
      applyInlineEquation(target, 'x')
      assert.deepEqual(children(fixture.view.state.doc).map(node => node.isText ? node.text : node.attrs.latex), ['before ', 'x', 'after'])
      assert.deepEqual(fixture.view.state.doc.nodeAt(8).marks, marks)
      assert.equal(captureInlineEquationTarget(), undefined, 'A consumed remembered target cannot be reused')
    }
    finally {
      fixture.unregister()
    }
  })
})

for (const change of ['inactive', 'identity', 'document', 'locked', 'destroyed', 'detached', 'unregistered']) {
  test(`${change} invalidates implicit resumption of a remembered text caret`, () => {
    const fixture = makeEditor(documentFor([text('original')]), { from: 4 })
    try {
      rememberInlineEquationTarget(fixture.view)
      fixture.current.focused = false
      if (change === 'inactive') fixture.current.active = false
      if (change === 'identity') fixture.current.identity = 'epoch-2:slide-2:text-1'
      if (change === 'document') fixture.view.dispatch(fixture.view.state.tr.insertText('changed'))
      if (change === 'locked') fixture.current.editable = false
      if (change === 'destroyed') fixture.view.isDestroyed = true
      if (change === 'detached') fixture.view.dom.isConnected = false
      if (change === 'unregistered') fixture.unregister()
      assert.equal(captureInlineEquationTarget(), undefined)
      assert.equal(fixture.calls.changed, 0)
    }
    finally {
      fixture.unregister()
    }
  })
}

test('forgetting a deselected object prevents its old caret from returning when the same object is selected again', () => {
  const fixture = makeEditor(documentFor([text('old caret')]), { from: 5 })
  try {
    rememberInlineEquationTarget(fixture.view)
    fixture.current.focused = false
    fixture.current.active = false
    forgetInlineEquationTarget(fixture.view)
    fixture.current.active = true
    assert.equal(captureInlineEquationTarget(), undefined)
  }
  finally {
    fixture.unregister()
  }
})

test('forgetting another view does not erase the currently remembered object caret', () => {
  const first = makeEditor(documentFor([text('first')]), { focused: false })
  const second = makeEditor(documentFor([text('second')]), { from: 3 })
  try {
    rememberInlineEquationTarget(second.view)
    second.current.focused = false
    forgetInlineEquationTarget(first.view)
    assert.equal(captureInlineEquationTarget().editor.view, second.view)
  }
  finally {
    first.unregister(); second.unregister()
  }
})

test('an inactive or composing editor cannot replace a remembered caret with a new capture', () => {
  for (const state of ['inactive', 'composing']) {
    const fixture = makeEditor(documentFor([text('new caret')]), { from: 4 })
    try {
      if (state === 'inactive') fixture.current.active = false
      else fixture.view.composing = true
      rememberInlineEquationTarget(fixture.view)
      fixture.current.focused = false
      assert.equal(captureInlineEquationTarget(), undefined)
      assert.equal(fixture.calls.flush, 0)
    }
    finally {
      fixture.unregister()
    }
  }
})

test('composition requests wait for the committed text and latest caret, and repeated requests open only once', async () => {
  await withCustomEvent(async () => {
    const fixture = makeEditor(documentFor([text('abcdef', marks)]), {
      from: 3,
      onBlur: view => {
        setTimeout(() => {
          view.dispatch(view.state.tr.insertText('中文'))
          view.composing = false
          view.dom.dispatchEvent(new Event('compositionend'))
        }, 10)
      },
    })
    try {
      fixture.view.composing = true
      assert.equal(requestInlineEquation(fixture.view), true)
      assert.equal(requestInlineEquation(fixture.view), true)
      assert.equal(fixture.calls.blur, 1)
      assert.equal(fixture.calls.flush, 0, 'Do not capture the uncommitted composition document')
      assert.equal(fixture.calls.events.length, 0)
      await delay(5)
      assert.equal(fixture.calls.events.length, 0)
      await delay(75)
      assert.equal(fixture.calls.events.length, 1)
      assert.equal(fixture.calls.focus, 1)
      const target = fixture.calls.events[0].detail.inlineTarget
      assert.equal(target.document, fixture.view.state.doc)
      assert.equal(target.document.textContent, 'ab中文cdef')
      assert.equal(target.bookmark.resolve(target.document).from, 5)
      applyInlineEquation(target, 'x')
      assert.deepEqual(children(fixture.view.state.doc).map(node => node.isText ? node.text : node.attrs.latex), ['ab中文', 'x', 'cdef'])
      assert.deepEqual(fixture.view.state.doc.nodeAt(5).marks, marks)
    }
    finally {
      fixture.unregister()
    }
  })
})

for (const change of ['inactive', 'identity', 'locked', 'destroyed', 'detached', 'unregistered', 'forgotten']) {
  test(`${change} cancels a waiting composition request without opening a formula or stealing focus`, async () => {
    await withCustomEvent(async () => {
      const fixture = makeEditor(documentFor([text('original')]), {
        from: 4,
        onBlur: view => {
          view.composing = false
          view.dom.dispatchEvent(new Event('compositionend'))
        },
      })
      try {
        fixture.view.composing = true
        assert.equal(requestInlineEquation(fixture.view), true)
        if (change === 'inactive') fixture.current.active = false
        if (change === 'identity') fixture.current.identity = 'epoch-2:slide-2:text-1'
        if (change === 'locked') fixture.current.editable = false
        if (change === 'destroyed') fixture.view.isDestroyed = true
        if (change === 'detached') fixture.view.dom.isConnected = false
        if (change === 'unregistered') fixture.unregister()
        if (change === 'forgotten') {
          fixture.current.active = false
          forgetInlineEquationTarget(fixture.view)
          fixture.current.active = true
        }
        await delay(50)
        assert.equal(fixture.calls.events.length, 0)
        assert.equal(fixture.calls.focus, 0)
        assert.equal(fixture.calls.changed, 0)
        assert.equal(fixture.view.state.doc.textContent, 'original')
      }
      finally {
        fixture.unregister()
      }
    })
  })
}

test('the equation shortcut recognizes physical E with Mac dead keys and Chinese input, or a legacy key without code', () => {
  const base = { code: 'KeyE', key: 'e', metaKey: true, ctrlKey: false, altKey: true }
  for (const override of [{}, { key: 'Dead' }, { key: 'Process' }, { key: '´' }, { metaKey: false, ctrlKey: true }, { code: '', key: 'E' }]) {
    assert.equal(isInlineEquationShortcut({ ...base, ...override }), true, JSON.stringify(override))
  }
  for (const override of [{ altKey: false }, { metaKey: false, ctrlKey: false }, { code: 'KeyF' }, { code: '', key: 'Dead' }]) {
    assert.equal(isInlineEquationShortcut({ ...base, ...override }), false, JSON.stringify(override))
  }
})

test('focusing another input area forgets a blurred caret and cancels a pending composition request', async () => {
  for (const kind of ['input', 'textarea', 'select', 'contenteditable']) {
    const fixture = makeEditor(documentFor([text('original')]), { from: 4 })
    try {
      rememberInlineEquationTarget(fixture.view)
      fixture.current.focused = false
      assert.equal(captureInlineEquationTarget().editor.view, fixture.view)
      focusElement(fixture, kind)
      assert.equal(captureInlineEquationTarget(), undefined, `Do not reuse a caret after focus enters another ${kind}`)
    }
    finally {
      fixture.unregister()
    }
  }
  await withCustomEvent(async () => {
    const fixture = makeEditor(documentFor([text('original')]), {
      onBlur: view => {
        view.composing = false
        view.dom.dispatchEvent(new Event('compositionend'))
      },
    })
    try {
      fixture.view.composing = true
      assert.equal(requestInlineEquation(fixture.view), true)
      focusElement(fixture, 'input')
      await delay(50)
      assert.equal(fixture.calls.events.length, 0)
      assert.equal(fixture.calls.focus, 0)
    }
    finally {
      fixture.unregister()
    }
  })
})

test('ordinary toolbar and same-editor focus preserve the caret, and unregister removes the document focus listener', async () => {
  const fixture = makeEditor(documentFor([text('original')]), { from: 4 })
  try {
    assert.equal(fixture.calls.focusListeners.size, 1)
    rememberInlineEquationTarget(fixture.view)
    fixture.current.focused = false
    focusElement(fixture, 'button')
    assert.equal(captureInlineEquationTarget().editor.view, fixture.view)
    focusElement(fixture, 'contenteditable', true)
    assert.equal(captureInlineEquationTarget().editor.view, fixture.view)
    fixture.unregister()
    assert.equal(fixture.calls.focusListeners.size, 0)
  }
  finally {
    fixture.unregister()
  }
  await withCustomEvent(async () => {
    const pending = makeEditor(documentFor([text('original')]), {
      onBlur: view => {
        view.composing = false
        view.dom.dispatchEvent(new Event('compositionend'))
      },
    })
    try {
      pending.view.composing = true
      requestInlineEquation(pending.view)
      focusElement(pending, 'button')
      await delay(50)
      assert.equal(pending.calls.events.length, 1, 'An ordinary toolbar button must not cancel the requested equation')
    }
    finally {
      pending.unregister()
      assert.equal(pending.calls.focusListeners.size, 0)
    }
  })
})

test('invalid composing editors reject requests before blurring or scheduling work', () => {
  for (const invalid of ['destroyed', 'detached', 'locked']) {
    const fixture = makeEditor(documentFor([text('original')]))
    try {
      fixture.view.composing = true
      if (invalid === 'destroyed') fixture.view.isDestroyed = true
      if (invalid === 'detached') fixture.view.dom.isConnected = false
      if (invalid === 'locked') fixture.current.editable = false
      assert.equal(requestInlineEquation(fixture.view), false)
      assert.equal(fixture.calls.blur, 0)
      assert.equal(fixture.calls.flush, 0)
      assert.equal(fixture.calls.events.length, 0)
    }
    finally {
      fixture.unregister()
    }
  }
})
