<template>
  <header class="studio-header">
    <div class="document-heading">
      <div class="studio-mark" aria-hidden="true"><i-icon-park-outline:slide-two /></div>
      <div class="document-name">
        <input v-if="editingTitle" ref="titleInput" v-model="titleValue" class="document-title-input" :aria-label="t('文稿名称')" @blur="finishTitle" @keydown.enter="finishTitle" @keydown.esc="editingTitle = false">
        <button v-else class="document-title" :title="t('点按重命名')" @click="startTitle">{{ title }} <span>⌄</span></button>
        <div class="document-caption">Slide Studio <span>·</span> {{ t("本地文稿") }}</div>
      </div>
    </div>
    <div class="workspace-views" role="group" :aria-label="t('工作区视图')">
      <button class="view-button" data-testid="toggle-navigation" :class="{ active: navigationVisible }" :aria-label="navigationVisible ? t('收起导航栏') : t('显示导航栏')" :title="navigationVisible ? t('收起导航栏（大纲与幻灯片）') : t('显示导航栏（大纲与幻灯片）')" :aria-pressed="navigationVisible" aria-controls="slide-navigation" @mousedown.prevent @click="emit('toggleNavigation')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M9 5v14" /><path v-if="navigationVisible" class="pane-fill" d="M4 6h4v12H4z" /></svg>
      </button>
      <button class="view-button" data-testid="toggle-focus" :class="{ active: focusMode }" :aria-label="focusMode ? t('退出专注模式') : t('开启专注模式')" :title="focusMode ? t('退出专注模式，恢复之前的侧栏') : t('专注模式，收起两侧面板')" :aria-pressed="focusMode" @mousedown.prevent @click="emit('toggleFocus')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="focusMode" d="M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5" /><path v-else d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>
      </button>
      <button class="view-button" data-testid="toggle-format" :class="{ active: formatVisible }" :aria-label="formatVisible ? t('收起格式侧边栏') : t('显示格式侧边栏')" :title="formatVisible ? t('收起格式侧边栏') : t('显示格式侧边栏')" :aria-pressed="formatVisible" aria-controls="format-inspector" @mousedown.prevent @click="emit('toggleFormat')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M15 5v14" /><path v-if="formatVisible" class="pane-fill" d="M16 6h4v12h-4z" /></svg>
      </button>
    </div>
    <div class="document-actions">
      <select class="language-select" aria-label="Language / 语言" :value="language" @change="setUiLanguage(($event.target as HTMLSelectElement).value as UiLanguage)"><option value="en">English</option><option value="zh-CN">简体中文</option></select>
      <LocalDocumentControls />
      <button class="html-button" :title="currentSlide?.html ? t('编辑本页 HTML') : t('导入 HTML 网页')" @click="openHtml(currentSlide?.html ? 'edit' : 'import')"><span class="html-glyph">&lt;/&gt;</span> HTML</button>
      <button class="html-button publish" @click="mainStore.setDialogForExport('html')">{{ t("导出") }}</button>
      <span class="header-divider"></span>
      <Popover trigger="click" placement="bottom-end" v-model:value="menuVisible">
        <template #content>
          <div class="document-menu" @click="menuVisible = false">
            <PopoverMenuItem @click="mainStore.setDialogForExport('html')">{{ t("导出 HTML 网页…") }}</PopoverMenuItem>
            <PopoverMenuItem @click="openHtml('import')">{{ t("导入 HTML 网页…") }}</PopoverMenuItem>
            <PopoverMenuItem v-if="currentSlide?.html" @click="openHtml('edit')">{{ t("编辑本页 HTML…") }}</PopoverMenuItem>
            <PopoverMenuItem @click="pageNumbersVisible = true">{{ t("自动页码…") }}</PopoverMenuItem>
            <Divider :margin="6" />
            <PopoverMenuItem @click="downloadLocalDocument()">{{ t("下载文稿 JSON") }}</PopoverMenuItem>
            <Divider :margin="6" />
            <PopoverMenuItem @click="mainStore.setDialogForExport('image')">{{ t("导出图片") }}</PopoverMenuItem>
            <PopoverMenuItem @click="mainStore.setDialogForExport('pdf')">{{ t("导出 PDF") }}</PopoverMenuItem>
            <PopoverMenuItem @click="mainStore.setDialogForExport('pptx')">{{ t("导出 PowerPoint") }}</PopoverMenuItem>
            <Divider :margin="6" />
            <FileInput accept=".pptx" @change="importPPTXFile"><PopoverMenuItem>{{ t("导入 PowerPoint…") }}</PopoverMenuItem></FileInput>
            <Divider :margin="6" />
            <PopoverMenuItem @click="hotkeyDrawerVisible = true">{{ t("键盘快捷键") }} <span class="menu-shortcut">⌘</span></PopoverMenuItem>
            <PopoverMenuItem @click="aboutVisible = true">{{ t("关于 Slide Studio") }}</PopoverMenuItem>
          </div>
        </template>
        <button class="header-button" :aria-label="t('导出与更多选项')" :title="t('导出与更多选项')"><i-icon-park-outline:more /></button>
      </Popover>
      <button class="present-button" @click="enterScreening()" :title="t('播放幻灯片（⌥⌘P）')"><i-icon-park-outline:play-one /> <span>{{ t("播放") }}</span></button>
    </div>
    <Drawer :width="360" v-model:visible="hotkeyDrawerVisible" placement="right"><HotkeyDoc /><template #title>{{ t("键盘快捷键") }}</template></Drawer>
    <Modal v-model:visible="aboutVisible" :width="440">
      <div class="about-studio"><div class="about-icon"><i-icon-park-outline:slide-two /></div><h2>Slide Studio</h2><p>{{ t("一张画布，一份清晰的表达。") }}</p><p class="about-detail">{{ t("在本地编辑与保存演示文稿。") }}<br>{{ t("基于 PPTist 开源编辑器定制，采用 AGPL-3.0 许可。") }}</p><a href="https://github.com/pipipi-pikachu/PPTist" target="_blank" rel="noreferrer">PPTist · pipipi-pikachu</a></div>
    </Modal>
    <Modal v-model:visible="htmlDialogVisible" :width="htmlDialogWidth"><HtmlDocumentDialog :mode="htmlDialogMode" :width="htmlDialogWidth" @close="htmlDialogVisible = false" /></Modal>
    <Modal v-model:visible="pageNumbersVisible" :width="520"><PageNumbersDialog @close="pageNumbersVisible = false" /></Modal>
    <FullscreenSpin :loading="exporting" :tip="t('正在导入文稿…')" />
  </header>
