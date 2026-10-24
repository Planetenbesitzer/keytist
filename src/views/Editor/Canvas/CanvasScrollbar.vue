<template>
  <div
    ref="trackRef"
    class="canvas-scrollbar"
    :class="[orientation, { dragging }]"
    role="scrollbar"
    :aria-label="orientation === 'horizontal' ? t('水平滚动画布') : t('垂直滚动画布')"
    :aria-orientation="orientation"
    :aria-valuemin="0"
    :aria-valuemax="scrollMax"
    :aria-valuenow="scrollPosition"
    tabindex="0"
    @pointerdown.stop.prevent="startDrag"
    @pointermove.stop
    @pointerup.stop
    @pointercancel.stop
    @mousedown.stop
    @mouseup.stop
    @mousemove.stop
    @click.stop
    @dblclick.stop.prevent
    @contextmenu.stop.prevent
    @keydown="handleKeydown"
    @keypress.stop
    @wheel="handleWheel"
    @blur="stopDrag"
  >
    <div class="thumb" :style="thumbStyle"></div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

const props = defineProps<{
  orientation: 'horizontal' | 'vertical'
  max: number
  position: number
  viewport: number
}>()

const emit = defineEmits<{
  (event: 'scroll', position: number): void
}>()

const trackRef = useTemplateRef<HTMLElement>('trackRef')
const trackLength = ref(0)
const dragging = ref(false)
const horizontal = computed(() => props.orientation === 'horizontal')
const scrollMax = computed(() => Number.isFinite(props.max) ? Math.max(0, props.max) : 0)
const viewportLength = computed(() => Number.isFinite(props.viewport) ? Math.max(0, props.viewport) : 0)
const clampPosition = (value: number) => Math.max(0, Math.min(scrollMax.value, value))
const scrollPosition = computed(() => clampPosition(Number.isFinite(props.position) ? props.position : 0))
const thumbLength = computed(() => {
  const totalLength = viewportLength.value + scrollMax.value
  const ratio = totalLength > 0 ? viewportLength.value / totalLength : 1
  return Math.min(trackLength.value, Math.max(28, trackLength.value * ratio))
})
const thumbTravel = computed(() => Math.max(0, trackLength.value - thumbLength.value))
const thumbOffset = computed(() => scrollMax.value > 0 ? thumbTravel.value * scrollPosition.value / scrollMax.value : 0)
const thumbStyle = computed(() => horizontal.value
  ? { width: thumbLength.value + 'px', left: thumbOffset.value + 'px' }
  : { height: thumbLength.value + 'px', top: thumbOffset.value + 'px' })

let dragPointerId: number | null = null
let dragStart = 0
let dragPosition = 0

const handlePointerMove = (event: PointerEvent) => {
  if (event.pointerId !== dragPointerId) return
  event.preventDefault()
  const coordinate = horizontal.value ? event.clientX : event.clientY
  const movement = thumbTravel.value > 0 ? (coordinate - dragStart) * scrollMax.value / thumbTravel.value : 0
  emit('scroll', clampPosition(dragPosition + movement))
}

const stopDrag = () => {
  dragging.value = false
  dragPointerId = null
  window.removeEventListener('pointermove', handlePointerMove, true)
  window.removeEventListener('pointerup', handlePointerEnd, true)
  window.removeEventListener('pointercancel', handlePointerEnd, true)
  window.removeEventListener('blur', stopDrag)
}

const handlePointerEnd = (event: PointerEvent) => {
  if (event.pointerId === dragPointerId) stopDrag()
}

const startDrag = (event: PointerEvent) => {
  if (event.button !== 0 || !event.isPrimary || !trackRef.value) return
  stopDrag()
  trackRef.value.focus({ preventScroll: true })
  dragStart = horizontal.value ? event.clientX : event.clientY
  dragPosition = scrollPosition.value
  if (!(event.target instanceof HTMLElement && event.target.classList.contains('thumb'))) {
    const rect = trackRef.value.getBoundingClientRect()
    const trackCoordinate = dragStart - (horizontal.value ? rect.left : rect.top)
    dragPosition = thumbTravel.value > 0
      ? clampPosition((trackCoordinate - thumbLength.value / 2) * scrollMax.value / thumbTravel.value)
      : 0
    emit('scroll', dragPosition)
  }
  dragPointerId = event.pointerId
  dragging.value = true
  window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false })
  window.addEventListener('pointerup', handlePointerEnd, true)
  window.addEventListener('pointercancel', handlePointerEnd, true)
  window.addEventListener('blur', stopDrag)
}

const handleKeydown = (event: KeyboardEvent) => {
  // Keep editor shortcuts and Space-pan available after focusing a scrollbar.
  if (event.metaKey || event.ctrlKey || event.altKey) return
  let position = scrollPosition.value
  const page = Math.max(40, viewportLength.value * 0.9)
  if (event.key === 'Home') position = 0
  else if (event.key === 'End') position = scrollMax.value
  else if (event.key === 'PageUp') position -= page
  else if (event.key === 'PageDown') position += page
  else if (event.key === (horizontal.value ? 'ArrowLeft' : 'ArrowUp')) position -= 40
  else if (event.key === (horizontal.value ? 'ArrowRight' : 'ArrowDown')) position += 40
  else return
  event.stopPropagation()
  event.preventDefault()
  emit('scroll', clampPosition(position))
}

const handleWheel = (event: WheelEvent) => {
  // Keep modifier-wheel available to the canvas zoom handler.
  if (event.ctrlKey || event.metaKey) return
  event.stopPropagation()
  event.preventDefault()
  const delta = horizontal.value ? event.deltaX || event.deltaY : event.deltaY
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportLength.value : 1
  emit('scroll', clampPosition(scrollPosition.value + delta * unit))
}

const resizeObserver = new ResizeObserver(() => {
  if (trackRef.value) trackLength.value = horizontal.value ? trackRef.value.clientWidth : trackRef.value.clientHeight
})

onMounted(() => {
  if (trackRef.value) resizeObserver.observe(trackRef.value)
})

onBeforeUnmount(() => {
  stopDrag()
  resizeObserver.disconnect()
})
</script>

<style scoped lang="scss">
.canvas-scrollbar {
  position: absolute;
  z-index: 10000;
  border-radius: 6px;
  background: #e4e5e8;
  cursor: default;
  touch-action: none;
  user-select: none;

  &.horizontal {
    left: 8px;
    right: 22px;
    bottom: 4px;
    height: 12px;

    .thumb {
      top: 2px;
      height: 8px;
    }
  }

  &.vertical {
    right: 4px;
    top: 8px;
    bottom: 22px;
    width: 12px;

    .thumb {
      left: 2px;
      width: 8px;
    }
  }

  &:focus-visible {
    outline: 2px solid #0a84ff;
    outline-offset: 1px;
  }

  &:hover .thumb,
  &.dragging .thumb {
    background: #858990;
  }
}

.thumb {
  position: absolute;
  border-radius: 5px;
  background: #adb0b6;
  transition: background 120ms;
}
</style>
