<template>
  <div class="pptist-editor">
    <EditorHeader
      class="layout-header"
      :navigationVisible="navigationVisible"
      :formatVisible="formatVisible"
      :focusMode="focusMode"
      @toggleNavigation="navigationVisible = !navigationVisible"
      @toggleFormat="formatVisible = !formatVisible"
      @toggleFocus="toggleFocus"
    />
    <CanvasTool class="layout-tools" />
    <div class="layout-content">
      <Thumbnails id="slide-navigation" v-show="navigationVisible" class="layout-content-left" />
      <div class="layout-content-center">
        <Canvas class="center-body" :style="{ height: `calc(100% - ${remarkHeight}px)` }" />
        <Remark
          class="center-bottom" 
          v-model:height="remarkHeight" 
          :style="{ height: `${remarkHeight}px` }"
        />
      </div>
      <Toolbar id="format-inspector" v-show="formatVisible" class="layout-content-right" />
    </div>
  </div>

  <SelectPanel v-if="showSelectPanel" />
  <SearchPanel v-if="showSearchPanel" />
  <NotesPanel v-if="showNotesPanel" />
  <MarkupPanel v-if="showMarkupPanel" />
  <SymbolPanel v-if="showSymbolPanel" />
  <ImageLibPanel v-if="showImageLibPanel" />
  <ChartDataEditorDialog />
  <LatexEditorDialog />

  <Modal
    :visible="!!dialogForExport" 
    :width="680"
    @closed="closeExportDialog()"
  >
    <ExportDialog />
  </Modal>

  <Modal
    :visible="!!showAIPPTDialog" 
    :width="720"
    :closeOnClickMask="false"
    :closeOnEsc="false"
    closeButton
    :wrapStyle="{ opacity: showAIPPTDialog === 'running' ? 0 : 1 }"
    @closed="closeAIPPTDialog()"
  >
    <AIPPTDialog />
  </Modal>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore } from '@/store'
import useGlobalHotkey from '@/hooks/useGlobalHotkey'
import usePasteEvent from '@/hooks/usePasteEvent'

import EditorHeader from './EditorHeader/index.vue'
import Canvas from './Canvas/index.vue'
import CanvasTool from './CanvasTool/index.vue'
import Thumbnails from './Thumbnails/index.vue'
import Toolbar from './Toolbar/index.vue'
import Remark from './Remark/index.vue'
import ChartDataEditorDialog from './ChartDataEditorDialog.vue'
import LatexEditorDialog from './LatexEditorDialog.vue'
import ExportDialog from './ExportDialog/index.vue'
import SelectPanel from './SelectPanel.vue'
import SearchPanel from './SearchPanel.vue'
import NotesPanel from './NotesPanel.vue'
import SymbolPanel from './SymbolPanel.vue'
import MarkupPanel from './MarkupPanel.vue'
import ImageLibPanel from './ImageLibPanel.vue'
import AIPPTDialog from './AIPPTDialog.vue'
import Modal from '@/components/Modal.vue'

const mainStore = useMainStore()
const {
  dialogForExport,
  showSelectPanel,
  showSearchPanel,
  showNotesPanel,
  showSymbolPanel,
  showMarkupPanel,
  showImageLibPanel,
  showAIPPTDialog,
} = storeToRefs(mainStore)

const closeExportDialog = () => mainStore.setDialogForExport('')
const closeAIPPTDialog = () => mainStore.setAIPPTDialogState(false)

const remarkHeight = ref(40)

interface SidebarLayout {
  navigationVisible: boolean
  formatVisible: boolean
}

const layoutPreferenceKey = 'slide-studio:sidebar-layout-v1'
const defaultSidebarLayout: SidebarLayout = { navigationVisible: true, formatVisible: true }
const isSidebarLayout = (value: unknown): value is SidebarLayout => {
  if (!value || typeof value !== 'object') return false
  const layout = value as Partial<SidebarLayout>
  return typeof layout.navigationVisible === 'boolean' && typeof layout.formatVisible === 'boolean'
}
const readSidebarLayout = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutPreferenceKey) || 'null')
    return {
      layout: isSidebarLayout(saved) ? saved : defaultSidebarLayout,
      beforeFocus: isSidebarLayout(saved?.beforeFocus) && (saved.beforeFocus.navigationVisible || saved.beforeFocus.formatVisible)
        ? saved.beforeFocus : defaultSidebarLayout,
    }
  }
  catch {
    return { layout: defaultSidebarLayout, beforeFocus: defaultSidebarLayout }
  }
}
const savedLayout = readSidebarLayout()
const navigationVisible = ref(savedLayout.layout.navigationVisible)
const formatVisible = ref(savedLayout.layout.formatVisible)
const beforeFocus = ref<SidebarLayout>({ ...savedLayout.beforeFocus })
const focusMode = computed(() => !navigationVisible.value && !formatVisible.value)

const toggleFocus = () => {
  if (focusMode.value) {
    navigationVisible.value = beforeFocus.value.navigationVisible
    formatVisible.value = beforeFocus.value.formatVisible
  }
  else {
    beforeFocus.value = { navigationVisible: navigationVisible.value, formatVisible: formatVisible.value }
    navigationVisible.value = false
    formatVisible.value = false
  }
}

// Workspace preferences stay separate from document data and undo history.
watch([navigationVisible, formatVisible], () => {
  try {
    localStorage.setItem(layoutPreferenceKey, JSON.stringify({
      navigationVisible: navigationVisible.value,
      formatVisible: formatVisible.value,
      beforeFocus: beforeFocus.value,
    }))
  }
  catch {
    // Editing and the restore buttons remain available if storage is blocked.
  }
})

useGlobalHotkey()
usePasteEvent()
</script>

<style lang="scss" scoped>
.pptist-editor {
  height: 100%;
}
.layout-header {
  height: 56px;
}
.layout-tools {
  height: 64px;
}
.layout-content {
  height: calc(100% - 120px);
  display: flex;
}
.layout-content-left {
  width: 180px;
  height: 100%;
  flex-shrink: 0;
}
.layout-content-center {
  flex: 1;
  min-width: 0;
}
.layout-content-right {
  width: 280px;
  height: 100%;
  flex-shrink: 0;
}
</style>
