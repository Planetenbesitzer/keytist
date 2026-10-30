<template>
  <div class="pdf-snapshots" data-testid="pdf-snapshot-export">
    <p class="intro">{{ t('在预览中调整交互状态，点击“冻结这一帧”。同一页可加入多个状态。') }}</p>
    <div class="preview-toolbar">
      <button type="button" :disabled="busy || previewIndex === 0" :aria-label="t('上一页')" @click="previewIndex--">‹</button>
      <select v-model.number="previewIndex" :disabled="busy" :aria-label="t('PDF 预览页面')">
        <option v-for="(slide, index) in deck.slides" :key="slide.id" :value="index">{{ t('第 {0} 页', { 0: index + 1 }) }}{{ framesFor(slide.id).length ? ` · ${framesFor(slide.id).length} ${t('帧')}` : '' }}</option>
      </select>
      <button type="button" :disabled="busy || previewIndex === deck.slides.length - 1" :aria-label="t('下一页')" @click="previewIndex++">›</button>
      <button type="button" class="freeze" :disabled="busy" data-testid="freeze-pdf-frame" @click="freezeCurrent">{{ freezing ? t('正在冻结…') : t('冻结这一帧') }}</button>
    </div>
    <div class="preview-viewport" :style="{ aspectRatio: `${deck.width} / ${deck.height}` }" ref="previewRoot">
      <ThumbnailSlide :key="previewSlide.id" :slide="previewSlide" :size="previewWidth" :htmlSource="previewSource" :interactiveHtml="!busy" />
      <div class="busy-mask" v-if="busy">{{ progress || t('正在冻结…') }}</div>
    </div>
    <div class="frozen-frames" v-if="currentFrames.length" :aria-label="t('已冻结的画面')">
      <div class="frozen-frame" v-for="(frame, index) in currentFrames" :key="frame.id">
        <img :src="frame.thumbnail" :alt="t('第 {0} 帧', { 0: index + 1 })" />
        <span>{{ t('第 {0} 帧', { 0: index + 1 }) }}</span>
        <button type="button" :disabled="busy" :aria-label="t('删除第 {0} 帧', { 0: index + 1 })" @click="removeFrame(frame.id)">×</button>
      </div>
    </div>
    <p class="empty-frames" v-else>{{ t('这一页还没有冻结画面；直接导出时会自动冻结一帧。') }}</p>
    <div class="options">
      <label>{{ t('导出范围：') }} <select v-model="range" :disabled="busy" :aria-label="t('导出范围：')"><option value="all">{{ t('全部') }}</option><option value="current">{{ t('当前预览页') }}</option></select></label>
      <label>{{ t('每页数量：') }} <select v-model.number="count" :disabled="busy" :aria-label="t('每页数量：')"><option :value="1">1</option><option :value="2">2</option><option :value="3">3</option></select></label>
      <label>{{ t('清晰度：') }} <select v-model.number="density" :disabled="busy" :aria-label="t('清晰度：')"><option :value="2">{{ t('高清（2 倍）') }}</option><option :value="3">{{ t('超清（3 倍）') }}</option></select></label>
      <label class="margin"><input type="checkbox" v-model="padding" :disabled="busy" /> {{ t('边缘留白：') }}</label>
    </div>
    <p class="hint">{{ t('未冻结的其他页面使用初始状态；同一页的多帧按加入顺序导出。') }} {{ t('PDF 是静态高清画面，不含交互，文字不能单独选取。') }}</p>
    <p class="error" role="alert" v-if="error">{{ error }}</p>
    <div class="actions">
      <span role="status">{{ busy ? progress : t('共 {0} 幅画面 · {1} 页 PDF', { 0: frameCount, 1: Math.ceil(frameCount / count) }) }}</span>
      <Button type="primary" :disabled="busy || !frameCount" data-testid="download-snapshot-pdf" @click="exportPdf">{{ exporting ? t('正在生成 PDF…') : t('下载 PDF') }}</Button>
      <Button :disabled="busy" @click="emit('close')">{{ t('关闭') }}</Button>
    </div>
    <div class="render-stage" aria-hidden="true">
      <div ref="auxiliaryRoot"><ThumbnailSlide v-if="auxiliarySlide" :key="auxiliaryToken" :slide="auxiliarySlide" :size="deck.width" :htmlSource="auxiliarySource" /></div>
      <div ref="rasterRoot"><ThumbnailSlide v-if="rasterSlide" :slide="rasterSlide" :size="deck.width" /></div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { saveAs } from 'file-saver'
