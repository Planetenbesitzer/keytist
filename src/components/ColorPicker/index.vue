<template>
  <div class="color-picker">
    <div class="picker-tabs" role="tablist" aria-label="颜色选择方式">
      <button @mousedown.prevent type="button" role="tab" :aria-selected="activeTab === 'palette'" :class="{ active: activeTab === 'palette' }" @click="activeTab = 'palette'">色板</button>
      <button @mousedown.prevent type="button" role="tab" :aria-selected="activeTab === 'custom'" :class="{ active: activeTab === 'custom' }" @click="activeTab = 'custom'">调色</button>
    </div>

    <div class="palette-panel" v-if="activeTab === 'palette'">
      <div class="palette-heading"><span>文稿配色</span></div>
      <div class="swatch-grid document-colors" role="group" aria-label="文稿配色">
        <button @mousedown.prevent v-for="c in themeColors" :key="c" type="button" class="color-swatch" :class="{ selected: isSelected(c) }" :style="{ '--swatch-color': c }" :title="colorLabel(c)" :aria-label="`文稿色 ${colorLabel(c)}`" :aria-pressed="isSelected(c)" @click="selectPresetColor(c)"></button>
      </div>

      <div class="palette-heading common-heading">
        <span>协调配色</span>
        <select v-model="selectedScheme" aria-label="协调色板">
          <option v-for="scheme in STUDIO_COLOR_SCHEMES" :key="scheme.id" :value="scheme.id">{{ scheme.name }}</option>
        </select>
      </div>
      <div class="swatch-grid coordinated-colors" :style="{ gridTemplateColumns: `repeat(${schemeColors.length}, minmax(0, 1fr))` }" role="group" aria-label="协调配色：浅色、主色、深色">
        <button @mousedown.prevent v-for="swatch in coordinatedColors" :key="swatch.label + swatch.color" type="button" class="color-swatch" :class="{ selected: isSelected(swatch.color) }" :style="{ '--swatch-color': swatch.color }" :title="`${swatch.label} · ${colorLabel(swatch.color)}`" :aria-label="`${swatch.label} ${colorLabel(swatch.color)}`" :aria-pressed="isSelected(swatch.color)" @click="selectPresetColor(swatch.color)"></button>
      </div>

      <div class="palette-heading"><span>灰阶</span></div>
      <div class="swatch-grid" role="group" aria-label="灰阶">
        <button @mousedown.prevent v-for="c in STUDIO_NEUTRAL_COLORS" :key="c" type="button" class="color-swatch" :class="{ selected: isSelected(c) }" :style="{ '--swatch-color': c }" :title="colorLabel(c)" :aria-label="`灰阶 ${colorLabel(c)}`" :aria-pressed="isSelected(c)" @click="selectPresetColor(c)"></button>
      </div>

      <div class="palette-heading saved-heading">
        <span>我的常用色</span>
        <div class="palette-actions">
          <button @mousedown.prevent v-if="favoriteColors.length" type="button" class="text-action" :aria-pressed="editingFavorites" @click="editingFavorites = !editingFavorites">{{ editingFavorites ? '完成' : '整理' }}</button>
          <button @mousedown.prevent type="button" class="add-color" :disabled="currentIsFavorite || favoriteColors.length >= MAX_FAVORITES" aria-label="将当前颜色保存为常用色" :title="currentIsFavorite ? '当前颜色已保存' : '保存当前颜色'" @click="saveFavorite()">＋</button>
        </div>
      </div>
      <div v-if="favoriteColors.length" class="swatch-grid saved-colors" role="group" aria-label="我的常用色">
        <button @mousedown.prevent v-for="c in favoriteColors" :key="c" type="button" class="color-swatch" :class="{ selected: !editingFavorites && isSelected(c), removable: editingFavorites }" :style="{ '--swatch-color': c }" :title="`${editingFavorites ? '删除 ' : ''}${colorLabel(c)}`" :aria-label="`${editingFavorites ? '删除常用色' : '常用色'} ${colorLabel(c)}`" :aria-pressed="!editingFavorites && isSelected(c)" @click="editingFavorites ? removeFavorite(c) : selectPresetColor(c)"><span v-if="editingFavorites" aria-hidden="true">−</span></button>
      </div>
      <p class="palette-empty" v-else>点 ＋ 保存当前颜色</p>

      <template v-if="recentColors.length">
        <div class="palette-heading"><span>最近使用</span></div>
        <div class="swatch-grid recent-colors" role="group" aria-label="最近使用的颜色">
          <button @mousedown.prevent v-for="c in recentColors" :key="c" type="button" class="color-swatch" :class="{ selected: isSelected(c) }" :style="{ '--swatch-color': c }" :title="colorLabel(c)" :aria-label="`最近色 ${colorLabel(c)}`" :aria-pressed="isSelected(c)" @click="selectPresetColor(c)"></button>
        </div>
      </template>
    </div>

    <div class="custom-panel" v-else>
      <div class="picker-saturation-wrap"><Saturation :value="color" :hue="hue" @colorChange="value => changeColor(value)" /></div>
      <div class="picker-controls">
        <div class="picker-sliders">
          <div class="picker-hue-wrap"><Hue :value="color" :hue="hue" @colorChange="value => changeColor(value)" /></div>
          <div class="picker-alpha-wrap"><Alpha :value="color" @colorChange="value => changeColor(value)" /></div>
        </div>
      </div>
      <button @mousedown.prevent type="button" class="save-custom-color" :disabled="currentIsFavorite || favoriteColors.length >= MAX_FAVORITES" @click="saveFavorite()">{{ currentIsFavorite ? '已保存到常用色' : '＋ 保存到常用色' }}</button>
    </div>

    <div class="picker-field">
      <div class="picker-color-wrap"><div class="picker-current-color" :style="{ background: currentColor }"></div><Checkboard /></div>
      <EditableInput class="input" :value="color" @colorChange="value => changeColor(value)" />
      <button @mousedown.prevent type="button" class="straw" aria-label="取色吸管" title="取色吸管" @click="openEyeDropper()"><i-icon-park-outline:needle /></button>
      <button @mousedown.prevent type="button" class="transparent" aria-label="无填充（透明）" title="无填充（透明）" @click="selectPresetColor('#00000000')"><Checkboard /></button>
    </div>
    <div class="rgb-fields">
      <label v-for="channel in channels" :key="channel.key">{{ channel.label }}<input type="number" min="0" :max="channel.key === 'a' ? 100 : 255" :aria-label="channel.label" :value="channel.key === 'a' ? Math.round(color.a * 100) : color[channel.key]" @input="event => updateChannel(channel.key, event)"></label>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import tinycolor, { type ColorFormats } from 'tinycolor2'
