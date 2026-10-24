<template>
  <section v-if="kind" class="object-styles" :aria-label="t('对象样式')" @keydown.stop @mousedown.stop>
    <div class="heading"><span>{{ t("对象样式") }}</span><button type="button" :aria-label="t('将当前外观添加为样式')" :title="t('将当前外观添加为样式')" @click="add">＋</button></div>
    <div class="style-grid">
      <button v-for="preset in presets" :key="preset.id" class="style-card" type="button" :class="{ selected: selectedId === preset.id }"
        :aria-label="t('应用样式 {0}', { 0: presetLabel(preset) })" :aria-pressed="selectedId === preset.id" @click="apply(preset)">
        <span class="sample" :class="kind" :style="preview(preset)">{{ kind === 'text' ? 'Aa' : kind === 'latex' ? '𝑥²' : kind === 'line' ? '━' : '' }}</span>
        <span class="name">{{ presetLabel(preset) }}<span v-if="defaultId === preset.id" :aria-label="t('新建默认样式')" :title="t('新建默认样式')"> {{ t("· 默认") }}</span></span>
      </button>
    </div>
    <div class="selected-state" aria-live="polite">{{ selected ? presetLabel(selected) : t("当前外观") }}<span v-if="modified"> {{ t("· 已修改") }}</span></div>
    <details class="manage">
      <summary>{{ t("管理样式") }}</summary>
      <label class="rename"><span>{{ t("预设") }}</span><select :aria-label="t('要编辑的对象样式')" v-model="selectedId"><option value="" disabled>{{ t("选择要编辑的样式") }}</option><option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ presetLabel(preset) }}</option></select></label>
      <label class="rename"><span>{{ t("名称") }}</span><input :aria-label="t('样式名称')" maxlength="40" v-model="name" :disabled="!selected" @keyup.enter="rename"></label>
      <div class="actions">
        <button type="button" :disabled="!selected || !name.trim()" @click="rename">{{ t("重命名") }}</button>
        <button type="button" :disabled="!selected" @click="redefine">{{ t("用当前外观重定义") }}</button>
        <button type="button" :disabled="!selected || defaultId === selectedId" @click="setDefault">{{ t("设为新建默认") }}</button>
        <button type="button" :disabled="!defaultId" @click="clearDefault">{{ t("取消新建默认") }}</button>
        <button type="button" :disabled="!selected" @click="remove">{{ t("删除样式") }}</button>
        <button type="button" v-if="selected?.builtin" @click="restoreSelected">{{ t("恢复此内置样式") }}</button>
        <button type="button" @click="restoreAll">{{ t("恢复内置样式") }}</button>
      </div>
      <p>{{ t("重定义和默认设置只影响以后应用或新建的对象，已有对象不会随之改变。样式保存在此浏览器中。") }}</p>
    </details>
    <div v-if="error" class="error" role="alert">{{ t(error) }}</div>
  </section>
</template>

<script lang="ts" setup>
import { t } from '@/i18n'
import { computed, ref, watch, type CSSProperties } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore, useSlidesStore } from '@/store'
import { useStylePresetsStore } from '@/store/stylePresets'
import { BUILTIN_OBJECT_STYLES, applyElementStyle, captureElementStyle, isStyleKind, type ObjectStylePreset } from '@/utils/stylePresets'
import useHistorySnapshot from '@/hooks/useHistorySnapshot'
import message from '@/utils/message'

