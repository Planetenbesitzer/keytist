<template>
  <div 
    class="multi-select-operate"
    :style="{
      left: range.minX * canvasScale + 'px',
      top: range.minY * canvasScale + 'px',
    }"
  >
    <BorderLine v-for="line in borderLines" :key="line.type" :type="line.type" :style="line.style" />

    <template v-if="!disableResize">
      <ResizeHandler
        v-for="point in visibleResizeHandlers"
        :key="point.direction"
        :type="point.direction"
        :style="point.style"
        @mousedown.stop="scaleMultiElement($event, range, point.direction)"
      />
    </template>
    <RotateHandler
      v-if="showRotateHandler"
      :style="{ left: width / 2 + 'px' }"
      @mousedown.stop="rotateGroupElement($event, localActiveElementList)"
    />
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore } from '@/store'
import type { PPTElement } from '@/types/slides'
import { getElementListRange, canRotateGroupElements } from '@/utils/element'
import { isCompleteGroupSelection, isGroupResizeCorner } from '@/utils/groupResize'
import type { OperateResizeHandlers, MultiSelectRange } from '@/types/edit'
import useCommonOperate from '../hooks/useCommonOperate'

import ResizeHandler from './ResizeHandler.vue'
import BorderLine from './BorderLine.vue'
import RotateHandler from './RotateHandler.vue'

const props = defineProps<{
  elementList: PPTElement[]
  scaleMultiElement: (e: MouseEvent, range: MultiSelectRange, command: OperateResizeHandlers) => void
  rotateGroupElement: (e: MouseEvent, elements: PPTElement[]) => void
}>()

const { activeElementIdList, activeGroupElementId, hiddenElementIdList, canvasScale } = storeToRefs(useMainStore())

const localActiveElementList = computed(() => props.elementList.filter(el => activeElementIdList.value.includes(el.id)))

const range = ref({
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
})

// 根据多选元素整体在画布中的范围，计算边框线和缩放点的位置信息
const width = computed(() => (range.value.maxX - range.value.minX) * canvasScale.value)
const height = computed(() => (range.value.maxY - range.value.minY) * canvasScale.value)
const { resizeHandlers, borderLines } = useCommonOperate(width, height)

// 计算多选元素整体在画布中的范围
const setRange = () => {
  const { minX, maxX, minY, maxY } = getElementListRange(localActiveElementList.value)
  range.value = { minX, maxX, minY, maxY }
}
watchEffect(setRange)

// A group scales uniformly from its corners, so rotated members never shear.
const isGroupSelection = computed(() => isCompleteGroupSelection(localActiveElementList.value, props.elementList))
const visibleResizeHandlers = computed(() => isGroupSelection.value
  ? resizeHandlers.value.filter(point => isGroupResizeCorner(point.direction))
  : resizeHandlers.value)

const disableResize = computed(() => {
  if (activeGroupElementId.value || localActiveElementList.value.length < 2 ||
    localActiveElementList.value.some(item => item.lock || hiddenElementIdList.value.includes(item.id))) return true
  if (isGroupSelection.value) return false
  if (localActiveElementList.value.some(item => item.groupId)) return true
  return localActiveElementList.value.some(item => {
    if (
      (item.type === 'image' || item.type === 'shape') && 
      !item.rotate
    ) return false
    return true
  })
})

const showRotateHandler = computed(() => {
  return !activeGroupElementId.value && canRotateGroupElements(localActiveElementList.value)
})
</script>

<style lang="scss" scoped>
.multi-select-operate {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 101;
}
</style>