import { debounce } from 'lodash'
import { toCanvas } from 'html-to-image'
import { useSlidesStore } from '@/store'
import { STUDIO_COLOR_SCHEMES, STUDIO_NEUTRAL_COLORS } from '@/configs/colors'
import message from '@/utils/message'
import Alpha from './Alpha.vue'
import Checkboard from './Checkboard.vue'
import Hue from './Hue.vue'
import Saturation from './Saturation.vue'
import EditableInput from './EditableInput.vue'

const props = withDefaults(defineProps<{ modelValue?: string }>(), { modelValue: '#ffffff' })
const emit = defineEmits<{ (event: 'update:modelValue', payload: string): void }>()
const RECENT_COLORS = 'RECENT_COLORS'
const FAVORITE_COLORS = 'SLIDE_STUDIO_FAVORITE_COLORS_V1'
const COLOR_SCHEME = 'SLIDE_STUDIO_COLOR_SCHEME_V1'
const MAX_FAVORITES = 24
const slidesStore = useSlidesStore()
const activeTab = ref<'palette' | 'custom'>('palette')
const selectedScheme = ref('bright')
const editingFavorites = ref(false)
const favoriteColors = ref<string[]>([])
const recentColors = ref<string[]>([])
const hue = ref(-1)
const channels = [{ key: 'r', label: 'R' }, { key: 'g', label: 'G' }, { key: 'b', label: 'B' }, { key: 'a', label: '不透明度 %' }] as const

