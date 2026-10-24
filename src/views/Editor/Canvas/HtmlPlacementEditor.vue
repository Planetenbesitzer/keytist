<template>
  <div class="html-placement-editor">
    <div class="html-placement-toolbar" role="group" :aria-label="t('嵌入网页位置')" @mousedown.stop @dblclick.stop @keydown="handleToolbarKeydown">
      <button class="adjust-button" :class="{ active: editing }" :aria-pressed="editing" :aria-label="t('调整嵌入网页位置')" @mousedown.prevent @click="toggleEditing">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v16M2 10h16M7 5l3-3 3 3M7 15l3 3 3-3M5 7l-3 3 3 3M15 7l3 3-3 3" /></svg>
        {{ editing ? t("完成调整") : t("调整网页位置") }}
      </button>
      <template v-if="editing">
        <label>X <input type="number" :aria-label="t('网页水平位置')" :value="format(placement.left)" step="1" @change="changeNumber('left', $event)"></label>
        <label>Y <input type="number" :aria-label="t('网页垂直位置')" :value="format(placement.top)" step="1" @change="changeNumber('top', $event)"></label>
        <label>{{ t("缩放") }} <input type="number" :aria-label="t('网页整体缩放百分比')" :value="format(placement.scale * 100)" :min="HTML_MIN_SCALE * 100" :max="HTML_MAX_SCALE * 100" step="1" @change="changeNumber('scale', $event)">%</label>
        <button :aria-label="t('网页居中')" @mousedown.prevent @click="center">{{ t("居中") }}</button>
        <button :aria-label="t('网页恢复原位和大小')" :disabled="isOriginal" @mousedown.prevent @click="commit({ left: 0, top: 0, scale: 1 })">{{ t("归位") }}</button>
        <span class="hint">{{ t("拖动移动 · 四角缩放") }}</span>
      </template>
    </div>
    <div v-if="editing" ref="frameElement" class="html-placement-frame" :class="{ panning, dragging: !!gesture }"
      :style="frameStyle" tabindex="0" role="group" :aria-label="t('移动嵌入网页')"
      @pointerdown.stop.prevent="startGesture($event)" @mousedown.stop @mouseup.stop @click.stop @dblclick.stop.prevent @contextmenu.stop.prevent @keydown="handleFrameKeydown">
      <span class="frame-caption">{{ t("HTML 网页") }}</span>
      <button v-for="corner in corners" :key="corner.id" class="resize-handle" :class="corner.id" :aria-label="corner.label"
        @pointerdown.stop.prevent="startGesture($event, corner.id)" @mousedown.stop @click.stop></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useMainStore, useSlidesStore, useSnapshotStore } from '@/store'
import { getSnapshotHistoryEpoch } from '@/store/snapshot'
import type { Slide } from '@/types/slides'
import { getHtmlPlacement, HTML_MIN_SCALE, HTML_MAX_SCALE, type HtmlPlacement } from '@/utils/htmlPlacement'
import { moveHtmlPlacement, resizeHtmlPlacement, type HtmlResizeCorner } from '@/utils/htmlPlacementGesture'
import message from '@/utils/message'

const props = defineProps<{
  slideId: string
  html: NonNullable<Slide['html']>
  width: number
  height: number
  left: number
  top: number
  canvasScale: number
  panning: boolean
}>()
const emit = defineEmits<{ (event: 'preview', placement: HtmlPlacement | null): void }>()
const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const snapshotStore = useSnapshotStore()
const editing = ref(false)
const frameElement = ref<HTMLElement>()
const draft = ref<HtmlPlacement | null>(null)
const placement = computed(() => draft.value || getHtmlPlacement(props.html))
const isOriginal = computed(() => placement.value.left === 0 && placement.value.top === 0 && placement.value.scale === 1)
const frameStyle = computed(() => ({
  left: `${props.left + placement.value.left * props.canvasScale}px`,
  top: `${props.top + placement.value.top * props.canvasScale}px`,
  width: `${props.width * placement.value.scale * props.canvasScale}px`,
  height: `${props.height * placement.value.scale * props.canvasScale}px`,
}))
const corners: { id: HtmlResizeCorner; label: string }[] = [
  { id: 'nw', label: '从左上角缩放网页' }, { id: 'ne', label: '从右上角缩放网页' },
  { id: 'sw', label: '从左下角缩放网页' }, { id: 'se', label: '从右下角缩放网页' },
]
interface Gesture {
  pointerId: number
  x: number
  y: number
  canvasScale: number
  original: HtmlPlacement
  html: NonNullable<Slide['html']>
  slideId: string
  epoch: number
  corner?: HtmlResizeCorner
  target: HTMLElement
}
const gesture = shallowRef<Gesture | null>(null)
const format = (value: number) => Math.round(value * 1000) / 1000
const equal = (a: HtmlPlacement, b: HtmlPlacement) => a.left === b.left && a.top === b.top && a.scale === b.scale