const { handleElement } = storeToRefs(useMainStore())
const slidesStore = useSlidesStore()
const libraryStore = useStylePresetsStore()
const { addHistorySnapshot } = useHistorySnapshot()
const kind = computed(() => handleElement.value && isStyleKind(handleElement.value.type) ? handleElement.value.type : null)
const presetLabel = (preset: ObjectStylePreset) => {
  const original = BUILTIN_OBJECT_STYLES.find(item => item.id === preset.id && item.kind === preset.kind)
  return original?.name === preset.name ? t(preset.name) : preset.name
}
const presets = computed(() => libraryStore.library.presets.filter(preset => preset.kind === kind.value))
const defaultId = computed(() => kind.value ? libraryStore.library.defaults[kind.value] : undefined)
const selectedId = ref('')
const selected = computed(() => presets.value.find(preset => preset.id === selectedId.value))
const appearance = computed(() => handleElement.value ? captureElementStyle(handleElement.value) : {})
const matches = (preset: ObjectStylePreset) => handleElement.value && JSON.stringify(captureElementStyle(applyElementStyle(handleElement.value, preset))) === JSON.stringify(appearance.value)
const modified = computed(() => !!selected.value && !matches(selected.value))
const name = ref('')
const error = ref('')
watch(() => handleElement.value?.id, () => {
  selectedId.value = presets.value.find(matches)?.id || ''
  error.value = ''
}, { immediate: true })
watch(selected, preset => {
  name.value = preset?.name || ''
}, { immediate: true })
const perform = (action: () => void, success: string) => {
  try {
    action(); error.value = ''; message.success(success)
  }
  catch (reason) {
    error.value = reason instanceof Error ? reason.message : '样式保存失败，原设置已保留。'
  }
}
const apply = (preset: ObjectStylePreset) => {
  if (!handleElement.value || handleElement.value.lock) return
  const result = applyElementStyle(handleElement.value, preset)
  slidesStore.updateSlide({ elements: slidesStore.currentSlide.elements.map(element => element.id === result.id ? result : element) })
  selectedId.value = preset.id
  addHistorySnapshot()
}
const add = () => {
  if (!kind.value) return
  perform(() => {
    selectedId.value = libraryStore.add(kind.value!, t('自定义样式 {0}', { 0: presets.value.filter(preset => !preset.builtin).length + 1 }), appearance.value)
  }, '已添加当前外观，可在管理样式中改名')
}
const rename = () => {
  if (selected.value && name.value.trim()) perform(() => libraryStore.update(selectedId.value, { name: name.value }), '样式已重命名')
}
const redefine = () => {
  if (selected.value) perform(() => libraryStore.update(selectedId.value, { values: appearance.value }), '已用当前外观重定义样式')
}
const setDefault = () => {
  if (kind.value && selected.value) perform(() => libraryStore.setDefault(kind.value!, selectedId.value), '以后的新建对象将使用此样式')
}
const clearDefault = () => {
  if (kind.value) perform(() => libraryStore.setDefault(kind.value!), '已恢复文稿主题的新建默认外观')
}
const remove = () => {
  if (!selected.value) return
  perform(() => {
    libraryStore.remove(selectedId.value); selectedId.value = ''
  }, '已删除样式，已有对象保留外观')
}
const restoreSelected = () => {
  if (kind.value && selected.value) perform(() => libraryStore.restore(kind.value!, selectedId.value), '此内置样式已恢复，已有对象保留外观')
}
const restoreAll = () => {
  if (kind.value) perform(() => libraryStore.restore(kind.value!), '内置样式已恢复，自定义样式保留')
}
const preview = (preset: ObjectStylePreset): CSSProperties => {
  const values = preset.values
  const typography = values.typography as CSSProperties | undefined
  const outline = values.outline as { width?: number; color?: string } | undefined
  const shadow = values.shadow as { h: number; v: number; blur: number; color: string } | undefined
  return {
    background: ['shape', 'table', 'chart'].includes(preset.kind) ? (typeof values.fill === 'string' ? values.fill : '#007aff') : preset.kind === 'image' ? 'linear-gradient(145deg,#d3e9ef,#89aebd)' : 'transparent',
    color: (typography?.color || values.color || '#1d1d1f') as string,
    fontFamily: typography?.fontFamily, fontWeight: typography?.fontWeight, fontStyle: typography?.fontStyle,
    textDecoration: typography?.textDecoration,
    border: outline?.width ? `1px solid ${outline.color || '#8e8e93'}` : undefined,
    borderRadius: preset.kind === 'image' ? `${Math.min(Number(values.radius) || 0, 10)}px` : undefined,
    boxShadow: shadow ? `${shadow.h * .3}px ${shadow.v * .3}px ${shadow.blur * .35}px ${shadow.color}` : undefined,
  }
}
</script>

<style lang="scss" scoped>
.object-styles { padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid #e5e5ea; }
.heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-weight: 600; }
.heading button { width: 25px; height: 25px; padding: 0; border: 1px solid #d1d1d6; border-radius: 6px; background: #fff; color: #007aff; font-size: 20px; line-height: 20px; cursor: pointer; }
.style-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; max-height: 236px; overflow-y: auto; padding: 2px; }
.style-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; min-width: 0; min-height: 77px; padding: 9px 3px 6px; border: 1px solid #e5e5ea; border-radius: 7px; background: #fafafa; cursor: pointer; color: #636366; font: inherit; }
.style-card:hover { background: #f2f6fc; }
.style-card.selected { border-color: #007aff; background: #edf4ff; color: #007aff; }
.sample { display: block; width: 36px; height: 27px; font-size: 24px; line-height: 27px; text-align: center; }
.sample.shape, .sample.chart, .sample.table { border-radius: 3px; }
.sample.line { font-size: 30px; }
.name { overflow: hidden; width: 100%; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; text-align: center; }
.selected-state { margin-top: 8px; font-size: 11px; color: #636366; min-height: 16px; }
.manage { margin-top: 6px; font-size: 11px; }
.manage summary { cursor: pointer; color: #636366; }
.rename { display: flex; align-items: center; gap: 10px; margin: 10px 0 8px; }
.rename > span { flex: 0 0 28px; white-space: nowrap; }
.rename input, .rename select { width: 100%; min-width: 0; height: 27px; box-sizing: border-box; border: 1px solid #d1d1d6; border-radius: 5px; padding: 0 6px; font: inherit; background: #fff; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.actions button { font: inherit; min-height: 28px; border: 1px solid #d1d1d6; border-radius: 5px; background: #fff; color: #3a3a3c; cursor: pointer; padding: 4px; }
.actions button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #007aff; outline-offset: 2px; }
.manage p { margin: 10px 0 0; color: #8e8e93; line-height: 1.6; }
.error { margin-top: 10px; color: #c9342b; font-size: 11px; line-height: 1.5; }
</style>
