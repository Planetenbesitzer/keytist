<template>
  <div class="html-slide" :data-ready="ready ? 'true' : 'false'"
    :style="{ width: `${width}px`, height: `${height}px`, transform: placementTransform, pointerEvents: interactive ? 'auto' : 'none' }">
    <iframe ref="frameElement" :width="virtualWidth" :height="virtualHeight" :style="iframeStyle" sandbox="allow-scripts allow-forms"
      :title="t('HTML 幻灯片')" referrerpolicy="no-referrer" :tabindex="interactive ? 0 : -1"
      :aria-hidden="!interactive" :data-ready="ready ? 'true' : 'false'" @load="handleLoad" />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { getHtmlPlacementTransform } from '@/utils/htmlPlacement'

const props = withDefaults(defineProps<{ source: string; width: number; height: number; sourceWidth?: number; sourceHeight?: number; left?: number; top?: number; scale?: number; interactive?: boolean }>(), { interactive: false })
const placementTransform = computed(() => getHtmlPlacementTransform(props))
const virtualWidth = computed(() => props.sourceWidth ?? props.width)
const virtualHeight = computed(() => props.sourceHeight ?? props.height)
const iframeStyle = computed(() => {
  const scale = Math.min(props.width / virtualWidth.value, props.height / virtualHeight.value)
  return { width: `${virtualWidth.value}px`, height: `${virtualHeight.value}px`, left: `${(props.width - virtualWidth.value * scale) / 2}px`, top: `${(props.height - virtualHeight.value * scale) / 2}px`, transform: `scale(${scale})` }
})
const ready = ref(false)
// Probe only a trusted blank document. User HTML is assigned verbatim once the
// sandbox confirms its viewport, avoiding a first-navigation innerWidth=0 race.
const frameElement = ref<HTMLIFrameElement>()
let mounted = false
let frame = 0
let focusFrame = 0
let loadGeneration = 0
let cleanupProbe: (() => void) | undefined
let lastParentFocus: HTMLElement | undefined
const rememberParentFocus = (event?: FocusEvent) => {
  const target = event?.target ?? document.activeElement
  if (target instanceof HTMLElement && target !== frameElement.value && target !== document.body && target !== document.documentElement) lastParentFocus = target
}
const guardFocus = () => {
  if (!mounted || props.interactive || document.activeElement !== frameElement.value) return
  frameElement.value?.blur()
  if (lastParentFocus?.isConnected) lastParentFocus.focus({ preventScroll: true })
}
const checkFrameFocus = () => {
  cancelAnimationFrame(focusFrame)
  focusFrame = requestAnimationFrame(guardFocus)
}
const loadSource = async () => {
  const generation = ++loadGeneration
  ready.value = false
  cleanupProbe?.()
  cancelAnimationFrame(frame)
  if (!mounted) return
  await nextTick()
  const target = frameElement.value
  if (!mounted || generation !== loadGeneration || !target) return
  const width = Math.round(virtualWidth.value), height = Math.round(virtualHeight.value)
  const token = crypto.randomUUID()
  const cleanup = () => {
    window.removeEventListener('message', receiveViewport)
    if (cleanupProbe === cleanup) cleanupProbe = undefined
  }
  const receiveViewport = (event: MessageEvent) => {
    if (event.source !== target.contentWindow || event.data?.studioViewport !== token || event.data.width !== width || event.data.height !== height) return
    cleanup()
    if (mounted && generation === loadGeneration) target.srcdoc = props.source
  }
  cleanupProbe = cleanup
  window.addEventListener('message', receiveViewport)
  const probe = `(()=>{const check=()=>{if(innerWidth===${width}&&innerHeight===${height})parent.postMessage({studioViewport:${JSON.stringify(token)},width:innerWidth,height:innerHeight},'*');else setTimeout(check,16)};check()})()`
  target.srcdoc = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${probe}<${'/'}script></body></html>`
}
const handleLoad = () => {
  if (frameElement.value?.srcdoc !== props.source) return
  const generation = loadGeneration
  // A srcdoc load can precede activation of its transformed compositor surface.
  // Two paint opportunities make readiness useful for clicks and export too.
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (mounted && generation === loadGeneration && frameElement.value?.srcdoc === props.source) ready.value = true
    })
  })
}
watch(() => [props.source, virtualWidth.value, virtualHeight.value], loadSource)
onMounted(() => {
  mounted = true
  rememberParentFocus()
  document.addEventListener('focusin', rememberParentFocus, true)
  window.addEventListener('blur', checkFrameFocus)
  frameElement.value?.addEventListener('focus', checkFrameFocus)
  void loadSource()
})
onBeforeUnmount(() => {
  mounted = false
  cancelAnimationFrame(frame)
  cancelAnimationFrame(focusFrame)
  cleanupProbe?.()
  document.removeEventListener('focusin', rememberParentFocus, true)
  window.removeEventListener('blur', checkFrameFocus)
  frameElement.value?.removeEventListener('focus', checkFrameFocus)
})
</script>

<style scoped>
.html-slide { position: absolute; top: 0; left: 0; overflow: hidden; z-index: 0; transform-origin: 0 0; }
iframe { display: block; position: absolute; border: 0; transform-origin: 0 0; }
</style>
