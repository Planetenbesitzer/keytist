import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { closeHistory } from 'prosemirror-history'

export type FontSizeDirection = 1 | -1

/** Command-plus is a text command. Shift-Command-< / > remain canvas zoom. */
export const fontSizeShortcutDirection = (event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>): FontSizeDirection | 0 => {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey) return 0
  if (event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '+' || event.key === '=') return 1
  if (event.code === 'Minus' || event.code === 'NumpadSubtract' || event.key === '-') return -1
  return 0
}

const steppedSize = (value: string | undefined, direction: FontSizeDirection) => {
  const match = /^(\d+(?:\.\d+)?)(px|pt)?$/.exec(value ?? '')
  const size = match ? Number(match[1]) : 16
  const unit = match?.[2] ?? 'px'
  return `${Math.max(1, Math.round((size + direction) * 100) / 100)}${unit}`
}

const markSize = (marks: readonly Mark[]) => marks.find(mark => mark.type.name === 'fontsize')?.attrs.fontsize as string | undefined

const inheritedSize = (doc: ProseMirrorNode, pos: number) => {
  const parent = doc.resolve(pos)
  for (let depth = parent.depth; depth > 0; depth--) {
    if (parent.node(depth).attrs.fontsize) return parent.node(depth).attrs.fontsize as string
  }
  return undefined
}

/** Keep every run's own size: a 20/32 selection becomes 21/33, not 21/21.
 * With a caret, only the pending typing mark changes. With wholeDocument,
 * the editor's stale text selection is deliberately ignored for object mode. */
export const changeFontSize = (
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  direction: FontSizeDirection,
  wholeDocument = false,
): boolean => {
  const type = state.schema.marks.fontsize
  if (!type) return false
  const { selection } = state
  const transaction = closeHistory(state.tr)

  if (selection.empty && !wholeDocument) {
    const marks = state.storedMarks ?? selection.$from.marks()
    const size = markSize(marks) ?? inheritedSize(state.doc, selection.from)
    transaction.addStoredMark(type.create({ fontsize: steppedSize(size, direction) }))
  }
  else {
    const from = wholeDocument ? 0 : selection.from
    const to = wholeDocument ? state.doc.content.size : selection.to
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isText || node.type.name === 'inline_math') {
        const start = Math.max(from, pos)
        const end = Math.min(to, pos + node.nodeSize)
        const size = markSize(node.marks) ?? inheritedSize(state.doc, pos)
        if (start < end) transaction.addMark(start, end, type.create({ fontsize: steppedSize(size, direction) }))
      }
      else if ((node.type.name === 'bullet_list' || node.type.name === 'ordered_list') &&
        (wholeDocument || (from <= pos && to >= pos + node.nodeSize))) {
        transaction.setNodeMarkup(pos, undefined, { ...node.attrs, fontsize: steppedSize(node.attrs.fontsize, direction) })
      }
    })
  }
  if (dispatch) dispatch(transaction)
  return true
}
