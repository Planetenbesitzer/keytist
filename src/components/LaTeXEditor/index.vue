<template>
  <div class="latex-editor">
    <div class="container">
      <div class="left">
        <div class="input-area">
          <TextArea v-model:value="latex" :placeholder="t('输入 LaTeX 公式')" ref="textAreaRef" />
        </div>
        <div class="input-help">{{ t("本地 MathJax 排版 · 支持 aligned、矩阵与 \\newcommand 自定义宏") }}</div>
        <div class="insertion-help" v-if="inline">{{ t("行内公式：在文字光标处插入，随段落排版；双击公式可再次修改。") }}</div>
        <div class="preview">
          <div class="placeholder" v-if="!latex">{{ t("公式预览") }}</div>
          <div class="preview-content" v-else>
            <FormulaContent
              :width="518"
              :height="138"
              :latex="latex"
              :inline="inline"
            />
          </div>
        </div>
      </div>
      <div class="right">
        <Tabs
          :tabs="tabs"
          v-model:value="toolbarState"
          card
        />
        <div class="content">
          <div class="symbol" v-if="toolbarState === 'symbol'">
            <Tabs
              :tabs="symbolTabs"
              v-model:value="selectedSymbolKey"
              spaceBetween
              :tabsStyle="{ margin: '10px 10px 0' }"
            />
            <div class="symbol-pool">
              <div class="symbol-item" v-for="item in symbolPool" :key="item.latex" @click="insertSymbol(item.latex)">
                <SymbolContent :latex="item.latex" />
              </div>
            </div>
          </div>
          <div class="formula" v-else>
            <div class="formula-item" v-for="item in formulaList" :key="item.label">
              <div class="formula-title">{{t(item.label)}}</div>
              <div class="formula-item-content" @click="latex = item.latex">
                <FormulaContent
                  :width="236"
                  :height="60"
                  :latex="item.latex"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="footer">
      <Button class="btn" @click="emit('close')">{{ t("取消") }}</Button>
      <Button class="btn" type="primary" @click="update()">{{ t("确定") }}</Button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { t } from '@/i18n'
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { renderLatex, renderInlineLatex, type LatexResult } from '@/utils/latex'
import { FORMULA_LIST, SYMBOL_LIST } from '@/configs/latex'
import message from '@/utils/message'

import FormulaContent from './FormulaContent.vue'
import SymbolContent from './SymbolContent.vue'
import Button from '../Button.vue'
import TextArea from '../TextArea.vue'
import Tabs from '../Tabs.vue'

interface TabItem {
  key: 'symbol' | 'formula'
  label: string
}

const tabs: TabItem[] = [
  { label: '常用符号', key: 'symbol' },
  { label: '预置公式', key: 'formula' },
]

const props = withDefaults(defineProps<{
  value?: string
  inline?: boolean
}>(), {
  value: '',
  inline: false,
})

const emit = defineEmits<{
  (event: 'update', payload: LatexResult): void
  (event: 'close'): void
}>()

const formulaList = FORMULA_LIST

const symbolTabs = SYMBOL_LIST.map(item => ({
  label: item.label,
  key: item.type,
}))

const latex = ref('')
const toolbarState = ref<'symbol' | 'formula'>('symbol')
const textAreaRef = useTemplateRef<InstanceType<typeof TextArea>>('textAreaRef')

const selectedSymbolKey = ref(SYMBOL_LIST[0].type)
const symbolPool = computed(() => {
  const selectedSymbol = SYMBOL_LIST.find(item => item.type === selectedSymbolKey.value)
  return selectedSymbol?.children || []
})

onMounted(() => {
  if (props.value) latex.value = props.value
  setTimeout(() => {
    textAreaRef.value && textAreaRef.value.focus()
  }, 0)
})

const update = () => {
  if (!latex.value) return message.error('公式不能为空')

  try {
    if (props.inline) renderInlineLatex(latex.value)
    emit('update', renderLatex(latex.value))
  }
  catch (error) {
    message.error(error instanceof Error ? error.message : '请检查 LaTeX 语法')
  }
}

const insertSymbol = (latex: string) => {
  if (!textAreaRef.value) return
  textAreaRef.value.focus()
  document.execCommand('insertText', false, latex)
}
</script>

<style lang="scss" scoped>
.latex-editor {
  height: 560px;
}
.container {
  height: calc(100% - 50px);
  display: flex;
}
.left {
  width: 540px;
  height: 100%;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.input-area {
  flex: 1;

  textarea {
    height: 100% !important;
    border-color: $borderColor !important;
    padding: 10px !important;
    font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, Courier, monospace;

    &:focus {
      box-shadow: none !important;
    }
  }
}
.preview {
  height: 160px;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  margin-top: 20px;
  border: 1px solid $borderColor;
  user-select: none;
  border-radius: $borderRadius;
}
.input-help {
  margin-top: 8px;
  color: #6e6e73;
  font-size: 11px;
}
.insertion-help { margin-top: 5px; color: #007aff; font-size: 11px; }
.placeholder {
  color: #888;
  font-size: 13px;
}
.preview-content {
  width: 100%;
  height: 100%;
  padding: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
}
.right {
  width: 280px;
  height: 100%;
  margin-left: 20px;
  border: solid 1px $borderColor;
  background-color: #fff;
  display: flex;
  flex-direction: column;
  user-select: none;
  border-radius: $borderRadius;
  overflow: hidden;
}
.content {
  height: calc(100% - 40px);
  font-size: 13px;
}
.formula {
  height: 100%;
  padding: 12px;

  @include overflow-overlay();
}
.formula-item {
  & + .formula-item {
    margin-top: 10px;
  }

  .formula-title {
    margin-bottom: 5px;
  }
  .formula-item-content {
    height: 60px;
    padding: 5px;
    display: flex;
    align-items: center;
    background-color: $lightGray;
    border-radius: $borderRadius;
    cursor: pointer;
  }
}
.symbol {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.symbol-pool {
  display: flex;
  flex-wrap: wrap;
  flex: 1;
  padding: 12px;

  @include overflow-overlay();
}
.symbol-item {
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: $borderRadius;

  &:hover {
    background-color: $lightGray;
    cursor: pointer;
  }
}
.footer {
  height: 50px;
  display: flex;
  justify-content: flex-end;
  align-items: flex-end;

  .btn {
    margin-left: 10px;
  }
}
</style>