const normalizeColor = (value: string) => {
  const parsed = tinycolor(value)
  return parsed.getAlpha() < 1 ? parsed.toHex8String() : parsed.toHexString()
}
const colorLabel = (value: string) => normalizeColor(value).toUpperCase()
const isSelected = (value: string) => normalizeColor(value) === normalizeColor(props.modelValue)
const themeColors = computed(() => [...new Set(slidesStore.theme.themeColors.filter(value => tinycolor(value).isValid()).map(normalizeColor))])
const schemeColors = computed(() => (STUDIO_COLOR_SCHEMES.find(scheme => scheme.id === selectedScheme.value) || STUDIO_COLOR_SCHEMES[0]).colors)
const coordinatedColors = computed(() => [
  ...schemeColors.value.map(value => ({ label: '浅色', color: tinycolor.mix(value, '#ffffff', 72).toHexString() })),
  ...schemeColors.value.map(value => ({ label: '主色', color: value })),
  ...schemeColors.value.map(value => ({ label: '深色', color: tinycolor.mix(value, '#1d1d1f', 28).toHexString() })),
])
const currentIsFavorite = computed(() => favoriteColors.value.includes(normalizeColor(props.modelValue)))
const color = computed({
  get: () => tinycolor(props.modelValue).toRgb(),
  set(rgba: ColorFormats.RGBA) {
    const value = tinycolor(rgba).toRgbString()
    emit('update:modelValue', value)
    updateRecentColorsCache(value)
  },
})
const currentColor = computed(() => tinycolor(color.value).toRgbString())
const readColors = (key: string, limit: number) => {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    if (!Array.isArray(cached)) return []
    return [...new Set(cached.filter((value): value is string => typeof value === 'string' && value.length < 128 && tinycolor(value).isValid()).map(normalizeColor))].slice(0, limit)
  }
  catch {
    return []
  }
}
const persistColors = (key: string, values: string[], reportFailure = false) => {
  try {
    localStorage.setItem(key, JSON.stringify(values))
    return true
  }
  catch {
    if (reportFailure) message.error('无法保存常用色，请检查浏览器的存储权限')
    return false
  }
}
const recordRecentColor = (value: string) => {
  const normalized = normalizeColor(value)
  recentColors.value = [normalized, ...recentColors.value.filter(color => color !== normalized)].slice(0, 8)
  persistColors(RECENT_COLORS, recentColors.value)
}
const updateRecentColorsCache = debounce((value = currentColor.value) => recordRecentColor(value), 250)
const selectPresetColor = (value: string) => {
  hue.value = tinycolor(value).toHsl().h
  emit('update:modelValue', value)
  updateRecentColorsCache.cancel()
  recordRecentColor(value)
}
const saveFavorite = () => {
  if (currentIsFavorite.value || favoriteColors.value.length >= MAX_FAVORITES) return
  const next = [...favoriteColors.value, normalizeColor(props.modelValue)]
  if (persistColors(FAVORITE_COLORS, next, true)) favoriteColors.value = next
}
const removeFavorite = (value: string) => {
  const next = favoriteColors.value.filter(color => color !== value)
  if (persistColors(FAVORITE_COLORS, next, true)) favoriteColors.value = next
  if (!next.length) editingFavorites.value = false
}
const changeColor = (value: ColorFormats.RGBA | ColorFormats.HSLA | ColorFormats.HSVA) => {
  hue.value = tinycolor(value).toHsl().h
  color.value = tinycolor(value).toRgb()
}
const updateChannel = (channel: 'r' | 'g' | 'b' | 'a', event: Event) => {
  const raw = (event.target as HTMLInputElement).value
  if (!raw.trim()) return
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  changeColor({ ...color.value, [channel]: channel === 'a' ? Math.max(0, Math.min(100, value)) / 100 : Math.max(0, Math.min(255, value)) })
}
const syncPreferences = (event?: StorageEvent) => {
  if (!event || event.key === FAVORITE_COLORS) favoriteColors.value = readColors(FAVORITE_COLORS, MAX_FAVORITES)
  if (!event || event.key === RECENT_COLORS) recentColors.value = readColors(RECENT_COLORS, 8)
}
onMounted(() => {
  syncPreferences()
  try {
    const scheme = localStorage.getItem(COLOR_SCHEME)
    if (STUDIO_COLOR_SCHEMES.some(item => item.id === scheme)) selectedScheme.value = scheme!
  }
  catch { /* Color selection remains usable if local storage is unavailable. */ }
  window.addEventListener('storage', syncPreferences)
})
onUnmounted(() => {
  updateRecentColorsCache.flush()
  window.removeEventListener('storage', syncPreferences)
})
watch(selectedScheme, value => {
  try {
    localStorage.setItem(COLOR_SCHEME, value)
  }
  catch { /* The scheme is still selected for this color picker. */ }
})

