<template>
  <div
    class="formula-content"
    :style="{ maxWidth: `${width}px`, maxHeight: `${height}px` }"
    v-if="result"
    v-html="result.svg"
  ></div>
  <span class="formula-error" v-else>{{ error }}</span>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { renderLatex, renderInlineLatex } from '@/utils/latex'

const props = defineProps<{
  latex: string
  width: number
  height: number
  inline?: boolean
}>()

const rendered = computed(() => {
  try {
    return { result: props.inline ? renderInlineLatex(props.latex) : renderLatex(props.latex), error: '' }
  }
  catch (error) {
    return { result: null, error: error instanceof Error ? error.message : '请检查 LaTeX 语法' }
  }
})
const result = computed(() => rendered.value.result)
const error = computed(() => rendered.value.error)
</script>

<style lang="scss" scoped>
.formula-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  color: #1d1d1f;

  :deep(svg) {
    max-width: 100%;
    max-height: 100%;
    height: auto;
    width: auto;
  }
}
.formula-error {
  color: #b42318;
  font-size: 12px;
  padding: 10px;
}
</style>