</template>
<script lang="ts" setup>
import { t, language, setUiLanguage, type UiLanguage } from '@/i18n'
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore, useSlidesStore } from '@/store'
import useScreening from '@/hooks/useScreening'
import useImport from '@/hooks/useImport'
import { downloadLocalDocument } from '@/services/localDocument'
import LocalDocumentControls from '@/components/LocalDocumentControls.vue'
import HtmlDocumentDialog from '../HtmlDocumentDialog.vue'
import PageNumbersDialog from '../PageNumbersDialog.vue'
import HotkeyDoc from './HotkeyDoc.vue'
import FileInput from '@/components/FileInput.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'
import Drawer from '@/components/Drawer.vue'
import Modal from '@/components/Modal.vue'
import Popover from '@/components/Popover.vue'
import PopoverMenuItem from '@/components/PopoverMenuItem.vue'
import Divider from '@/components/Divider.vue'
defineProps<{
  navigationVisible: boolean
  formatVisible: boolean
  focusMode: boolean
}>()
const emit = defineEmits<{
  toggleNavigation: []
  toggleFormat: []
  toggleFocus: []
}>()
const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const { title, currentSlide } = storeToRefs(slidesStore)
const { enterScreening } = useScreening()
const { importPPTXFile, exporting } = useImport()
const editingTitle = ref(false)
const titleValue = ref('')
const titleInput = ref<HTMLInputElement>()
const hotkeyDrawerVisible = ref(false)
const aboutVisible = ref(false)
const menuVisible = ref(false)
const pageNumbersVisible = ref(false)
const openPageNumbers = () => {
  pageNumbersVisible.value = true
}
onMounted(() => window.addEventListener('keynote-local:page-numbers', openPageNumbers))
onUnmounted(() => window.removeEventListener('keynote-local:page-numbers', openPageNumbers))
const htmlDialogVisible = ref(false)
const htmlDialogMode = ref<'import' | 'edit'>('import')
const htmlDialogWidth = Math.min(1060, window.innerWidth - 48)
const openHtml = (mode: 'import' | 'edit') => {
  htmlDialogMode.value = mode
  menuVisible.value = false
  htmlDialogVisible.value = true
}
const startTitle = async () => {
  titleValue.value = title.value; editingTitle.value = true; await nextTick(); titleInput.value?.focus(); titleInput.value?.select()
}
const finishTitle = () => {
  slidesStore.setTitle(titleValue.value.trim()); editingTitle.value = false
}
</script>
<style lang="scss" scoped>
.studio-header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 19px; background:#f8f8fa; border-bottom:1px solid #dcdce0; user-select:none; }
.document-heading,.document-actions { display:flex; align-items:center; gap:13px; min-width:0; }
.document-heading { flex:1; }
.document-actions { flex-shrink:0; }
.language-select { max-width:96px; height:28px; border:1px solid #d7d7dd; border-radius:6px; background:#fff; color:#55565c; font:11px inherit; padding:0 5px; cursor:pointer; }
.workspace-views { display:flex; align-items:center; gap:2px; padding:2px; background:#ebebef; border-radius:7px; flex-shrink:0; }
.view-button { display:grid; place-items:center; width:29px; height:27px; padding:3px; border:0; border-radius:5px; color:#73737b; background:transparent; cursor:pointer; &:hover { background:#dedee5; } &:focus-visible { outline:2px solid #007aff; outline-offset:2px; } &.active { color:#007aff; background:#fafafd; box-shadow:0 1px 2px #0000000d; } svg { width:21px; height:21px; fill:none; stroke:currentColor; stroke-width:1.55; stroke-linecap:round; stroke-linejoin:round; } .pane-fill { stroke:none; fill:currentColor; opacity:.22; } }
.studio-mark { width:33px; height:33px; border-radius:9px; background:linear-gradient(155deg,#52aeff,#0877f9); color:white; display:grid; place-items:center; box-shadow:0 2px 5px #007aff20; font-size:22px; }
.document-name { min-width:0; }
.document-title,.document-title-input { display:block; border:0; font:600 13px -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif; letter-spacing:.1px; background:transparent; padding:1px 0; color:#27272b; max-width:310px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.document-title { cursor:pointer; span { color:#a1a1a6; padding-left:5px; font-size:12px; } }
.document-title-input { outline:2px solid #007aff; border-radius:4px; }
.document-caption { font-size:10px; color:#929298; margin-top:3px; span { margin:0 3px; } }
.header-divider { width:1px; height:23px; background:#d7d7dd; margin:0 3px; }
.header-button { background:transparent; border:0; border-radius:7px; width:31px; height:30px; display:grid; place-items:center; color:#56565c; font-size:21px; cursor:pointer; &:hover {background:#e9e9ed;} }
.html-button { display:flex; align-items:center; gap:5px; height:29px; padding:0 9px; border:1px solid transparent; border-radius:6px; background:transparent; color:#41444a; font:inherit; font-size:11px; cursor:pointer; &:hover {background:#e2e3e6;} &.publish {color:#007aff; background:#eaf2ff;} }
.html-glyph {font:600 12px Menlo,monospace;}
.present-button { display:flex; align-items:center; gap:6px; background:#007aff; border:0; color:#fff; height:30px; padding:0 13px; border-radius:7px; font-family:inherit; font-size:12px; font-weight:500; cursor:pointer; box-shadow:0 1px 2px #0000000d; &:hover {background:#006ce4;} }
.document-menu { min-width:210px; padding:4px; font-size:13px; }
.menu-shortcut { margin-left:auto; color:#999; }
.about-studio { padding:28px; text-align:center; h2 {font-size:24px;font-weight:600;margin:16px 0 10px;} p {font-size:14px;color:#6e6e73;line-height:1.7;} .about-detail {font-size:12px;margin:18px 0 12px;} a {font-size:12px;} }
.about-icon { width:60px;height:60px;border-radius:15px;background:#007aff;display:grid;place-items:center;color:white;font-size:38px;margin:auto; }
@media(max-width:1050px){.document-caption {display:none;} .document-title{max-width:180px;} .studio-header{padding:0 12px;} .document-actions{gap:7px;} }
@media(max-width:900px){.document-heading{gap:8px;} .studio-header{gap:8px;} .document-title{max-width:130px;} .studio-mark{width:29px;height:29px;flex-shrink:0;} .document-actions{gap:4px;} .html-button{padding:0 6px;} .header-divider{margin:0;} }
@media(max-width:760px){.studio-header{padding:0 8px;gap:6px;} .studio-mark{display:none;} .document-title{max-width:95px;} .view-button{width:26px;} .workspace-views{gap:0;} .present-button{padding:0 8px;} }
</style>
