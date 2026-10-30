import { onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore, useSlidesStore, useKeyboardStore } from '@/store'
import { ElementOrderCommands } from '@/types/edit'
import { KEYS } from '@/configs/hotkey'
import { fontSizeShortcutDirection } from '@/utils/prosemirror/commands/changeFontSize'

import useSlideHandler from './useSlideHandler'
import useLockElement from './useLockElement'
import useDeleteElement from './useDeleteElement'
import useCombineElement from './useCombineElement'
import useCopyAndPasteElement from './useCopyAndPasteElement'
import useSelectElement from './useSelectElement'
import useMoveElement from './useMoveElement'
import useOrderElement from './useOrderElement'
import useHistorySnapshot from './useHistorySnapshot'
import useScreening from './useScreening'
import useScaleCanvas from './useScaleCanvas'
import useFontSizeShortcut from './useFontSizeShortcut'

export default () => {
  const mainStore = useMainStore()
  const keyboardStore = useKeyboardStore()
  const {
    activeElementIdList,
    disableHotkeys,
    handleElement,
    handleElementId,
    editorAreaFocus,
    thumbnailsFocus,
    showSearchPanel,
  } = storeToRefs(mainStore)
  const { currentSlide } = storeToRefs(useSlidesStore())
  const { ctrlKeyState, shiftKeyState, spaceKeyState } = storeToRefs(keyboardStore)

  const {
    updateSlideIndex,
    copySlide,
    createSlide,
    deleteSlide,
    cutSlide,
    copyAndPasteSlide,
    selectAllSlide,
  } = useSlideHandler()

  const { combineElements, uncombineElements } = useCombineElement()
  const { deleteElement } = useDeleteElement()
  const { lockElement } = useLockElement()
  const { copyElement, cutElement, quickCopyElement } = useCopyAndPasteElement()
  const { selectAllElements } = useSelectElement()
  const { moveElement } = useMoveElement()
  const { orderElement } = useOrderElement()
  const { redo, undo } = useHistorySnapshot()
  const { enterScreening, enterScreeningFromStart } = useScreening()
  const { scaleCanvas, resetCanvas } = useScaleCanvas()
  const { changeSelectedFontSize } = useFontSizeShortcut()

  const copy = () => {
    if (activeElementIdList.value.length) copyElement()
    else if (thumbnailsFocus.value) copySlide()
  }

  const cut = () => {
    if (activeElementIdList.value.length) cutElement()
    else if (thumbnailsFocus.value) cutSlide()
  }

  const quickCopy = () => {
    if (activeElementIdList.value.length) quickCopyElement()
    else if (thumbnailsFocus.value) copyAndPasteSlide()
  }

  const selectAll = () => {
    if (editorAreaFocus.value) selectAllElements()
    if (thumbnailsFocus.value) selectAllSlide()
  }

  const lock = () => {
    if (!editorAreaFocus.value) return
    lockElement()
  }
  const combine = () => {
    if (!editorAreaFocus.value) return
    combineElements()
  }

  const uncombine = () => {
    if (!editorAreaFocus.value) return
    uncombineElements()
  }

  const remove = () => {
    if (activeElementIdList.value.length) deleteElement()
    else if (thumbnailsFocus.value) deleteSlide()
  }

  const move = (key: string, step = 1) => {
    if (activeElementIdList.value.length) moveElement(key, step)
    else if (key === KEYS.UP || key === KEYS.DOWN) updateSlideIndex(key)
  }

  const moveSlide = (key: string) => {
    if (key === KEYS.PAGEUP) updateSlideIndex(KEYS.UP)
    else if (key === KEYS.PAGEDOWN) updateSlideIndex(KEYS.DOWN)
  }

  const order = (command: ElementOrderCommands) => {
    if (!handleElement.value) return
    orderElement(handleElement.value, command)
  }

  const create = () => {
    if (!thumbnailsFocus.value) return
    createSlide()
  }

  const tabActiveElement = () => {
    const elements = currentSlide.value.elements.filter(el => el.type !== 'text' || !el.autoPageNumber?.hidden)
    if (!elements.length) return
    if (!handleElementId.value) {
      const firstElement = elements[0]
      mainStore.setActiveElementIdList([firstElement.id])
      return
    }
    const currentIndex = elements.findIndex(el => el.id === handleElementId.value)
    const nextIndex = currentIndex >= elements.length - 1 ? 0 : currentIndex + 1
    const nextElementId = elements[nextIndex].id

    mainStore.setActiveElementIdList([nextElementId])
  }

  const keydownListener = (e: KeyboardEvent) => {
    const { ctrlKey, shiftKey, altKey, metaKey } = e
    const ctrlOrMetaKeyActive = ctrlKey || metaKey
    
    // Option changes e.key on a Mac (Option-P is “π”). Physical letter codes
    // keep Keynote's Option-Command shortcuts working on every keyboard layout.
    const key = (e.code.startsWith('Key') ? e.code.slice(3) : e.key).toUpperCase()

    if (ctrlOrMetaKeyActive && !ctrlKeyState.value) keyboardStore.setCtrlKeyState(true)
    if (shiftKey && !shiftKeyState.value) keyboardStore.setShiftKeyState(true)
    if (!disableHotkeys.value && key === KEYS.SPACE) keyboardStore.setSpaceKeyState(true)

    if (e.isComposing) return

    const inField = e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable="true"]')

    if (ctrlOrMetaKeyActive && altKey && key === KEYS.P && !inField && !disableHotkeys.value) {
      e.preventDefault()
      enterScreening()
      return
    }
    if (ctrlOrMetaKeyActive && altKey && key === 'E' && !inField && !disableHotkeys.value) {
      e.preventDefault()
      window.dispatchEvent(new Event('keynote-local:insert-equation'))
      return
    }
    if (ctrlOrMetaKeyActive && shiftKey && key === 'N' && !inField && !disableHotkeys.value) {
      e.preventDefault()
      createSlide()
      return
    }
    if (ctrlOrMetaKeyActive && !altKey && key === KEYS.P) {
      e.preventDefault()
      mainStore.setDialogForExport('pdf')
      return
    }
    if (shiftKey && key === KEYS.F5) {
      e.preventDefault()
      enterScreening()
      keyboardStore.setShiftKeyState(false)
      return
    }
    if (key === KEYS.F5) {
      e.preventDefault()
      enterScreeningFromStart()
      return
    }
    if (ctrlOrMetaKeyActive && !altKey && key === KEYS.F) {
      e.preventDefault()
      mainStore.setSearchPanelState(!showSearchPanel.value)
      return
    }
    const fontSizeDirection = fontSizeShortcutDirection(e)
    if (fontSizeDirection) {
      // Focused ProseMirror editors handle this before the event bubbles here.
      // Always stop browser zoom, including when no text object is selected.
      e.preventDefault()
      const editingMultipleObjects = activeElementIdList.value.length > 1 &&
        e.target instanceof Element && !!e.target.closest('.ProseMirror')
      if ((!inField && !disableHotkeys.value) || editingMultipleObjects) changeSelectedFontSize(fontSizeDirection)
      return
    }
    if (ctrlOrMetaKeyActive && shiftKey && e.code === 'Comma') {
      e.preventDefault()
      scaleCanvas('-')
      return
    }
    if (ctrlOrMetaKeyActive && shiftKey && e.code === 'Period') {
      e.preventDefault()
      scaleCanvas('+')
      return
    }
    if (ctrlOrMetaKeyActive && key === KEYS.DIGIT_0) {
      e.preventDefault()
      resetCanvas()
      return
    }

    // Undo still belongs to the document after a toolbar action, even if
    // clicking that toolbar has moved focus out of the canvas or navigator.
    if (ctrlOrMetaKeyActive && !inField && !disableHotkeys.value && (key === KEYS.Z || key === KEYS.Y)) {
      e.preventDefault()
      if (key === KEYS.Y || shiftKey) redo()
      else undo()
      return
    }
    
    if (!editorAreaFocus.value && !thumbnailsFocus.value) return
    if (inField) return

    if (ctrlOrMetaKeyActive && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      if (disableHotkeys.value) return
      e.preventDefault()
      const forward = e.code === 'BracketRight'
      order(shiftKey
        ? (forward ? ElementOrderCommands.TOP : ElementOrderCommands.BOTTOM)
        : (forward ? ElementOrderCommands.UP : ElementOrderCommands.DOWN))
      return
    }

    if (ctrlOrMetaKeyActive && key === KEYS.C) {
      if (disableHotkeys.value) return
      e.preventDefault()
      copy()
    }
    if (ctrlOrMetaKeyActive && key === KEYS.X) {
      if (disableHotkeys.value) return
      e.preventDefault()
      cut()
    }
    if (ctrlOrMetaKeyActive && key === KEYS.D) {
      if (disableHotkeys.value) return
      e.preventDefault()
      quickCopy()
    }
    if (ctrlOrMetaKeyActive && key === KEYS.A) {
      if (disableHotkeys.value) return
      e.preventDefault()
      selectAll()
    }
    if (ctrlOrMetaKeyActive && key === KEYS.L) {
      if (disableHotkeys.value) return
      e.preventDefault()
      lock()
    }
    if (!shiftKey && ctrlOrMetaKeyActive && key === KEYS.G) {
      if (disableHotkeys.value) return
      e.preventDefault()
      combine()
    }
    if (shiftKey && ctrlOrMetaKeyActive && key === KEYS.G) {
      if (disableHotkeys.value) return
      e.preventDefault()
      uncombine()
    }
    if (altKey && !ctrlOrMetaKeyActive && key === KEYS.F) {
      if (disableHotkeys.value) return
      e.preventDefault()
      order(ElementOrderCommands.TOP)
    }
    if (altKey && !ctrlOrMetaKeyActive && key === KEYS.B) {
      if (disableHotkeys.value) return
      e.preventDefault()
      order(ElementOrderCommands.BOTTOM)
    }
    if (key === KEYS.DELETE || key === KEYS.BACKSPACE) {
      if (disableHotkeys.value) return
      e.preventDefault()
      remove()
    }
    if (key === KEYS.UP) {
      if (disableHotkeys.value) return
      e.preventDefault()
      move(KEYS.UP, shiftKey ? 10 : 1)
    }
    if (key === KEYS.DOWN) {
      if (disableHotkeys.value) return
      e.preventDefault()
      move(KEYS.DOWN, shiftKey ? 10 : 1)
    }
    if (key === KEYS.LEFT) {
      if (disableHotkeys.value) return
      e.preventDefault()
      move(KEYS.LEFT, shiftKey ? 10 : 1)
    }
    if (key === KEYS.RIGHT) {
      if (disableHotkeys.value) return
      e.preventDefault()
      move(KEYS.RIGHT, shiftKey ? 10 : 1)
    }
    if (key === KEYS.PAGEUP) {
      if (disableHotkeys.value) return
      e.preventDefault()
      moveSlide(KEYS.PAGEUP)
    }
    if (key === KEYS.PAGEDOWN) {
      if (disableHotkeys.value) return
      e.preventDefault()
      moveSlide(KEYS.PAGEDOWN)
    }
    if (key === KEYS.ENTER) {
      if (disableHotkeys.value) return
      e.preventDefault()
      create()
    }
    if (key === KEYS.TAB) {
      if (disableHotkeys.value) return
      e.preventDefault()
      tabActiveElement()
    }
    if (editorAreaFocus.value && !shiftKey && !ctrlOrMetaKeyActive && !disableHotkeys.value) {
      if (key === KEYS.T) {
        mainStore.setCreatingElement({ type: 'text' })
      }
      else if (key === KEYS.R) {
        mainStore.setCreatingElement({ type: 'shape', data: {
          viewBox: [200, 200],
          path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
        }})
      }
      else if (key === KEYS.O) {
        mainStore.setCreatingElement({ type: 'shape', data: {
          viewBox: [200, 200],
          path: 'M 100 0 A 50 50 0 1 1 100 200 A 50 50 0 1 1 100 0 Z',
        }})
      }
      else if (key === KEYS.L) {
        mainStore.setCreatingElement({ type: 'line', data: {
          path: 'M 0 0 L 20 20',
          style: 'solid',
          points: ['', ''],
        }})
      }
    }
  }
  
  const keyupListener = () => {
    if (ctrlKeyState.value) keyboardStore.setCtrlKeyState(false)
    if (shiftKeyState.value) keyboardStore.setShiftKeyState(false)
    if (spaceKeyState.value) keyboardStore.setSpaceKeyState(false)
  }

  onMounted(() => {
    document.addEventListener('keydown', keydownListener)
    document.addEventListener('keyup', keyupListener)
    window.addEventListener('blur', keyupListener)
  })
  onUnmounted(() => {
    document.removeEventListener('keydown', keydownListener)
    document.removeEventListener('keyup', keyupListener)
    window.removeEventListener('blur', keyupListener)
  })
}
