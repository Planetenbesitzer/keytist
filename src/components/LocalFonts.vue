<template>
  <button class="font-tool" title="本机字体与嵌入字体" @click="visible = true">
    <i-icon-park-outline:font-size />
    <span>字体</span>
  </button>
  <Modal v-model:visible="visible" :width="540" closeButton>
    <div class="local-fonts">
      <h2>字体</h2>
      <p class="intro">使用 Mac 常用字体，或将自己的字体文件保存在文稿中。</p>
      <div class="actions">
        <Button type="primary" :disabled="busy" @click="chooseFiles">导入字体文件…</Button>
        <Button v-if="canReadLocalFonts()" :disabled="busy" @click="readSystemFonts">读取本机字体…</Button>
      </div>
      <input ref="fileInput" class="file-input" type="file" accept=".woff,.woff2,.ttf,.otf" multiple @change="importFiles" />
      <p class="hint">支持 WOFF、WOFF2、TTF 和 OTF。导入后可在所有字体菜单中选择，保存的文稿会携带字体。</p>
      <div class="status" role="status" v-if="status">{{status}}</div>
      <h3>文稿中的字体 <span>{{embeddedFonts.length}}</span></h3>
      <div class="font-list" v-if="embeddedFonts.length">
        <div class="font-row" v-for="font in embeddedFonts" :key="font.id">
          <div class="font-info">
            <div class="font-name" :style="{ fontFamily: font.family }">{{font.family}}</div>
            <div class="font-preview" :style="{ fontFamily: font.family }">Aa 文字 · 0123456789</div>
          </div>
          <button class="remove" :aria-label="`移除字体 ${font.family}`" @click="removeFont(font.id)">移除</button>
        </div>
      </div>
      <div class="empty" v-else>尚未嵌入字体</div>
      <p class="hint">本机字体只在安装了该字体的设备上可用。跨设备继续编辑时，请导入对应字体文件。</p>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import Modal from './Modal.vue'
import Button from './Button.vue'
import { canReadLocalFonts, embeddedFonts, importFontFile, readLocalFontNames, removeEmbeddedFont } from '@/utils/localFonts'

const visible = ref(false)
const busy = ref(false)
const status = ref('')
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const chooseFiles = () => fileInput.value?.click()
const importFiles = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (!files.length) return
  busy.value = true
  let imported = 0
  try {
    for (const file of files) {
      await importFontFile(file)
      imported++
    }
    status.value = `已嵌入 ${imported} 款字体，可以在字体菜单中使用。`
  }
  catch (error) {
    status.value = `${imported ? `已嵌入 ${imported} 款。` : ''}${error instanceof Error ? error.message : '字体无法载入，请换一个字体文件。'}`
  }
  finally {
    busy.value = false
    input.value = ''
  }
}
const readSystemFonts = async () => {
  busy.value = true
  try {
    const count = await readLocalFontNames()
    status.value = `已在字体菜单中加入 ${count} 款本机字体。`
  }
  catch {
    status.value = '未读取本机字体。你可以继续使用常用字体，或导入字体文件。'
  }
  finally {
    busy.value = false
  }
}
const removeFont = (id: string) => {
  removeEmbeddedFont(id)
  status.value = '已从文稿中移除字体；使用该字体的文字会改用备用字体。'
}
</script>

<style scoped lang="scss">
.font-tool {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 6px;
  padding: 7px 9px;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
  &:hover { background: rgba(0, 0, 0, .06); }
}
.local-fonts {
  h2 { margin: 0 0 8px; font-size: 21px; font-weight: 600; }
  h3 { margin: 24px 0 10px; font-size: 13px; font-weight: 600; }
  h3 span { color: #8b8e94; padding-left: 6px; font-weight: 400; }
}
.intro { color: #656973; margin: 0 0 20px; line-height: 1.6; }
.actions { display: flex; gap: 10px; }
.file-input { display: none; }
.hint { color: #7c818b; font-size: 12px; line-height: 1.65; margin: 12px 0 0; }
.status { color: #2563a7; font-size: 12px; margin-top: 12px; line-height: 1.6; }
.font-list { max-height: 240px; overflow: auto; border-top: 1px solid #e7e9ed; }
.font-row { display: flex; align-items: center; gap: 15px; border-bottom: 1px solid #e7e9ed; padding: 13px 2px; }
.font-info { flex: 1; min-width: 0; }
.font-name { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.font-preview { margin-top: 5px; font-size: 18px; color: #7c818b; }
.remove { background: none; border: 0; color: #7c818b; padding: 6px; cursor: pointer; }
.empty { padding: 25px; text-align: center; border: 1px dashed #e0e3e8; border-radius: 8px; color: #8b8e94; }
</style>
