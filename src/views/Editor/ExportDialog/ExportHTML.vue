<template>
  <div class="export-html-dialog">
    <div class="render-slides" aria-hidden="true" ref="thumbnailsRef">
      <ThumbnailSlide v-for="slide in slides" :key="slide.id" :slide="slide" :size="viewportSize" />
    </div>
    <div class="description">
      <h3>{{ t("紧凑的 HTML，随处演示") }}</h3>
      <p>{{ t("保留文字、公式、图片和阴影，附带翻页、全屏与打印。可以直接打开，也可以发布到静态网站。") }}</p>
      <p>{{ t("自动携带英文和公式所需的字体，播放时无需另装这些字体。中文不新增打包字库，使用播放设备的字体，换行和字形可能不同。") }}</p>
      <p v-if="hasHtml">{{ t("导入的 HTML 保留交互及原有的内嵌字体和素材；外部脚本、图片等仍需原有网络与文件。离开页面会暂停并重置它的脚本。") }}</p>
      <p>{{ t("默认导出紧凑播放版，减少重复素材和排版数据，保留原有画质与交互。") }}</p>
      <div v-if="fontReport" class="font-report" aria-live="polite">
        <strong>{{ t("英文与公式字体 ·") }} {{ fontStyleCount }} {{ t("款样式") }}</strong>
        <span>{{ t("自动打包预计增加") }} {{ formatBytes(fontReport.encodedBytes) }}{{ t("，相同字体只保存一次。") }}</span>
        <span v-if="hasHtml">{{ t("原网页已有的字体与素材保留，不计入上述增量。") }}</span>
        <span v-for="warning in fontWarnings" :key="warning">{{ t(warning) }}</span>
      </div>
      <div v-if="sizeWarning" ref="warningRef" class="font-warning" role="alert">
        <strong>{{ t("字体包较大") }}</strong>
        <p>{{ t("自动打包的英文与公式字体预计占用") }} {{ formatBytes(fontReport?.encodedBytes || 0) }}{{ t("，超过 5 MB 提醒值。保留这些字体可稳定英文与公式的排版；中文使用设备字体。完整文件还会压缩。") }}</p>
        <p v-for="font in largestFonts" :key="font.sourceFamily + font.style + font.weight">{{ font.sourceFamily }} · {{ weightLabel(font.weight) }}{{ font.style === 'italic' ? t(" / 斜体") : '' }} · {{ formatBytes(font.encodedBytes) }}</p>
      </div>
      <p v-if="error" class="export-error" role="alert">{{ t(error) }}</p>
      <div class="editable-option">
        <Checkbox v-model:value="keepEditable" :disabled="exporting">{{ t("保留重新导入编辑能力") }}</Checkbox>
        <p class="option-hint">{{ t("勾选后额外保留完整文稿，文件会更大。未勾选时，文本框等原生对象不能从 HTML 中恢复编辑。字体包用于发布播放，重新编辑仍沿用原文稿的字体设置。") }}</p>
      </div>
    </div>
    <div class="btns">
      <template v-if="sizeWarning"><Button type="primary" @click="finishSizeDecision(true)">{{ t("保留字体并继续导出") }}</Button><Button @click="finishSizeDecision(false)">{{ t("取消导出") }}</Button></template>
      <template v-else><Button type="primary" :disabled="exporting" @click="exportHtml"><i-icon-park-outline:download /> {{ exporting ? t("正在打包…") : t("导出 HTML") }}</Button><Button :disabled="exporting" @click="emit('close')">{{ t("关闭") }}</Button></template>
    </div>
    <FullscreenSpin :loading="exporting && !sizeWarning" :tip="t('正在检查并打包页面、字体与素材…')" />
  </div>
</template>

<script lang="ts" setup>
import { t } from '@/i18n'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { saveAs } from 'file-saver'
import { useSlidesStore } from '@/store'
import { getSnapshotHistoryEpoch } from '@/store/snapshot'
import { getLocalDocument } from '@/services/localDocument'
import { exportHtmlPresentation } from '@/utils/htmlExport'
import { prepareHtmlExportFonts } from '@/utils/htmlFontCapture'
import type { PortableFontReport } from '@/utils/portableFonts'
import message from '@/utils/message'
import ThumbnailSlide from '@/views/components/ThumbnailSlide/index.vue'
import Button from '@/components/Button.vue'
import Checkbox from '@/components/Checkbox.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'

