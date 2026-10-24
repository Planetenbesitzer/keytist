<template>
  <section class="image-shadow" aria-label="图片阴影">
    <div class="heading"><span>图片阴影</span><span class="current">{{ shadow ? descriptions[kind] : '无阴影' }}</span></div>
    <div class="presets">
      <button
        v-for="preset in shadowPresets" :key="preset.id" type="button"
        :aria-label="preset.id === 'none' ? '无阴影' : `${preset.label}阴影`"
        :aria-pressed="matchesPreset(preset.shadow)"
        :class="{ selected: matchesPreset(preset.shadow) }"
        @click="managedPresetId = preset.id; applyPreset(preset.shadow)"
      >
        <span class="preview">
          <span class="sample">
            <BaseImageElement :elementInfo="previewImage(preset.shadow)" />
          </span>
        </span>
        <span>{{ preset.label }}</span>
      </button>
    </div>
    <details class="shadow-management" @keydown.stop @mousedown.stop>
      <summary>管理阴影样式<span v-if="managedPreset && !matchesPreset(managedPreset.shadow)"> · 已修改</span></summary>
      <label>预设<select aria-label="要编辑的阴影预设" v-model="managedPresetId"><option v-for="preset in shadowPresets" :key="preset.id" :value="preset.id">{{ preset.label }}</option></select></label>
      <label>名称<input aria-label="阴影预设名称" v-model="presetName" maxlength="40"></label>
      <div class="shadow-actions">
        <button type="button" :disabled="!presetName.trim()" @click="renameShadowPreset">重命名</button>
        <button type="button" :disabled="!shadow || managedPresetId === 'none'" @click="redefineShadowPreset">用当前阴影重定义</button>
        <button type="button" @click="restoreShadowPresets">恢复内置阴影</button>
      </div>
      <p>重定义只更新预设，已有图片的阴影不会改变。无阴影预设始终保留为无阴影。</p>
      <div v-if="presetError" class="preset-error" role="alert">{{ presetError }}</div>
    </details>
    <div class="adjustments" v-if="shadow" @keydown.stop>
      <label class="row"><span>模糊</span>
        <input type="range" aria-label="阴影模糊滑块" min="0" max="60" :value="shadow.blur" @input="setNumber('blur', $event)">
        <input type="number" aria-label="阴影模糊" min="0" max="100" :value="round(shadow.blur)" @input="setNumber('blur', $event)"><span class="unit">px</span>
      </label>
      <label class="row"><span>不透明度</span>
        <input type="range" aria-label="阴影不透明度滑块" min="0" max="100" :value="opacity" @input="setOpacity($event)">
        <input type="number" aria-label="阴影不透明度" min="0" max="100" :value="opacity" @input="setOpacity($event)"><span class="unit">%</span>
      </label>
      <label class="row"><span>偏移</span>
        <input type="range" aria-label="阴影偏移滑块" min="0" max="60" :value="offset" @input="setOffset($event)">
        <input type="number" aria-label="阴影偏移" min="0" max="100" :value="offset" @input="setOffset($event)"><span class="unit">px</span>
      </label>
      <label class="row" v-if="kind === 'drop'"><span>角度</span>
        <input type="range" aria-label="阴影角度滑块" min="0" max="359" :value="angle" @input="setAngle($event)">
        <input type="number" aria-label="阴影角度" min="0" max="359" :value="angle" @input="setAngle($event)"><span class="unit">°</span>
      </label>
      <template v-if="kind === 'contact'">
        <label class="row"><span>透视</span>
          <input type="range" aria-label="阴影透视滑块" min="0" max="100" :value="(shadow.perspective ?? 0.35) * 100" @input="setNumber('perspective', $event, 0.01)">
          <input type="number" aria-label="阴影透视" min="0" max="100" :value="round((shadow.perspective ?? 0.35) * 100)" @input="setNumber('perspective', $event, 0.01)"><span class="unit">%</span>
        </label>
      </template>
      <template v-if="kind === 'curved'">
        <label class="row"><span>弯曲</span>
          <input type="range" aria-label="阴影弯曲滑块" min="-100" max="100" :value="(shadow.curve ?? 0.65) * 100" @input="setNumber('curve', $event, 0.01)">
          <input type="number" aria-label="阴影弯曲" min="-100" max="100" :value="round((shadow.curve ?? 0.65) * 100)" @input="setNumber('curve', $event, 0.01)"><span class="unit">%</span>
        </label>
        <div class="curve-labels"><span>中间隆起</span><span>两端翘起</span></div>
      </template>
      <div class="color-row"><span>颜色</span>
        <Popover trigger="click">
          <template #content><ColorPicker :modelValue="shadow.color" @update:modelValue="value => updateShadow({ color: value })" /></template>
          <button type="button" class="color-button" aria-label="阴影颜色" :title="shadow.color"><span :style="{ backgroundColor: shadow.color }"></span></button>
        </Popover>
        <span class="color-name">{{ tinycolor(shadow.color).toHexString().toUpperCase() }}</span>
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import tinycolor from 'tinycolor2'
import { useMainStore, useSlidesStore } from '@/store'
import type { PPTImageElement, PPTImageShadow } from '@/types/slides'
import { useStylePresetsStore } from '@/store/stylePresets'
import message from '@/utils/message'
import { getImageShadowKind } from '@/utils/imageShadow'
import useHistorySnapshot from '@/hooks/useHistorySnapshot'
import BaseImageElement from '@/views/components/element/ImageElement/BaseImageElement.vue'
import ColorPicker from '@/components/ColorPicker/index.vue'
import Popover from '@/components/Popover.vue'