import { getFontEmbedCSS, toSvg } from 'html-to-image'
import { useSlidesStore } from '@/store'
import { getLocalDocument } from '@/services/localDocument'
import { getSnapshotHistoryEpoch } from '@/store/snapshot'
import type { Slide } from '@/types/slides'
import { t } from '@/i18n'
import { assertExportImagesReady } from '@/utils/exportImageReadiness'
import { buildHtmlPdfSnapshotSource, captureHtmlPdfSnapshot } from '@/utils/htmlPdfSnapshot'
import { createHtmlSnapshotAppearance } from '@/utils/htmlSnapshotAppearance'
import { createPdfSnapshotSlide } from '@/utils/pdfSnapshotSlide'
import { createSnapshotPdf, SNAPSHOT_PDF_MAX_FRAMES } from '@/utils/snapshotPdf'
import Button from '@/components/Button.vue'
import ThumbnailSlide from '@/views/components/ThumbnailSlide/index.vue'

interface FrozenFrame { id: string; dataUrl: string; thumbnail: string; width: number; height: number }
const MAX_FRAME_DATA = 128 * 1024 * 1024
const emit = defineEmits<{ (event: 'close'): void }>()
const deck = getLocalDocument()
const epoch = getSnapshotHistoryEpoch()
const previewIndex = ref(Math.max(0, Math.min(deck.slides.length - 1, useSlidesStore().slideIndex)))
const previewRoot = useTemplateRef<HTMLElement>('previewRoot')
const auxiliaryRoot = useTemplateRef<HTMLElement>('auxiliaryRoot')
const rasterRoot = useTemplateRef<HTMLElement>('rasterRoot')
const previewWidth = ref(640)
const previewToken = ref(crypto.randomUUID())
const previewSlide = computed(() => deck.slides[previewIndex.value])
const previewSource = computed(() => previewSlide.value.html ? buildHtmlPdfSnapshotSource(previewSlide.value.html.source, previewToken.value) : undefined)
const frames = shallowRef<Record<string, FrozenFrame[]>>({})
const framesFor = (id: string) => frames.value[id] || []
const currentFrames = computed(() => framesFor(previewSlide.value.id))
const range = ref<'all' | 'current'>('all')
const count = ref<1 | 2 | 3>(1)
const density = ref(2)
const padding = ref(false)
const freezing = ref(false)
const exporting = ref(false)
const busy = computed(() => freezing.value || exporting.value)
const error = ref('')
const progress = ref('')
const includedSlides = computed(() => range.value === 'all' ? deck.slides : [previewSlide.value])
const frameCount = computed(() => includedSlides.value.reduce((sum, slide) => sum + Math.max(1, framesFor(slide.id).length), 0))
const auxiliarySlide = shallowRef<Slide>()
const auxiliaryToken = ref('')
const auxiliarySource = computed(() => auxiliarySlide.value?.html ? buildHtmlPdfSnapshotSource(auxiliarySlide.value.html.source, auxiliaryToken.value) : undefined)
const rasterSlide = shallowRef<Slide>()
const abort = new AbortController()
let observer: ResizeObserver | undefined
const checkCurrent = () => {
  if (abort.signal.aborted) throw new Error(t('PDF 导出已取消。'))
  if (getSnapshotHistoryEpoch() !== epoch) throw new Error(t('文稿已切换，请重新打开 PDF 导出。'))
}
const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
const readyFrame = async (root: HTMLElement | null) => {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    checkCurrent()
    const frame = root?.querySelector<HTMLIFrameElement>('.html-slide iframe[data-ready="true"]')
    if (frame) return frame
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(t('网页预览尚未准备好，请稍后重试。'))
}
const embeddedFontCss = () => (deck.embeddedFonts || []).map(font => `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(font.dataUrl)})}`).join('\n')
const rasterize = async (slide: Slide, usePreview: boolean): Promise<FrozenFrame> => {
  checkCurrent()
  let staticSlide = slide
  if (slide.html) {
    let frame: HTMLIFrameElement
    let token: string
    if (usePreview) {
      frame = await readyFrame(previewRoot.value)
      token = previewToken.value
    }
    else {
      token = crypto.randomUUID()
      auxiliaryToken.value = token
      auxiliarySlide.value = slide
      await nextTick()
      frame = await readyFrame(auxiliaryRoot.value)
    }
    const image = await captureHtmlPdfSnapshot(frame, { token, width: slide.html.width || deck.width, height: slide.html.height || deck.height, pixelRatio: density.value, signal: abort.signal })
    checkCurrent()
    staticSlide = await createPdfSnapshotSlide(slide, image, { width: deck.width, height: deck.height })
    auxiliarySlide.value = undefined
  }
  rasterSlide.value = staticSlide
  await nextTick()
  await paint()
  const root = rasterRoot.value?.querySelector<HTMLElement>('.thumbnail-slide')
  if (!root) throw new Error(t('无法准备 PDF 画面，请重试。'))
  await assertExportImagesReady([root])
  await document.fonts.ready
  const ratio = Math.min(density.value, 8192 / Math.max(deck.width, deck.height), Math.sqrt(32 * 1024 * 1024 / (deck.width * deck.height)))
  // Only existing CSS/document font assets are needed while drawing this PNG.
  // Missing system-family names do not trigger portable-font validation.
  const fontEmbedCSS = `${await getFontEmbedCSS(root)}\n${embeddedFontCss()}`
  const restoreAppearance = createHtmlSnapshotAppearance(root)
  const svg = await toSvg(root, {
    skipFonts: true, fontEmbedCSS, width: deck.width, height: deck.height, backgroundColor: '#ffffff',
    filter: (node: Node) => {
      if (!(node instanceof Element)) return true
      if (['SCRIPT', 'STYLE', 'LINK', 'META'].includes(node.tagName)) return false
      for (let current: Element | null = node; current; current = current.parentElement) {
        if (getComputedStyle(current).display === 'none') return false
      }
      return true
    },
  })
  const image = document.createElement('img')
  const canvas = document.createElement('canvas')
  const thumbnail = document.createElement('canvas')
  try {
    image.src = await restoreAppearance(svg)
    await image.decode()
    checkCurrent()
    canvas.width = Math.floor(deck.width * ratio); canvas.height = Math.floor(deck.height * ratio)
    const pageContext = canvas.getContext('2d')
    if (!pageContext) throw new Error(t('无法准备 PDF 画面，请重试。'))
    pageContext.fillStyle = '#fff'
    pageContext.fillRect(0, 0, canvas.width, canvas.height)
    pageContext.drawImage(image, 0, 0, canvas.width, canvas.height)
    checkCurrent()
    thumbnail.width = 220; thumbnail.height = Math.max(1, Math.round(220 * deck.height / deck.width))
    const context = thumbnail.getContext('2d')
    if (!context) throw new Error(t('无法准备 PDF 画面，请重试。'))
    context.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height)
    return { id: crypto.randomUUID(), dataUrl: canvas.toDataURL('image/png'), thumbnail: thumbnail.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  }
  finally {
    image.src = ''
    canvas.width = 0; canvas.height = 0
    thumbnail.width = 0; thumbnail.height = 0
    rasterSlide.value = undefined
  }
}
const freezeCurrent = async () => {
  if (busy.value) return
  error.value = ''; freezing.value = true; progress.value = t('正在冻结当前画面…')
  try {
    const saved = Object.values(frames.value).flat()
    if (saved.length >= SNAPSHOT_PDF_MAX_FRAMES) throw new Error(t('每次最多保留 300 帧，请分批导出。'))
    const slide = previewSlide.value
    const frame = await rasterize(slide, true)
    if (saved.reduce((sum, item) => sum + item.dataUrl.length, frame.dataUrl.length) > MAX_FRAME_DATA) throw new Error(t('冻结画面占用较大，请先导出一批或降低清晰度。'))
    frames.value = { ...frames.value, [slide.id]: [...framesFor(slide.id), frame] }
  }
  catch (reason) {
    if (!abort.signal.aborted) error.value = reason instanceof Error ? t(reason.message) : t('冻结画面失败，请重试。')
  }
  finally {
    freezing.value = false; progress.value = ''; auxiliarySlide.value = undefined; rasterSlide.value = undefined
  }
}
const removeFrame = (id: string) => {
  const slide = previewSlide.value
  frames.value = { ...frames.value, [slide.id]: framesFor(slide.id).filter(frame => frame.id !== id) }
}
const exportPdf = async () => {
  if (busy.value) return
  error.value = ''; exporting.value = true
  try {
    if (frameCount.value > SNAPSHOT_PDF_MAX_FRAMES) throw new Error(t('每次最多保留 300 帧，请分批导出。'))
    const selected = [...includedSlides.value]
    const pages: FrozenFrame[] = []
    let bytes = 0
    for (const [index, slide] of selected.entries()) {
      checkCurrent()
      progress.value = t('正在准备画面 {0}/{1}…', { 0: index + 1, 1: selected.length })
      const saved = framesFor(slide.id)
      const captured = saved.length ? saved : [await rasterize(slide, slide.id === previewSlide.value.id)]
      bytes += captured.reduce((sum, frame) => sum + frame.dataUrl.length, 0)
      if (bytes > MAX_FRAME_DATA) throw new Error(t('冻结画面占用较大，请先导出一批或降低清晰度。'))
      pages.push(...captured)
    }
    checkCurrent()
    const blob = await createSnapshotPdf(pages, { width: deck.width, height: deck.height, count: count.value, margin: padding.value ? 50 : 0, onProgress: (completed, total) => {
      checkCurrent()
      progress.value = t('正在生成 PDF {0}/{1}…', { 0: completed, 1: total })
    } })
    checkCurrent()
    const filename = Array.from(deck.title).map(char => char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char).join('') || 'Presentation'
    saveAs(blob, `${filename}.pdf`)
  }
  catch (reason) {
    if (!abort.signal.aborted) error.value = reason instanceof Error ? t(reason.message) : t('PDF 生成失败，请重试。')
  }
  finally {
    exporting.value = false; progress.value = ''; auxiliarySlide.value = undefined; rasterSlide.value = undefined
  }
}
watch(previewIndex, () => {
  previewToken.value = crypto.randomUUID(); error.value = ''
})
onMounted(() => {
  observer = new ResizeObserver(entries => {
    previewWidth.value = Math.max(1, entries[0].contentRect.width)
  })
  if (previewRoot.value) observer.observe(previewRoot.value)
})
onBeforeUnmount(() => {
  abort.abort(); observer?.disconnect()
})
</script>