// 打开取色吸管
// 检查环境是否支持原生取色吸管，支持则使用原生吸管，否则使用自定义吸管
const openEyeDropper = () => {
  const isSupportedEyeDropper = 'EyeDropper' in window

  if (isSupportedEyeDropper) browserEyeDropper()
  else customEyeDropper()
}

// 原生取色吸管
const browserEyeDropper = () => {
  message.success('按 ESC 键关闭取色吸管', { duration: 0 })

  // eslint-disable-next-line
  const eyeDropper = new (window as any).EyeDropper()
  eyeDropper.open().then((result: { sRGBHex: string }) => {
    const tColor = tinycolor(result.sRGBHex)
    hue.value = tColor.toHsl().h
    color.value = tColor.toRgb()

    message.closeAll()
    updateRecentColorsCache()
  }).catch(() => {
    message.closeAll()
  })
}

// 基于 Canvas 的自定义取色吸管
const customEyeDropper = () => {
  const targetRef: HTMLElement | null = document.querySelector('.canvas')
  if (!targetRef) return

  const maskRef = document.createElement('div')
  maskRef.style.cssText = 'position: fixed; top: 0; left: 0; bottom: 0; right: 0; z-index: 9999; cursor: wait;'
  document.body.appendChild(maskRef)

  const colorBlockRef = document.createElement('div')
  colorBlockRef.style.cssText = 'position: absolute; top: -100px; left: -100px; width: 16px; height: 16px; border: 1px solid #000; z-index: 999'
  maskRef.appendChild(colorBlockRef)

  const { left, top, width, height } = targetRef.getBoundingClientRect()

  const filter = (node: HTMLElement) => {
    if (node.tagName && node.tagName.toUpperCase() === 'FOREIGNOBJECT') return false
    if (node.classList && node.classList.contains('operate')) return false
    return true
  }

  toCanvas(targetRef, { filter, fontEmbedCSS: '', width, height, canvasWidth: width, canvasHeight: height, pixelRatio: 1 }).then(canvasRef => {
    canvasRef.style.cssText = `position: absolute; top: ${top}px; left: ${left}px; cursor: crosshair;`
    maskRef.style.cursor = 'default'
    maskRef.appendChild(canvasRef)

    const ctx = canvasRef.getContext('2d')
    if (!ctx) return

    let currentColor = ''
    const handleMousemove = (e: MouseEvent) => {
      const x = e.x
      const y = e.y

      const mouseX = x - left
      const mouseY = y - top

      const [r, g, b, a] = ctx.getImageData(mouseX, mouseY, 1, 1).data
      currentColor = `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`

      colorBlockRef.style.left = x + 10 + 'px'
      colorBlockRef.style.top = y + 10 + 'px'
      colorBlockRef.style.backgroundColor = currentColor
    }
    const handleMouseleave = () => {
      currentColor = ''
      colorBlockRef.style.left = '-100px'
      colorBlockRef.style.top = '-100px'
      colorBlockRef.style.backgroundColor = ''
    }
    const handleMousedown = (e: MouseEvent) => {
      if (currentColor && e.button === 0) {
        const tColor = tinycolor(currentColor)
        hue.value = tColor.toHsl().h
        color.value = tColor.toRgb()

        updateRecentColorsCache()
      }
      document.body.removeChild(maskRef)

      canvasRef.removeEventListener('mousemove', handleMousemove)
      canvasRef.removeEventListener('mouseleave', handleMouseleave)
      window.removeEventListener('mousedown', handleMousedown)
    }

    canvasRef.addEventListener('mousemove', handleMousemove)
    canvasRef.addEventListener('mouseleave', handleMouseleave)
    window.addEventListener('mousedown', handleMousedown)
  }).catch(() => {
    message.error('取色吸管初始化失败')
    document.body.removeChild(maskRef)
  })
}

</script>