const slidesStore = useSlidesStore()
const stylePresetsStore = useStylePresetsStore()
const { handleElement } = storeToRefs(useMainStore())
const { addHistorySnapshot } = useHistorySnapshot()
const shadow = computed(() => handleElement.value?.type === 'image' ? handleElement.value.shadow : undefined)
const kind = computed(() => getImageShadowKind(shadow.value))
const descriptions = { drop: '悬浮投影', contact: '落地接触', curved: '纸张翘边' }
const opacity = computed(() => Math.round(tinycolor(shadow.value?.color).getAlpha() * 100))
const offset = computed(() => round(Math.hypot(shadow.value?.h || 0, shadow.value?.v || 0)))
const angle = computed(() => (Math.round(Math.atan2(-(shadow.value?.v || 0), shadow.value?.h || 0) * 180 / Math.PI) + 360) % 360)
const round = (value: number) => Math.round(value * 10) / 10
const shadowPresets = computed(() => stylePresetsStore.library.shadows)
const managedPresetId = ref('curved')
const managedPreset = computed(() => shadowPresets.value.find(preset => preset.id === managedPresetId.value))
const presetName = ref('')
const presetError = ref('')
const matchesPreset = (value?: PPTImageShadow) => {
  const keys = ['type', 'h', 'v', 'blur', 'color', 'curve', 'perspective'] as const
  return JSON.stringify(keys.map(key => value?.[key])) === JSON.stringify(keys.map(key => shadow.value?.[key]))
}
watch(() => handleElement.value?.id, () => {
  managedPresetId.value = shadowPresets.value.find(preset => matchesPreset(preset.shadow))?.id || (shadow.value ? kind.value : 'none')
}, { immediate: true })
watch(managedPreset, preset => {
  presetName.value = preset?.label || ''
}, { immediate: true })
const saveShadowPreset = (action: () => void, success: string) => {
  try {
    action(); presetError.value = ''; message.success(success)
  }
  catch (error) {
    presetError.value = error instanceof Error ? error.message : '保存失败，原阴影预设已保留。'
  }
}
const renameShadowPreset = () => {
  if (managedPreset.value) saveShadowPreset(() => stylePresetsStore.updateShadow(managedPresetId.value, presetName.value, managedPreset.value!.shadow), '阴影预设已重命名')
}
const redefineShadowPreset = () => {
  if (shadow.value && managedPresetId.value !== 'none') saveShadowPreset(() => stylePresetsStore.updateShadow(managedPresetId.value, presetName.value, { ...shadow.value! }), '已用当前阴影重定义预设')
}
const restoreShadowPresets = () => saveShadowPreset(() => stylePresetsStore.restoreShadows(), '内置阴影预设已恢复，已有图片外观保留')

