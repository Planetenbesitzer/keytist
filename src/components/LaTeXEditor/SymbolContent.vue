<template>
  <div class="symbol-content" v-if="svg" v-html="svg"></div>
  <span v-else>{{ latex }}</span>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { renderLatex } from '@/utils/latex'

const props = defineProps<{ latex: string }>()
const svg = computed(() => {
  try {
    return renderLatex(props.latex).svg
  }
  catch {
    return ''
  }
})
</script>

<style scoped>
.symbol-content {
  height: 25px;
  min-width: 25px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.symbol-content :deep(svg) {
  max-width: 70px;
  max-height: 23px;
  width: auto;
  height: auto;
}
</style>
