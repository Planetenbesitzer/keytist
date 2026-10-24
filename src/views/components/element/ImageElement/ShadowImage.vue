<template>
  <img v-if="asset" class="image-shadow-asset" :src="asset.dataUrl" :draggable="false" alt="" aria-hidden="true"
    :style="{ left: `${asset.left}px`, top: `${asset.top}px`, width: `${asset.width}px`, height: `${asset.height}px` }" />
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { PPTImageShadow } from '@/types/slides'
import { createImageShadowAsset } from '@/utils/imageShadow'

const props = defineProps<{ shadow?: PPTImageShadow; width: number; height: number }>()
const asset = computed(() => createImageShadowAsset(props.shadow, props.width, props.height))
</script>

<style scoped>
.image-shadow-asset {
  position: absolute;
  pointer-events: none;
  user-select: none;
  max-width: none;
  max-height: none;
}
</style>