const applyPreset = (value?: PPTImageShadow) => {
  if (handleElement.value?.type !== 'image') return
  const id = handleElement.value.id
  if (value) slidesStore.updateElement({ id, props: { shadow: { ...value } } })
  else slidesStore.removeElementProps({ id, propName: 'shadow' })
  addHistorySnapshot()
}
const updateShadow = (value: Partial<PPTImageShadow>) => {
  if (!shadow.value) return
  applyPreset({ ...shadow.value, ...value })
}
const numberFrom = (event: Event, min: number, max: number) => {
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
const setNumber = (key: 'blur' | 'perspective' | 'curve', event: Event, scale = 1) => {
  if (!(event.target as HTMLInputElement).value.trim()) return
  const value = numberFrom(event, key === 'curve' ? -100 : 0, 100) * scale
  updateShadow({ [key]: value })
}
const setOpacity = (event: Event) => {
  if (!(event.target as HTMLInputElement).value.trim()) return
  updateShadow({ color: tinycolor(shadow.value!.color).setAlpha(numberFrom(event, 0, 100) / 100).toRgbString() })
}
const setOffset = (event: Event) => {
  if (!(event.target as HTMLInputElement).value.trim()) return
  const distance = numberFrom(event, 0, 100)
  const radians = angle.value * Math.PI / 180
  updateShadow(kind.value === 'drop' ? { h: round(distance * Math.cos(radians)), v: round(-distance * Math.sin(radians)) } : { h: 0, v: distance })
}
const setAngle = (event: Event) => {
  if (!(event.target as HTMLInputElement).value.trim()) return
  const radians = numberFrom(event, 0, 359) * Math.PI / 180
  updateShadow({ h: round(offset.value * Math.cos(radians)), v: round(-offset.value * Math.sin(radians)) })
}
const sampleSource = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="130" viewBox="0 0 200 130"><defs><linearGradient id="s" x2="1" y2="1"><stop stop-color="#d4e6ed"/><stop offset="1" stop-color="#93b4c6"/></linearGradient></defs><path fill="url(#s)" d="M0 0h200v130H0z"/><circle cx="148" cy="38" r="16" fill="#faf4e3"/><path d="M0 113l65-67 49 43 35-32 51 55v18H0z" fill="#698c9c"/><path d="M0 130v-16l65-37 77 53z" fill="#466d80"/></svg>')
const previewImage = (value?: PPTImageShadow): PPTImageElement => ({
  type: 'image', id: 'shadow-preview', src: sampleSource, left: 0, top: 0, width: 200, height: 130, rotate: 0, fixedRatio: true,
  shadow: value,
})
</script>

<style lang="scss" scoped>
.heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-weight: 600; }
.current { color: #8e8e93; font-size: 11px; font-weight: 400; }
.presets {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px;
  button {
    display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px 0 8px; border: 1px solid #e5e5ea; border-radius: 8px;
    background: #fafafa; color: #636366; font: inherit; font-size: 11px; cursor: pointer;
    &:hover { background: #f0f4ff; }
    &.selected { border-color: $themeColor; background: #edf3ff; color: $themeColor; }
    &:focus-visible { outline: 2px solid $themeColor; outline-offset: 2px; }
  }
}
.preview { display: grid; place-items: center; width: 100%; height: 35px; pointer-events: none; }
.sample { position: relative; width: 40px; height: 26px; }
.sample :deep(.base-element-image) { transform: scale(.2); transform-origin: 0 0; }
.adjustments { margin-top: 14px; }
.row { display: grid; grid-template-columns: 55px minmax(48px, 1fr) 43px 17px; align-items: center; gap: 6px; min-height: 34px; font-size: 11px; }
input[type='range'] { appearance: none; height: 4px; width: 100%; min-width: 0; margin: 0; border-radius: 3px; background: #d6d7dc; cursor: pointer; accent-color: $themeColor; }
input[type='range']::-webkit-slider-thumb { appearance: none; height: 12px; width: 12px; border-radius: 50%; background: #fff; border: 1px solid #c7c8cd; box-shadow: 0 1px 2px #0002; }
input[type='range']:focus-visible { outline: 2px solid $themeColor; outline-offset: 4px; }
input[type='number'] { box-sizing: border-box; width: 100%; height: 25px; padding: 0 3px; text-align: right; border: 1px solid #d9d9de; border-radius: 5px; font: inherit; color: #424247; background: #fff; }
.unit { color: #8e8e93; }
.curve-labels { display: flex; justify-content: space-between; margin: -1px 70px 8px 61px; color: #8e8e93; font-size: 10px; }
.color-row { display: flex; align-items: center; gap: 12px; min-height: 34px; font-size: 11px; }
.color-row > span:first-child { width: 43px; }
.color-button { display: block; padding: 3px; width: 48px; height: 25px; background: #fff; border: 1px solid #d9d9de; border-radius: 5px; cursor: pointer; }
.color-button span { display: block; width: 100%; height: 100%; border-radius: 2px; }
.color-name { color: #8e8e93; font-variant-numeric: tabular-nums; }
.shadow-management { font-size: 11px; margin-top: 12px; }
.shadow-management summary { color: #636366; cursor: pointer; }
.shadow-management label { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.shadow-management input, .shadow-management select { min-width: 0; flex: 1; height: 26px; border: 1px solid #d1d1d6; border-radius: 5px; padding: 0 5px; background: white; font: inherit; }
.shadow-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
.shadow-actions button { padding: 4px; min-height: 28px; border: 1px solid #d1d1d6; border-radius: 5px; color: #3a3a3c; background: #fff; cursor: pointer; font: inherit; }
.shadow-actions button:disabled { opacity: .4; cursor: default; }
.shadow-management p { color: #8e8e93; line-height: 1.6; margin: 8px 0 0; }
.preset-error { color: #c9342b; margin-top: 8px; line-height: 1.5; }
</style>
