import { type Ref, type ShallowRef, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore } from '@/store'
import type { PPTElement } from '@/types/slides'
import { getMarqueeRange, getMarqueeSelectedIds } from '@/utils/marqueeSelection'

export default (elementList: Ref<PPTElement[]>, viewportRef: ShallowRef<HTMLElement | null>) => {
  const mainStore = useMainStore()
  const { canvasScale, hiddenElementIdList } = storeToRefs(mainStore)
  const mouseSelectionVisible = ref(false)
  const mouseSelectionQuadrant = ref(4)
  const mouseSelection = ref({ top: 0, left: 0, width: 0, height: 0 })
  let stopSelection: (() => void) | undefined

  const updateMouseSelection = (event: MouseEvent) => {
    if (!viewportRef.value || event.button !== 0) return
    stopSelection?.()
    const viewportRect = viewportRef.value.getBoundingClientRect()
    const left = (event.pageX - viewportRect.x) / canvasScale.value
    const top = (event.pageY - viewportRect.y) / canvasScale.value
    const minSelectionRange = 5
    let end: [number, number] = [left, top]
    mouseSelection.value = { top, left, width: 0, height: 0 }
    mouseSelectionVisible.value = false
    mouseSelectionQuadrant.value = 4

    const updateFrame = (pointer: MouseEvent) => {
      end = [(pointer.pageX - viewportRect.x) / canvasScale.value, (pointer.pageY - viewportRect.y) / canvasScale.value]
      const x = end[0] - left, y = end[1] - top
      const width = Math.abs(x), height = Math.abs(y)
      mouseSelection.value = { top, left, width, height }
      mouseSelectionQuadrant.value = x >= 0 ? (y >= 0 ? 4 : 1) : (y >= 0 ? 3 : 2)
      mouseSelectionVisible.value = width >= minSelectionRange && height >= minSelectionRange
    }
    const finishSelection = (pointer: MouseEvent) => {
      updateFrame(pointer)
      const selectedIds = mouseSelectionVisible.value
        ? getMarqueeSelectedIds(elementList.value, getMarqueeRange([left, top], end), hiddenElementIdList.value)
        : []
      stop()
      mainStore.setActiveElementIdList(selectedIds)
    }
    const stop = () => {
      if (document.onmousemove === updateFrame) document.onmousemove = null
      if (document.onmouseup === finishSelection) document.onmouseup = null
      mouseSelectionVisible.value = false
      stopSelection = undefined
    }
    stopSelection = stop
    document.onmousemove = updateFrame
    document.onmouseup = finishSelection
  }

  onUnmounted(() => stopSelection?.())
  return { mouseSelection, mouseSelectionVisible, mouseSelectionQuadrant, updateMouseSelection }
}