<style lang="scss" scoped>
.color-picker { position: relative; width: 248px; background: #fff; user-select: none; color: #1d1d1f; }
button { font: inherit; color: inherit; cursor: pointer; }
button:disabled { cursor: default; opacity: .45; }
button:focus-visible, select:focus-visible { outline: 2px solid #007aff; outline-offset: 3px; }
.picker-tabs { display: flex; padding: 2px; background: #ededf0; border-radius: 7px; gap: 2px; margin-bottom: 12px; button { flex: 1; height: 26px; border: 0; background: transparent; border-radius: 5px; color: #6e6e73; font-size: 12px; &.active { background: #fff; color: #1d1d1f; box-shadow: 0 1px 3px #00000015; } } }
.palette-heading { display: flex; align-items: center; justify-content: space-between; min-height: 22px; margin-top: 9px; margin-bottom: 5px; font-size: 11px; color: #6e6e73; &:first-child { margin-top: 0; } select { padding: 2px 4px; border: 0; background: #f5f5f7; border-radius: 4px; color: #6e6e73; font: inherit; } }
.swatch-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; }
.color-swatch { position: relative; display: block; padding: 0; height: 25px; min-width: 0; border: 0; border-radius: 5px; background: repeating-conic-gradient(#e5e5ea 0% 25%, #fff 0% 50%) 50% / 8px 8px; box-shadow: inset 0 0 0 1px #0000000e; transition: box-shadow .12s; &::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--swatch-color); box-shadow: inset 0 0 0 1px #0000000e; } &:hover { box-shadow: 0 0 0 2px #c7c7cc; } &.selected { box-shadow: 0 0 0 2px #fff, 0 0 0 3px #007aff; } &.removable span { position: absolute; top: -4px; right: -3px; display: flex; justify-content: center; align-items: center; width: 13px; height: 13px; color: #fff; font-size: 13px; line-height: 13px; border-radius: 50%; background: #636366; } }
.coordinated-colors { gap: 5px 6px; .color-swatch { height: 24px; } }
.document-colors { grid-template-columns: repeat(8, minmax(0, 1fr)); }
.palette-actions { display: flex; align-items: center; gap: 9px; }
.text-action, .add-color { border: 0; padding: 0; background: transparent; color: #007aff; }
.text-action { font-size: 11px; }
.add-color { width: 23px; height: 21px; line-height: 20px; background: #f2f2f7; border-radius: 5px; font-size: 18px; }
.palette-empty { margin: 2px 0 0; min-height: 18px; font-size: 11px; color: #8e8e93; }
.picker-field { display: flex; gap: 7px; margin-top: 13px; padding-top: 11px; border-top: 1px solid #e8e8ed; align-items: center; .input { flex: 1; min-width: 0; } }
.picker-color-wrap { width: 25px; height: 25px; flex-shrink: 0; border-radius: 5px; overflow: hidden; position: relative; outline: 1px solid #00000014; }
.picker-current-color { @include absolute-0(); z-index: 2; }
.straw, .transparent { padding: 0; border: 0; width: 25px; height: 25px; flex-shrink: 0; position: relative; border-radius: 5px; overflow: hidden; }
.straw { display: flex; justify-content: center; align-items: center; background: #f2f2f7; font-size: 18px; color: #636366; }
.transparent { outline: 1px solid #00000014; &::after { content: ''; width: 33px; height: 1.5px; position: absolute; top: 12px; left: -4px; transform: rotate(-45deg); background: #e96c63; } }
.rgb-fields { display: flex; gap: 6px; margin: 8px 0 0; label { flex: 1; min-width: 0; color: #8e8e93; font-size: 10px; text-align: center; } label:last-child { flex: 1.5; } input { box-sizing: border-box; margin-top: 4px; width: 100%; height: 25px; border: 1px solid #dedee3; border-radius: 5px; text-align: center; font-family: inherit; font-size: 11px; background: #fafafc; outline-color: #007aff; } }
.picker-saturation-wrap { width: 100%; padding-bottom: 60%; position: relative; overflow: hidden; border-radius: 5px; }
.picker-controls { display: flex; margin-top: 9px; }
.picker-sliders { padding: 4px 0; flex: 1; }
.picker-hue-wrap { position: relative; height: 12px; }
.picker-alpha-wrap { position: relative; height: 12px; margin-top: 8px; overflow: hidden; }
.save-custom-color { width: 100%; height: 27px; border: 1px solid #dedee3; border-radius: 5px; background: #fff; margin-top: 12px; font-size: 11px; color: #007aff; }
</style>