const emit = defineEmits<{ (event: 'close'): void }>()
const { slides, viewportSize } = storeToRefs(useSlidesStore())
const thumbnailsRef = useTemplateRef<HTMLElement>('thumbnailsRef')
const warningRef = useTemplateRef<HTMLElement>('warningRef')
const exporting = ref(false)
const keepEditable = ref(false)
const fontReport = shallowRef<PortableFontReport>()
const sizeWarning = ref(false)
const error = ref('')
const largestFonts = computed(() => [...(fontReport.value?.faces || [])].filter((font, index, faces) => faces.findIndex(other => other.sourceFamily === font.sourceFamily && other.weight === font.weight && other.style === font.style && other.encodedBytes === font.encodedBytes) === index).sort((a, b) => b.encodedBytes - a.encodedBytes).slice(0, 3))
const fontWarnings = computed(() => [...new Set(fontReport.value?.warnings || [])].slice(0, 3))
const fontStyleCount = computed(() => new Set((fontReport.value?.faces || []).map(font => `${font.sourceFamily}/${font.weight}/${font.style}`)).size)
const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${Math.ceil(bytes / 1024)} KB`
const weightLabel = (weight: number | string) => String(weight).includes(' ') ? '可变字重' : Number(weight) === 400 ? '常规' : Number(weight) === 700 ? '粗体' : `字重 ${weight}`
let sizeDecision: ((proceed: boolean) => void) | undefined
const finishSizeDecision = (proceed: boolean) => {
  sizeWarning.value = false
  sizeDecision?.(proceed)
  sizeDecision = undefined
}
onBeforeUnmount(() => finishSizeDecision(false))
const hasHtml = computed(() => slides.value.some(slide => 'html' in slide))
const exportHtml = async () => {
  if (!thumbnailsRef.value || exporting.value) return
  exporting.value = true
  error.value = ''
  fontReport.value = undefined
  const epoch = getSnapshotHistoryEpoch()
  const editable = keepEditable.value
  let documentChanged = false
  const markChanged = () => {
    documentChanged = true
    if (sizeWarning.value) finishSizeDecision(false)
  }
  window.addEventListener('keynote-local:change', markChanged)
  try {
    await nextTick()
    const snapshot = getLocalDocument()
    const roots = Array.from(thumbnailsRef.value.querySelectorAll<HTMLElement>('.thumbnail-slide'))
    const preparedFonts = await prepareHtmlExportFonts(snapshot, roots, { editable })
    fontReport.value = preparedFonts.report
    if (documentChanged || epoch !== getSnapshotHistoryEpoch()) throw new Error('检查字体期间文稿发生变化，请重试以使用最新内容。')
    if (preparedFonts.report.encodedBytes >= 5 * 1024 * 1024) {
      sizeWarning.value = true
      const decision = new Promise<boolean>(resolve => {
        sizeDecision = resolve
      })
      await nextTick()
      warningRef.value?.scrollIntoView({ block: 'nearest' })
      const proceed = await decision
      if (!proceed) return
    }
    if (documentChanged || epoch !== getSnapshotHistoryEpoch()) throw new Error('文稿发生变化，请重新导出。')
    const html = await exportHtmlPresentation(snapshot, roots, { editable, preparedFonts })
    if (documentChanged || epoch !== getSnapshotHistoryEpoch()) throw new Error('导出期间文稿发生变化，请重试以使用最新内容。')
    const name = Array.from(snapshot.title).map(character => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('') || '演示文稿'
    saveAs(new Blob([html], { type: 'text/html;charset=utf-8' }), `${name}.html`)
  }
  catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'HTML 导出失败，请检查文稿素材后重试'
    message.error(error.value)
  }
  finally {
    window.removeEventListener('keynote-local:change', markChanged)
    exporting.value = false
    sizeWarning.value = false
  }
}
</script>

<style lang="scss" scoped>
.export-html-dialog { height: 100%; display: flex; align-items: center; justify-content: flex-start; flex-direction: column; position: relative; overflow: auto; padding:20px 0 0; box-sizing:border-box; }
.render-slides { position: fixed; left: -100000px; top: 0; pointer-events: none; }
.description { width: 390px; max-width: 95%; line-height: 1.8; color: #666; flex-shrink:0; }
h3 { color: #1d1d1f; font-size: 20px; font-weight: 600; margin: 0 0 14px; }
p { margin: 10px 0; }
.btns { display: flex; justify-content:center; gap: 10px; margin-top:auto; padding:18px 0; width:100%; position:sticky; bottom:0; z-index:1; background:#fff; flex-shrink:0; }
.editable-option { margin-top: 18px; padding-top: 16px; border-top: 1px solid #e5e5ea; }
.option-hint { margin: 8px 0 0; font-size: 12px; color: #777; line-height: 1.6; }
.font-report { display:flex; flex-direction:column; gap:4px; padding:12px; background:#f1f6ff; border:1px solid #dce9fc; border-radius:7px; font-size:12px; strong{color:#245a94;} }
.font-warning { margin-top:12px; padding:12px; border:1px solid #efce8e; border-radius:7px; background:#fff8e9; font-size:12px; color:#72511c; p{margin:6px 0 0;} }
.export-error { color:#c2352b; white-space:pre-wrap; font-size:12px; line-height:1.6; }
</style>
