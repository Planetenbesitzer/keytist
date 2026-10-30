<template>
  <div class="local-document-controls">
    <span class="save-status" :class="{ error: !!state.error, saving: state.pending || state.saving }" :title="t(statusTitle)" role="status">
      <span class="status-dot"></span>{{ t(statusText) }}
    </span>
    <button type="button" class="document-button" :title="t('打开本地 JSON 文稿（⌘O / Ctrl+O）')" @click="open()">
      <i-icon-park-outline:folder-open /> <span>{{ t("打开") }}</span>
    </button>
    <button type="button" class="document-button" :title="t(saveTitle)" @click="save()">
      <i-icon-park-outline:save /> <span>{{ t("保存") }}</span>
    </button>
    <button type="button" class="document-button save-as" :title="t('另存为 JSON 文件（⇧⌘S / Ctrl+Shift+S）')" @click="save(true)">{{ t("另存为") }}</button>
    <!-- Let document validation decide; macOS type filters can disable valid JSON files. -->
    <input ref="fileInput" type="file" hidden @change="readFile" />
  </div>
</template>

<script lang="ts" setup>
import { t } from '@/i18n'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  localDocumentState as state, openLocalDocumentPicker, openLocalDocumentFile,
  saveLocalDocumentFile, supportsLocalFilePicker,
} from '@/services/localDocument'
import message from '@/utils/message'

const fileInput = ref<HTMLInputElement>()
const statusText = computed(() => state.error ? '保存异常' : (state.pending || state.saving) ? '正在保存…' : '已存于此设备')
const saveTitle = computed(() => state.needsSaveTarget ? t('重新选择保存位置：{0}（⌘S / Ctrl+S）', { 0: state.fileName }) : state.nativeFileBound ? t('保存原文件：{0}（⌘S / Ctrl+S）', { 0: state.fileName }) : t('保存到{0}（⌘S / Ctrl+S）', { 0: state.filePath || state.outputDirectory || t('本地 JSON 文件') }))
const statusTitle = computed(() => {
  if (state.error) return state.error
  const saved = state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleTimeString() : ''
  const destination = state.needsSaveTarget ? t('保存前需要重新选择文件：{0}。', { 0: state.fileName }) : state.nativeFileBound ? t('当前文件：{0}，保存将写回原文件。', { 0: state.fileName }) : state.filePath ? t('最近保存的文件：{0}。', { 0: state.filePath }) : state.outputDirectory ? t('默认文件目录：{0}。', { 0: state.outputDirectory }) : ''
  return t('文稿与嵌入图片、字体自动保存在此浏览器。{0}{1}使用“保存”写入 JSON 文件。{2}', { 0: saved ? t('最近自动保存 {0}。', { 0: saved }) : '', 1: destination, 2: state.fileName && !state.filePath && !state.nativeFileBound ? t('当前文件：{0}', { 0: state.fileName }) : '' })
})
const showError = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') return
  message.error(error instanceof Error ? error.message : '无法读写本地文件，请重试。')
}
const open = async () => {
  if (!supportsLocalFilePicker()) {
    if (fileInput.value) {
      fileInput.value.value = ''; fileInput.value.click()
    }
    return
  }
  try {
    await openLocalDocumentPicker()
  }
  catch (error) {
    showError(error)
  }
}
const readFile = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    await openLocalDocumentFile(file); message.success('已打开本地文稿')
  }
  catch (error) {
    showError(error)
  }
}
const save = async (saveAs = false) => {
  try {
    const result = await saveLocalDocumentFile({ saveAs })
    message.success(result.method === 'download' ? '已下载 JSON 文稿' : result.method === 'server' ? `已保存 ${result.path}` : `已保存 ${result.fileName}`)
  }
  catch (error) {
    showError(error)
  }
}
const onOpen = () => {
  void open()
}
const onSave = (event: Event) => {
  void save(!!(event as CustomEvent).detail?.saveAs)
}
onMounted(() => {
  window.addEventListener('keynote-local:open', onOpen)
  window.addEventListener('keynote-local:save', onSave)
})
onUnmounted(() => {
  window.removeEventListener('keynote-local:open', onOpen)
  window.removeEventListener('keynote-local:save', onSave)
})
</script>

<style lang="scss" scoped>
.local-document-controls { display: flex; align-items: center; gap: 5px; }
.document-button {
  display: flex; align-items: center; justify-content: center; gap: 5px;
  min-height: 29px; padding: 0 8px; border: 1px solid transparent; border-radius: 6px;
  font: inherit; font-size: 11px; color: #41444a; background: transparent; cursor: pointer;
  &:hover { background: #e2e3e6; }
  &:focus-visible { outline: 2px solid #007aff; outline-offset: 1px; }
  svg { width: 15px; height: 15px; }
}
.save-status { display: flex; align-items: center; gap: 5px; margin-right: 8px; font-size: 10px; color: #7b7e85; white-space: nowrap; }
.status-dot { width: 5px; height: 5px; border-radius: 50%; background: #69a582; }
.saving .status-dot { background: #b09b65; }
.error { color: #bc443b; .status-dot { background: #bc443b; } }
@media (max-width: 1150px) { .save-status { display: none; } }
@media (max-width: 900px) { .save-as { display: none; } }
</style>
