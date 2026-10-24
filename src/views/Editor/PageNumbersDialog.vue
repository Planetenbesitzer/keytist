<template>
  <div class="page-numbers-dialog" @keydown.stop>
    <h2>{{ t("自动页码") }}</h2>
    <p class="intro">{{ t("新增、删除或调整幻灯片顺序后，页码会自动更新。") }}</p>
    <div class="settings">
      <label class="setting"><span>{{ t("起始编号") }}</span><input type="number" min="0" max="999999" step="1" v-model.number="config.start" :aria-label="t('起始编号')" :disabled="busy"></label>
      <label class="setting"><span>{{ t("编号格式") }}</span><select v-model="config.format" :aria-label="t('编号格式')" :disabled="busy"><option value="number">1, 2, 3</option><option value="twoDigits">01, 02, 03</option><option value="fraction">{{ t("当前 / 末页") }}</option></select></label>
      <label class="check"><input type="checkbox" v-model="config.hideOnFirst" :disabled="busy">{{ t("封面不显示页码（仍计入编号）") }}</label>
    </div>
    <div class="preview" :aria-label="t('页码预览')">
      <div class="preview-page"><span>{{ t("封面") }}</span><b>{{ config.hideOnFirst ? t("不显示") : label(0) }}</b></div>
      <div v-if="slides.length > 1" class="preview-page"><span>{{ t("第二张") }}</span><b>{{ label(1) }}</b></div>
      <p>{{ t("共") }} {{ slides.length }} {{ t("张幻灯片") }}</p>
    </div>
    <div v-if="candidateCount" class="conversion">
      <label class="check"><input type="checkbox" v-model="replaceExisting" :disabled="busy">{{ t("沿用已有数字页脚的位置与样式（找到") }} {{ candidateCount }} {{ t("页）") }}</label>
      <p>{{ t("仅转换页面底部的数字页脚，保留各页字体、颜色和位置。缺少页码的页面会补上。") }}</p>
    </div>
    <p class="help">{{ t("页码可像文本框一样移动和设置字体、颜色；直接改写编号文字后，该文本框将不再自动更新。") }}</p>
    <p v-if="error" class="error" role="alert">{{ t(error) }}</p>
    <div class="actions"><button v-if="hasAutomatic" class="remove" :disabled="busy" @click="apply(true)">{{ t("移除自动页码") }}</button><span class="spacer"></span><Button :disabled="busy" @click="emit('close')">{{ t("取消") }}</Button><Button type="primary" :disabled="busy || !slides.length" @click="apply()">{{ busy ? t("正在处理…") : t("应用到全部幻灯片") }}</Button></div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore, useSlidesStore } from '@/store'
import { getSnapshotHistoryEpoch } from '@/store/snapshot'
import type { AutomaticPageNumberConfig } from '@/types/slides'
import { DEFAULT_AUTOMATIC_PAGE_NUMBER_CONFIG, findPageNumberCandidate, getAutomaticPageNumberLabel, normalizeAutomaticPageNumberConfig } from '@/utils/pageNumbers'
import { removeAutomaticPageNumbers, setAutomaticPageNumbers } from '@/services/localDocument'
import Button from '@/components/Button.vue'
import message from '@/utils/message'

const emit = defineEmits<{ (event: 'close'): void }>()
const { slides, viewportSize, viewportRatio, theme } = storeToRefs(useSlidesStore())
const firstNumber = slides.value.flatMap(slide => slide.elements).find(element => element.type === 'text' && element.autoPageNumber)
const initial = firstNumber?.type === 'text' ? firstNumber.autoPageNumber : undefined
const config = reactive<AutomaticPageNumberConfig>({ ...normalizeAutomaticPageNumberConfig(initial || DEFAULT_AUTOMATIC_PAGE_NUMBER_CONFIG) })
const epoch = getSnapshotHistoryEpoch()
const busy = ref(false)
const error = ref('')
const layout = computed(() => ({ width: viewportSize.value, height: viewportSize.value * viewportRatio.value, fontName: theme.value.fontName, fontColor: theme.value.fontColor }))
const candidateCount = computed(() => slides.value.filter((slide, index) => findPageNumberCandidate(slide, index, slides.value.length, config, layout.value)).length)
const replaceExisting = ref(candidateCount.value > 0)
const hasAutomatic = computed(() => slides.value.some(slide => slide.elements.some(element => element.type === 'text' && element.autoPageNumber)))
const label = (index: number) => Number.isSafeInteger(config.start) && config.start >= 0 && config.start <= 999999 ? getAutomaticPageNumberLabel(index, slides.value.length, config) : '—'
const apply = async (remove = false) => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (epoch !== getSnapshotHistoryEpoch()) throw new Error('文稿已切换，请关闭此窗口后，在当前文稿中重新设置页码。')
    if (remove) await removeAutomaticPageNumbers()
    else await setAutomaticPageNumbers(normalizeAutomaticPageNumberConfig(config), replaceExisting.value)
    useMainStore().setActiveElementIdList([])
    message.success(remove ? '已移除自动页码，可撤销恢复' : '已应用自动页码')
    emit('close')
  }
  catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法设置自动页码，请重试。'
  }
  finally {
    busy.value = false
  }
}
</script>

<style scoped lang="scss">
.page-numbers-dialog { max-height:calc(100vh - 100px); overflow:auto; color:#303038; }
h2 { margin:0 0 8px; font-size:20px; font-weight:600; color:#1d1d1f; }
.intro,.help,.conversion p { color:#777780; font-size:12px; line-height:1.7; }
.intro { margin:0 0 23px; }
.settings { display:grid; gap:17px; }
.setting { display:flex; align-items:center; justify-content:space-between; font-size:13px; input,select { width:200px; height:32px; padding:0 9px; border:1px solid #d8d8de; border-radius:6px; background:#fff; color:#303038; font:inherit; } }
.check { display:flex; align-items:center; gap:7px; font-size:13px; line-height:1.6; input { width:15px; height:15px; margin:0; accent-color:#007aff; flex-shrink:0; } }
.preview { display:flex; align-items:center; gap:12px; margin:23px 0; padding:16px; border-radius:9px; background:#f5f5f8; p { margin-left:auto; font-size:11px; color:#85858e; } }
.preview-page { display:flex; flex-direction:column; justify-content:space-between; width:112px; height:63px; box-sizing:border-box; padding:9px; background:#fff; border:1px solid #dedee5; border-radius:4px; span { color:#8b8b94; font-size:10px; } b { align-self:flex-end; color:#454550; font-size:12px; font-weight:500; } }
.conversion { margin-bottom:15px; p { margin:7px 0 0 22px; } }
.help { margin:16px 0 20px; }
.error { font-size:12px; line-height:1.6; color:#d44337; }
.actions { display:flex; align-items:center; gap:10px; padding-top:4px; }
.spacer { flex:1; }
.remove { border:0; background:transparent; padding:0; font:inherit; font-size:12px; color:#d44337; cursor:pointer; &:disabled { opacity:.5; cursor:default; } }
</style>
