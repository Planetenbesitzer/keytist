<template>
  <div class="html-document-dialog" @keydown.stop>
    <div class="dialog-heading"><div><h2>{{ mode === 'edit' ? t("编辑本页 HTML") : t("导入 HTML") }}</h2><p>{{ t("保留完整排版、CSS 和 JavaScript，直接作为幻灯片播放。") }}</p></div>
      <FileInput accept=".html,.htm,text/html" @change="readHtml"><Button :disabled="busy">{{ t("打开 HTML 文件…") }}</Button></FileInput>
    </div>
    <div class="source-toolbar">
      <div class="view-tabs"><button :class="{ active: view === 'source' }" @click="view = 'source'">{{ t("源码") }}</button><button :class="{ active: view === 'preview' }" @click="view = 'preview'">{{ t("交互预览") }}</button></div>
      <button class="text-button" v-if="mode === 'import'" @click="loadExample">{{ t("载入演示示例") }}</button>
      <button class="text-button" v-if="view === 'preview'" @click="previewRevision++">{{ t("重新运行") }}</button>
    </div>
    <textarea v-if="view === 'source'" v-model="source" class="html-source" :aria-label="t('HTML 源码')" spellcheck="false" :placeholder="t('粘贴 AI 生成的完整 HTML，或打开 .html 文件。\n\n支持内联样式、SVG、Canvas 和 JavaScript 演示。')"></textarea>
    <div class="preview" v-else>
      <div v-if="source.trim()" class="preview-stage" :style="stageStyle">
        <HtmlSlide :key="previewRevision" :source="source" :width="viewportSize" :height="viewportSize * viewportRatio"
          :left="original?.left" :top="original?.top" :scale="original?.scale"
          :sourceWidth="sourceViewport?.width" :sourceHeight="sourceViewport?.height" interactive />
      </div>
      <p v-else>{{ t("打开或粘贴 HTML 后，在这里预览和操作。") }}</p>
    </div>
    <div class="options">
      <label><span>{{ t("网页尺寸") }}</span><select v-model="viewportMode" :aria-label="t('HTML 网页尺寸')"><option value="deck">{{ t("跟随当前文稿") }}</option><option value="1280x720">1280 × 720</option><option value="1920x1080">1920 × 1080</option><option value="custom">{{ t("自定义") }}</option></select></label>
      <div class="dimensions" v-if="viewportMode === 'custom'"><input type="number" :aria-label="t('HTML 网页宽度')" min="1" max="16384" v-model.number="customWidth"><span>×</span><input type="number" :aria-label="t('HTML 网页高度')" min="1" max="16384" v-model.number="customHeight"></div>
      <label class="destination" v-if="mode === 'import'"><span>{{ t("导入到") }}</span><select v-model="importMode" :aria-label="t('HTML 导入方式')"><option value="append">{{ t("追加到当前文稿") }}</option><option value="replace">{{ t("作为文稿打开") }}</option></select></label>
    </div>
    <p class="help">{{ t("网页整体保留，普通文本框和图片可继续叠加。引用在线资源的页面播放时仍需联网；本地相对路径素材请内嵌到 HTML。") }}</p>
    <p class="error" role="alert" v-if="error">{{ t(error) }}</p>
    <div class="actions"><Button @click="emit('close')" :disabled="busy">{{ t("取消") }}</Button><Button type="primary" @click="apply" :disabled="busy || !source.trim()">{{ busy ? t("正在处理…") : mode === 'edit' ? t("应用到本页") : t("导入 HTML") }}</Button></div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSlidesStore } from '@/store'
import { importHtmlDocument, updateHtmlSlideSource } from '@/services/htmlDocument'
import HtmlSlide from '@/components/HtmlSlide.vue'
import Button from '@/components/Button.vue'
import FileInput from '@/components/FileInput.vue'
import message from '@/utils/message'
import exampleHtml from '../../../examples/HTML演示示例.html?raw'