<style lang="scss" scoped>
.pdf-snapshots { display:flex;flex-direction:column;gap:10px;max-height:100%;overflow:auto;padding:0 2px; }
.intro,.hint,.empty-frames { margin:0;color:#62666d;line-height:1.5;font-size:12px; }
.preview-toolbar { display:flex;gap:7px;align-items:center; }
button,select { border:1px solid #d5d8dd;border-radius:6px;background:white;color:#292d33;height:30px;font:inherit; }
button { cursor:pointer;padding:0 10px; }
button:disabled,select:disabled { opacity:.5;cursor:default; }
.preview-toolbar select { flex:1;min-width:0; }
.freeze { background:#eef4ff;border-color:#bed1ef;color:#225ea5; }
.preview-viewport { position:relative;overflow:hidden;background:white;border:1px solid #e1e4e8;border-radius:5px;flex-shrink:0; }
.busy-mask { position:absolute;inset:0;display:grid;place-items:center;background:#ffffffb8;color:#225ea5;z-index:10; }
.frozen-frames { display:flex;gap:8px;overflow-x:auto;flex-shrink:0;padding:1px 0 5px; }
.frozen-frame { position:relative;flex:0 0 110px;font-size:11px;text-align:center; }
.frozen-frame img { display:block;width:110px;aspect-ratio:16/9;object-fit:contain;background:white;border:1px solid #d6dfeb;border-radius:4px;margin-bottom:3px; }
.frozen-frame button { position:absolute;right:3px;top:3px;height:19px;width:19px;padding:0;border-radius:50%;background:#fff;line-height:16px; }
.options { display:flex;gap:12px;flex-wrap:wrap;font-size:12px;align-items:center; }
.options label { display:flex;gap:4px;align-items:center; }
.options select { height:26px;font-size:12px; }
.options .margin { gap:0; }
.actions { display:flex;align-items:center;gap:9px;padding:10px 0 1px;position:sticky;bottom:0;background:white;margin-top:auto; }
.actions span { flex:1;color:#62666d;font-size:12px; }
.error { margin:0;color:#b42318;font-size:12px;line-height:1.5; }
.render-stage { position:fixed;left:-100000px;top:0;pointer-events:none; }
</style>
