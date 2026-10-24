<template>
  <div class="export-pdf-dialog">
    <div class="thumbnails-view">
      <div class="thumbnails" ref="pdfThumbnailsRef">
        <ThumbnailSlide
          class="thumbnail"
          :slide="currentSlide"
          :size="1600"
          v-if="rangeType === 'current'"
        />
        <template v-else>
          <ThumbnailSlide
            class="thumbnail"
            :class="{ 'break-page': (index + 1) % count === 0 }"
            v-for="(slide, index) in slides"
            :key="slide.id"
            :slide="slide"
            :size="1600"
          />
        </template>
      </div>
    </div>
    <div class="configs">
      <div class="row">
        <div class="title">导出范围：</div>
        <RadioGroup
          class="config-item"
          v-model:value="rangeType"
        >
          <RadioButton style="width: 50%;" value="all">全部</RadioButton>
          <RadioButton style="width: 50%;" value="current">当前页</RadioButton>
        </RadioGroup>
      </div>
      <div class="row">
        <div class="title">每页数量：</div>
        <Select
          class="config-item"
          v-model:value="count"
          :options="[
            { label: '1', value: 1 },
            { label: '2', value: 2 },
            { label: '3', value: 3 },
          ]"
        />
      </div>
      <div class="row">
        <div class="title">边缘留白：</div>
        <div class="config-item">
          <Switch v-model:value="padding" />
        </div>
      </div>
      <div class="tip">
        建议：请在弹出的打印窗口中勾选「背景图形」选项，边距选择「默认」。
      </div>
    </div>

    <div class="btns">
      <Button class="btn export" type="primary" :disabled="exporting" @click="expPDF()"><i-icon-park-outline:download /> {{ exporting ? '正在准备…' : '打印 / 导出 PDF' }}</Button>
      <Button class="btn close" @click="emit('close')">关闭</Button>
    </div>
    <FullscreenSpin :loading="exporting" tip="正在准备字体、图片与打印页面…" />
  </div>
</template>

<script lang="ts" setup>
import { nextTick, ref, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useSlidesStore } from '@/store'
import { print } from '@/utils/print'
import message from '@/utils/message'

import ThumbnailSlide from '@/views/components/ThumbnailSlide/index.vue'
import Switch from '@/components/Switch.vue'
import Button from '@/components/Button.vue'
import RadioButton from '@/components/RadioButton.vue'
import RadioGroup from '@/components/RadioGroup.vue'
import Select from '@/components/Select.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'

const emit = defineEmits<{
  (event: 'close'): void
}>()

const { slides, currentSlide, viewportRatio } = storeToRefs(useSlidesStore())

const pdfThumbnailsRef = useTemplateRef<HTMLElement>('pdfThumbnailsRef')
const rangeType = ref<'all' | 'current'>('all')
const count = ref(1)
const padding = ref(true)
const exporting = ref(false)

const expPDF = async () => {
  if (!pdfThumbnailsRef.value || exporting.value) return
  exporting.value = true
  try {
    await nextTick()
    if (pdfThumbnailsRef.value.querySelector('.html-slide')) throw new Error('这份文稿包含交互网页，请先“发布 HTML”，再在导出的网页中选择打印。')
    const pageSize = {
      width: 1600,
      height: rangeType.value === 'all' ? 1600 * viewportRatio.value * count.value : 1600 * viewportRatio.value,
      margin: padding.value ? 50 : 0,
    }
    await print(pdfThumbnailsRef.value, pageSize)
  }
  catch (error) {
    message.error(error instanceof Error ? error.message : '打印准备失败，请重试')
  }
  finally {
    exporting.value = false
  }
}
</script>

<style lang="scss" scoped>
.export-pdf-dialog {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
.thumbnails-view {
  @include absolute-0();

  &::after {
    content: '';
    background-color: #fff;
    @include absolute-0();
  }
}
.thumbnail {
  &.break-page {
    break-after: page;
  }
}
.configs {
  width: 300px;
  height: calc(100% - 80px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  z-index: 1;

  .row {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 25px;
  }

  .title {
    width: 100px;
  }
  .config-item {
    flex: 1;
  }

  .tip {
    font-size: 12px;
    color: #aaa;
    line-height: 1.8;
    margin-top: 25px;
  }
}
.btns {
  width: 300px;
  height: 80px;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1;

  .export {
    flex: 1;
  }
  .close {
    width: 100px;
    margin-left: 10px;
  }
}
</style>
