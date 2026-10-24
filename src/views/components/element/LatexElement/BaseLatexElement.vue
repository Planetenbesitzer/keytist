<template>
  <div 
    class="base-element-latex"
    :style="{
      top: elementInfo.top + 'px',
      left: elementInfo.left + 'px',
      width: elementInfo.width + 'px',
      height: elementInfo.height + 'px',
    }"
  >
    <div
      class="rotate-wrapper"
      :style="{ transform: `rotate(${elementInfo.rotate}deg)` }"
    >
      <div class="element-content">
        <LatexSvg :elementInfo="elementInfo" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { PPTLatexElement } from '@/types/slides'
import LatexSvg from './LatexSvg.vue'

defineProps<{
  elementInfo: PPTLatexElement
}>()
</script>

<style lang="scss" scoped>
.base-element-latex {
  position: absolute;
}
.rotate-wrapper {
  width: 100%;
  height: 100%;
}
.element-content {
  width: 100%;
  height: 100%;
  position: relative;

  svg {
    transform-origin: 0 0;
    overflow: visible;
  }
}
</style>
