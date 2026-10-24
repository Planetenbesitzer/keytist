<template>
  <template v-if="slides.length">
    <Screen v-if="screening" />
    <Editor v-else-if="_isPC" />
    <Mobile v-else />
  </template>
  <FullscreenSpin :tip="t('数据初始化中，请稍等 ...')" v-else  loading :mask="false" />
</template>

<script lang="ts" setup>
import { t } from '@/i18n'
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { nanoid } from 'nanoid'
import { useScreenStore, useMainStore, useSnapshotStore, useSlidesStore } from '@/store'
import { LOCALSTORAGE_KEY_DISCARDED_DB } from '@/configs/storage'
import { deleteDiscardedDB } from '@/utils/database'
import { isPC } from '@/utils/common'
import { initializeLocalDocument } from '@/services/localDocument'
import { createStarterDocument } from '@/configs/starter'

import Editor from './views/Editor/index.vue'
import Screen from './views/Screen/index.vue'
import Mobile from './views/Mobile/index.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'

const _isPC = isPC()

const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const snapshotStore = useSnapshotStore()
const screenStore = useScreenStore()
const { databaseId } = storeToRefs(mainStore)
const { slides } = storeToRefs(slidesStore)
const { screening } = storeToRefs(screenStore)

const isAudienceMode = new URLSearchParams(window.location.search).get('mode') === 'audience'

onMounted(async () => {
  if (isAudienceMode) {
    slidesStore.setSlides([{
      id: nanoid(10),
      elements: [],
    }])
    screenStore.setScreening(true)
  }
  else {
    await deleteDiscardedDB().catch(() => undefined)
    await initializeLocalDocument(createStarterDocument)
    await snapshotStore.initSnapshotDatabase()
  }
})

// 应用注销时向 localStorage 中记录下本次 indexedDB 的数据库ID，用于之后清除数据库
window.addEventListener('beforeunload', () => {
  try {
    const discardedDB = localStorage.getItem(LOCALSTORAGE_KEY_DISCARDED_DB)
    const discardedDBList: string[] = discardedDB ? JSON.parse(discardedDB) : []
    discardedDBList.push(databaseId.value)
    localStorage.setItem(LOCALSTORAGE_KEY_DISCARDED_DB, JSON.stringify(discardedDBList))
  }
  catch { /* Undo cleanup must not block closing or document autosave. */ }
})
</script>

<style lang="scss">
#app {
  height: 100%;
}
</style>