const commit = (value: HtmlPlacement) => {
  const slide = slidesStore.currentSlide
  if (slide?.id !== props.slideId || !slide.html || equal(getHtmlPlacement(slide.html), value)) return
  // Merge into the current HTML; never replace source, viewport or extensions.
  slidesStore.updateSlide({ html: { ...slide.html, ...value } }, slide.id)
  void snapshotStore.addSnapshot().catch(() => message.error('无法记录网页调整的撤销历史，请保存文稿。'))
}

const releaseGesture = () => {
  const current = gesture.value
  gesture.value = null
  window.removeEventListener('pointermove', handlePointerMove, true)
  window.removeEventListener('pointerup', handlePointerEnd, true)
  window.removeEventListener('pointercancel', cancelGesture, true)
  window.removeEventListener('blur', cancelGesture)
  if (current?.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
  draft.value = null
  emit('preview', null)
}
const cancelGesture = () => releaseGesture()
const stillCurrent = (current: Gesture) => current.slideId === props.slideId && current.html === props.html && current.epoch === getSnapshotHistoryEpoch()
const handlePointerMove = (event: PointerEvent) => {
  const current = gesture.value
  if (!current || current.pointerId !== event.pointerId) return
  if (!stillCurrent(current)) {
    cancelGesture(); return
  }
  event.preventDefault()
  const dx = (event.clientX - current.x) / current.canvasScale
  const dy = (event.clientY - current.y) / current.canvasScale
  draft.value = current.corner
    ? resizeHtmlPlacement(current.original, current.corner, dx, dy, props.width, props.height)
    : moveHtmlPlacement(current.original, dx, dy)
  emit('preview', draft.value)
}
const handlePointerEnd = (event: PointerEvent) => {
  const current = gesture.value
  if (!current || event.pointerId !== current.pointerId) return
  // Include the final pointer position even if it arrived between move events.
  handlePointerMove(event)
  const value = draft.value
  const valid = stillCurrent(current)
  releaseGesture()
  if (valid && value) commit(value)
}
const startGesture = (event: PointerEvent, corner?: HtmlResizeCorner) => {
  if (event.button !== 0 || !event.isPrimary || props.panning || props.canvasScale <= 0 || !(event.currentTarget instanceof HTMLElement)) return
  cancelGesture()
  frameElement.value?.focus({ preventScroll: true })
  mainStore.setActiveElementIdList([])
  mainStore.setThumbnailsFocus(false)
  mainStore.setEditorareaFocus(false)
  const target = event.currentTarget
  gesture.value = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, canvasScale: props.canvasScale,
    original: getHtmlPlacement(props.html), html: props.html, slideId: props.slideId, epoch: getSnapshotHistoryEpoch(), corner, target }
  target.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false })
  window.addEventListener('pointerup', handlePointerEnd, true)
  window.addEventListener('pointercancel', cancelGesture, true)
  window.addEventListener('blur', cancelGesture)
}
const stopEditing = () => {
  cancelGesture(); editing.value = false
}
const toggleEditing = async () => {
  if (editing.value) {
    stopEditing(); return
  }
  editing.value = true
  mainStore.setActiveElementIdList([])
  mainStore.setThumbnailsFocus(false)
  mainStore.setEditorareaFocus(false)
  await nextTick()
  frameElement.value?.focus({ preventScroll: true })
}
const changeNumber = (field: keyof HtmlPlacement, event: Event) => {
  const input = event.target as HTMLInputElement
  const value = input.valueAsNumber
  if (Number.isFinite(value)) {
    const bounded = field === 'scale' ? Math.min(HTML_MAX_SCALE, Math.max(HTML_MIN_SCALE, value / 100)) : Math.min(100000, Math.max(-100000, value))
    commit({ ...getHtmlPlacement(props.html), [field]: bounded })
  }
  input.value = String(format(getHtmlPlacement(slidesStore.currentSlide.html)[field] * (field === 'scale' ? 100 : 1)))
}
const center = () => {
  const value = getHtmlPlacement(props.html)
  commit({ ...value, left: props.width * (1 - value.scale) / 2, top: props.height * (1 - value.scale) / 2 })
}
const handleFrameKeydown = (event: KeyboardEvent) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); stopEditing(); return
  }
  const step = event.shiftKey ? 10 : 1
  const deltas: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  if (deltas[event.key]) {
    event.preventDefault(); event.stopPropagation()
    commit(moveHtmlPlacement(getHtmlPlacement(props.html), ...deltas[event.key]))
  }
  else if (['Tab', 'Delete', 'Backspace'].includes(event.key)) {
    event.stopPropagation()
    if (event.key !== 'Tab') event.preventDefault()
  }
}
const handleToolbarKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.stopPropagation(); event.preventDefault(); stopEditing()
  }
  if (event.key === 'Tab') event.stopPropagation()
}
const beforeHistoryOrSave = (event: KeyboardEvent) => {
  if (!gesture.value) return
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); cancelGesture(); return
  }
  if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) cancelGesture()
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    const current = gesture.value, value = draft.value
    releaseGesture()
    if (current && value && stillCurrent(current)) commit(value)
  }
}
watch(() => props.slideId, stopEditing)
watch(() => props.html, cancelGesture)
watch(() => [props.canvasScale, props.width, props.height, props.left, props.top, props.panning], cancelGesture)
watch(() => mainStore.activeElementIdList.length, count => {
  if (count) stopEditing()
})
watch(() => [mainStore.creatingElement, mainStore.creatingCustomShape], () => {
  if (mainStore.creatingElement || mainStore.creatingCustomShape) stopEditing()
})
onMounted(() => window.addEventListener('keydown', beforeHistoryOrSave, true))
onBeforeUnmount(() => {
  releaseGesture(); window.removeEventListener('keydown', beforeHistoryOrSave, true)
})
</script>

