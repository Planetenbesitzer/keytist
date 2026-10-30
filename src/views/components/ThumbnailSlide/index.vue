<template>
  <div class="thumbnail-slide"
    :style="{
      width: size + 'px',
      height: size * viewportRatio + 'px',
    }"
  >
    <div
      class="elements"
      :style="{
        width: viewportSize + 'px',
        height: viewportSize * viewportRatio + 'px',
        transform: `scale(${scale})`,
      }"
      v-if="visible"
    >
      <div class="background" :style="backgroundStyle"></div>
      <HtmlSlide v-if="slide.html" :key="slide.id" :source="htmlSource ?? slide.html.source" :sourceWidth="slide.html.width" :sourceHeight="slide.html.height"
        :left="slide.html.left" :top="slide.html.top" :scale="slide.html.scale" :width="viewportSize" :height="viewportSize * viewportRatio" :interactive="interactiveHtml" />
      <ThumbnailElement
        v-for="(element, index) in slide.elements"
        :key="element.id"
        :elementInfo="element"
        :elementIndex="index + 1"
      />
    </div>
    <div class="placeholder" v-else>{{ t("加载中 ...") }}</div>
  </div>
</template>

<script lang="ts" setup>
import { t } from '@/i18n'
import { computed, provide } from 'vue'
import { storeToRefs } from 'pinia'
import { useSlidesStore } from '@/store'
import type { Slide } from '@/types/slides'
import { injectKeySlideScale } from '@/types/injectKey'
import useSlideBackgroundStyle from '@/hooks/useSlideBackgroundStyle'

import ThumbnailElement from './ThumbnailElement.vue'
import HtmlSlide from '@/components/HtmlSlide.vue'

const props = withDefaults(defineProps<{
  slide: Slide
  size: number
  visible?: boolean
  /** Only PDF's separate preview supplies a capture source and interaction. */
  htmlSource?: string
  interactiveHtml?: boolean
}>(), {
  visible: true,
  interactiveHtml: false,
})

const { viewportRatio, viewportSize } = storeToRefs(useSlidesStore())

const background = computed(() => props.slide.background)
const { backgroundStyle } = useSlideBackgroundStyle(background)

const scale = computed(() => props.size / viewportSize.value)
provide(injectKeySlideScale, scale)
</script>

<style lang="scss" scoped>
.thumbnail-slide {
  background-color: #fff;
  overflow: hidden;
  user-select: none;
}
.elements {
  transform-origin: 0 0;
}
.background {
  width: 100%;
  height: 100%;
  background-position: center;
  position: absolute;
}
.placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
