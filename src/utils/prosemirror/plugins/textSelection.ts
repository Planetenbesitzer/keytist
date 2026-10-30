import { AllSelection, Plugin, Selection, TextSelection } from 'prosemirror-state'

// A document-level AllSelection starts outside the text, so replacement input
// cannot inherit its marks. Select the full text range instead and let native
// typing, deletion and composition retain the first selected text's styling.
export const textSelectionPlugin = new Plugin({
  props: {
    handleDOMEvents: {
      beforeinput: (view, event) => {
        // Native multi-paragraph replacement can discard outer font/color
        // spans. Route plain replacement through the same model transaction
        // as keyboard typing; leave composition and rich-text paste native.
        if (!event.cancelable || event.inputType !== 'insertText' || event.isComposing || view.composing || !event.data) return false
        const { selection, doc } = view.state
        if (selection.empty || selection.from !== Selection.atStart(doc).from || selection.to !== Selection.atEnd(doc).to) return false

        event.preventDefault()
        view.dispatch(view.state.tr.insertText(event.data).scrollIntoView())
        return true
      },
    },
  },
  appendTransaction: (_transactions, _oldState, state) => {
    if (!(state.selection instanceof AllSelection)) return null

    const start = Selection.atStart(state.doc)
    const end = Selection.atEnd(state.doc)
    if (!(start instanceof TextSelection) || !(end instanceof TextSelection)) return null

    return state.tr.setSelection(TextSelection.create(state.doc, start.from, end.to))
  },
})
