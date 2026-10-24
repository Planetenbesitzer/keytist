import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model'
import { NodeSelection, TextSelection, type SelectionBookmark } from 'prosemirror-state'
import { closeHistory } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'

interface EquationEditor {
  view: EditorView
  identity: () => string
  editable: () => boolean
  flush: () => void
  beforeChange: () => void
  changed: () => void
}

export interface InlineEquationTarget {
  readonly editor: EquationEditor
  readonly identity: string
  readonly document: ProseMirrorNode
  readonly bookmark: SelectionBookmark
  readonly marks: readonly Mark[]
  readonly position?: number
  readonly latex: string
}

const editors = new Map<EditorView, EquationEditor>()
const targets = new WeakSet<InlineEquationTarget>()

export const registerEquationEditor = (editor: EquationEditor) => {
  editors.set(editor.view, editor)
  return () => editors.delete(editor.view)
}

/** Capture only a live text caret, never a previously focused text object. */
export const captureInlineEquationTarget = (view?: EditorView, position?: number): InlineEquationTarget | undefined => {
  const editor = view ? editors.get(view) : [...editors.values()].find(item => item.view.hasFocus())
  if (!editor || editor.view.isDestroyed || !editor.view.dom.isConnected || !editor.editable()) return undefined
  editor.flush()
  const state = editor.view.state
  const selection = state.selection
  if (position === undefined && selection instanceof NodeSelection && selection.node.type.name === 'inline_math') position = selection.from
  const node = position === undefined ? undefined : state.doc.nodeAt(position)
  if (position !== undefined && node?.type.name !== 'inline_math') return undefined
  const target: InlineEquationTarget = {
    editor, identity: editor.identity(), document: state.doc, bookmark: selection.getBookmark(), position,
    marks: node?.marks || state.storedMarks || selection.$from.marksAcross(selection.$to) || selection.$from.marks(),
    latex: node?.attrs.latex || '',
  }
  targets.add(target)
  return target
}

export const isInlineEquationTarget = (value: unknown): value is InlineEquationTarget =>
  !!value && typeof value === 'object' && targets.has(value as InlineEquationTarget)

export const focusEquationEditor = (view: EditorView) => {
  const editor = editors.get(view)
  if (!editor || view.isDestroyed || !view.dom.isConnected || !editor.editable()) return
  view.focus()
}

const isCurrent = (target: InlineEquationTarget) => {
  const { editor } = target
  return targets.has(target) && editors.get(editor.view) === editor && !editor.view.isDestroyed &&
    editor.view.dom.isConnected && editor.editable() && editor.identity() === target.identity && editor.view.state.doc === target.document
}

export const restoreInlineEquationTarget = (target: InlineEquationTarget) => {
  if (!isCurrent(target)) return false
  const { view } = target.editor
  view.dispatch(view.state.tr.setSelection(target.bookmark.resolve(view.state.doc)).setStoredMarks(target.marks))
  view.focus()
  return true
}

export const applyInlineEquation = (target: InlineEquationTarget, latex: string) => {
  if (!isCurrent(target)) throw new Error('原来的文字已改变，请关闭公式窗口后重新插入。')
  const { editor } = target
  const { view } = editor
  const type = view.state.schema.nodes.inline_math
  if (!type) throw new Error('此文字区域尚不支持行内公式。')
  if (target.position !== undefined && latex === target.latex) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target.position + 1)).setStoredMarks(target.marks))
    targets.delete(target)
    return view
  }
  // Flush earlier typing to its own snapshot before committing the formula.
  editor.beforeChange()
  let transaction = closeHistory(view.state.tr)
  if (target.position !== undefined) {
    transaction = transaction.setNodeMarkup(target.position, type, { latex }, target.marks)
    transaction = transaction.setSelection(TextSelection.create(transaction.doc, target.position + 1))
  }
  else {
    transaction = transaction.setSelection(target.bookmark.resolve(view.state.doc))
    transaction = transaction.replaceSelectionWith(type.create({ latex }, null, target.marks), false)
  }
  transaction.setStoredMarks(target.marks).setMeta('inline-equation', true).scrollIntoView()
  view.dispatch(transaction)
  editor.changed()
  // Subsequent typing belongs to a new undo group, after this atomic insert.
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
  targets.delete(target)
  return view
}

export const requestInlineEquation = (view: EditorView, position?: number) => {
  const target = captureInlineEquationTarget(view, position)
  if (!target) return false
  view.dom.ownerDocument.defaultView?.dispatchEvent(new CustomEvent('keynote-local:insert-equation', { detail: { inlineTarget: target } }))
  return true
}
