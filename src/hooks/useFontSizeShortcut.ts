import { DOMSerializer } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { useMainStore, useSlidesStore, useSnapshotStore } from '@/store'
import { createDocument } from '@/utils/prosemirror'
import { changeFontSize, type FontSizeDirection } from '@/utils/prosemirror/commands/changeFontSize'

const resizeContent = (content: string, direction: FontSizeDirection): string => {
  const doc = createDocument(content)
  const state = EditorState.create({ doc })
  let updated = doc
  changeFontSize(state, transaction => {
    updated = transaction.doc
  }, direction, true)
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(updated.content))
  return container.innerHTML
}

export default () => {
  const mainStore = useMainStore()
  const slidesStore = useSlidesStore()
  const snapshots = useSnapshotStore()

  const changeSelectedFontSize = (direction: FontSizeDirection) => {
    const selected = new Set(mainStore.activeElementIdList)
    if (selected.size > 1 && document.activeElement instanceof HTMLElement && document.activeElement.closest('.ProseMirror')) {
      // A multi-object selection is object formatting even if one of those
      // boxes still holds a caret from its last click.
      document.activeElement.blur()
    }
    let changed = false
    const elements = slidesStore.currentSlide.elements.map(element => {
      if (!selected.has(element.id) || element.lock) return element
      if (element.type === 'text') {
        const content = resizeContent(element.content, direction)
        if (content === element.content) return element
        changed = true
        return { ...element, content }
      }
      if (element.type === 'shape' && element.text?.content) {
        const content = resizeContent(element.text.content, direction)
        if (content === element.text.content) return element
        changed = true
        return { ...element, text: { ...element.text, content } }
      }
      return element
    })
    if (!changed) return
    slidesStore.updateSlide({ elements })
    // One undo step covers every selected text box, and is queued immediately
    // so a quick Command-Z cannot race the ordinary debounced typing history.
    void snapshots.addSnapshot()
  }

  return { changeSelectedFontSize }
}