<style scoped lang="scss">
.html-placement-editor { position: absolute; inset: 0; z-index: 103; pointer-events: none; }
.html-placement-toolbar { position: absolute; top: 12px; left: 12px; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 7px; max-width: calc(100% - 36px); padding: 6px 8px; border: 1px solid #d6d6dc; border-radius: 9px; background: #fafafcf5; box-shadow: 0 2px 9px #00000012; color: #63636b; font-size: 11px; pointer-events: auto; }
button { font: inherit; border: 0; border-radius: 5px; padding: 4px 6px; color: #55555d; background: transparent; cursor: pointer; &:hover { background: #e7e7ed; } &:focus-visible { outline: 2px solid #007aff; outline-offset: 1px; } &:disabled { opacity: .4; cursor: default; } }
.adjust-button { display: flex; align-items: center; gap: 5px; color: #007aff; font-size: 12px; &.active { background: #e3efff; } svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; } }
label { display: flex; align-items: center; gap: 4px; }
input { box-sizing: border-box; width: 58px; height: 25px; padding: 2px 4px; border: 1px solid #d6d6dc; border-radius: 4px; background: #fff; color: #303036; font: inherit; outline-color: #007aff; }
.hint { color: #8b8b94; font-size: 10px; white-space: nowrap; }
.html-placement-frame { position: absolute; box-sizing: border-box; outline: 1px solid #007aff; background: #007aff03; pointer-events: auto; cursor: move; touch-action: none; &.panning { pointer-events: none; } }
.frame-caption { position: absolute; top: -23px; left: -1px; padding: 3px 7px; border-radius: 4px 4px 0 0; color: #fff; background: #007aff; font-size: 10px; line-height: 16px; pointer-events: none; white-space: nowrap; }
.resize-handle { position: absolute; width: 11px; height: 11px; padding: 0; border: 1px solid #007aff; border-radius: 1px; background: white; touch-action: none; &.nw { left: -6px; top: -6px; cursor: nwse-resize; } &.ne { right: -6px; top: -6px; cursor: nesw-resize; } &.sw { left: -6px; bottom: -6px; cursor: nesw-resize; } &.se { right: -6px; bottom: -6px; cursor: nwse-resize; } &:hover { background: #e0edff; } }
</style>
