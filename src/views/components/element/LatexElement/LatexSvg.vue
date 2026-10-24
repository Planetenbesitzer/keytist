<template>
  <svg
    v-if="elementInfo.svg"
    xmlns="http://www.w3.org/2000/svg"
    :width="elementInfo.width"
    :height="elementInfo.height"
    :viewBox="`0 0 ${elementInfo.viewBox[0]} ${elementInfo.viewBox[1]}`"
    :color="elementInfo.color"
    :style="{ color: elementInfo.color }"
    role="img"
    :aria-label="elementInfo.latex"
    v-html="svgContent"
  ></svg>
  <svg
    v-else
    :width="elementInfo.width"
    :height="elementInfo.height"
    :stroke="elementInfo.color"
    :stroke-width="elementInfo.strokeWidth"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
    overflow="visible"
  >
    <g :transform="`scale(${elementInfo.width / elementInfo.viewBox[0]}, ${elementInfo.height / elementInfo.viewBox[1]})`">
      <path :d="elementInfo.path"></path>
    </g>
  </svg>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { PPTLatexElement } from '@/types/slides'
import { sanitizeLatexSvg } from '@/utils/latex'

const props = defineProps<{ elementInfo: PPTLatexElement }>()
// MathJax's SVG contains its own viewBox (including the baseline offset).
// Nesting preserves that coordinate system while the outer SVG scales like
// every other slide object, and keeps the selected color in image exports.
const svgContent = computed(() => sanitizeLatexSvg(props.elementInfo.svg || '')
  .replace(/\swidth="[^"]*"/, ' width="100%"')
  .replace(/\sheight="[^"]*"/, ' height="100%"'))
</script>

<style scoped>
svg {
  display: block;
  overflow: visible;
  transform-origin: 0 0;
}
</style>