const props = defineProps<{ mode: 'import' | 'edit'; width: number }>()
const emit = defineEmits<{ (event: 'close'): void }>()
const { currentSlide, viewportSize, viewportRatio } = storeToRefs(useSlidesStore())
const editingSlideId = currentSlide.value.id
const original = props.mode === 'edit' ? currentSlide.value.html : undefined
const source = ref(original?.source || '')
const sourceViewportOriginal = original?.width && original?.height ? `${original.width}x${original.height}` : 'deck'
const viewportMode = ref(['deck', '1280x720', '1920x1080'].includes(sourceViewportOriginal) ? sourceViewportOriginal : 'custom')
const customWidth = ref(original?.width || 1280)
const customHeight = ref(original?.height || 720)
const importMode = ref<'append' | 'replace'>('append')
const view = ref<'source' | 'preview'>('source')
const previewRevision = ref(0)
const busy = ref(false)
const error = ref('')
const sourceViewport = computed(() => {
  if (viewportMode.value === 'deck') return undefined
  const values = viewportMode.value === 'custom' ? [Number(customWidth.value), Number(customHeight.value)] : viewportMode.value.split('x').map(Number)
  return { width: values[0], height: values[1] }
})
const stageStyle = computed(() => {
  const width = viewportSize.value, height = width * viewportRatio.value
  const scale = Math.min((props.width - 44) / width, 400 / height)
  return { width: `${width}px`, height: `${height}px`, transform: `translate(-50%, -50%) scale(${scale})` }
})
const readHtml = async (files: FileList) => {
  const file = files[0]
  if (!file) return
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error('HTML 文件超过 100 MB，请精简内嵌资源后重试。')
    source.value = await file.text()
    error.value = ''
    view.value = 'source'
  }
  catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法读取 HTML 文件。'
  }
}
const loadExample = () => {
  source.value = exampleHtml
  viewportMode.value = 'deck'
  view.value = 'preview'
  error.value = ''
}
const apply = async () => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const viewport = sourceViewport.value
    if (viewport && (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value >= 1 && value <= 16384))) throw new Error('网页宽高需要在 1 到 16384 之间。')
    if (props.mode === 'edit') await updateHtmlSlideSource(editingSlideId, source.value, viewport)
    else await importHtmlDocument(source.value, { mode: importMode.value, viewport })
    message.success(props.mode === 'edit' ? '已更新 HTML 页面' : '已导入 HTML，可点击播放操作演示')
    emit('close')
  }
  catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法导入 HTML，请检查文件内容。'
  }
  finally {
    busy.value = false
  }
}
</script>

<style scoped lang="scss">
.html-document-dialog { max-height: calc(100vh - 88px); overflow: auto; }
.dialog-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 18px; }
h2 { margin: 0 0 7px; color: #1d1d1f; font-size: 20px; font-weight: 600; }
.dialog-heading p { margin: 0; color: #86868b; font-size: 12px; line-height: 1.5; }
.source-toolbar { display: flex; align-items: center; gap: 12px; margin: 0 0 12px; }
.view-tabs { display: flex; padding: 3px; border-radius: 7px; background: #ededf0; }
.view-tabs button { border: 0; border-radius: 5px; padding: 6px 18px; font: inherit; font-size: 12px; color: #77777d; background: transparent; cursor: pointer; }
.view-tabs .active { color: #303035; background: #fff; box-shadow: 0 1px 3px #0001; }
.text-button { color: #007aff; border: 0; padding: 5px 0; background: none; font: inherit; font-size: 12px; cursor: pointer; }
.html-source { display: block; box-sizing: border-box; width: 100%; height: 400px; resize: vertical; padding: 16px; border: 1px solid #dcdce0; border-radius: 9px; background: #fafafb; color: #25252a; font: 12px/1.65 'SFMono-Regular', Menlo, Consolas, monospace; tab-size: 2; outline-color: #007aff; }
.preview { position: relative; height: 400px; overflow: hidden; border: 1px solid #dcdce0; border-radius: 9px; background: #eeeff2; }
.preview > p { text-align: center; margin-top: 175px; color: #8e8e93; font-size: 13px; }
.preview-stage { position: absolute; top: 50%; left: 50%; transform-origin: center; background: white; }
.options { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 17px; font-size: 12px; }
.options label { display: flex; gap: 10px; align-items: center; }
.options select { height: 30px; padding: 0 9px; font: inherit; color: #424247; border: 1px solid #d8d8de; border-radius: 6px; background: #fff; }
.destination { margin-left: auto; }
.dimensions { display: flex; align-items: center; gap: 7px; }
.dimensions input { width: 66px; height: 28px; border: 1px solid #d8d8de; border-radius: 5px; padding: 0 5px; font: inherit; }
.help { color: #8e8e93; font-size: 11px; line-height: 1.6; margin: 14px 0 0; }
.error { color: #c83b3b; font-size: 12px; line-height: 1.5; }
.actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 18px; }
.actions > * { min-width: 100px; }
</style>
