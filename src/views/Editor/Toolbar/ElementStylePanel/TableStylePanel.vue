<template>
  <div class="table-style-panel">
    <SelectGroup class="row">
      <Select
        style="width: 50%;"
        :value="textAttrs.fontname"
        search
        :searchLabel="t('搜索字体')"
        autofocus
        @update:value="value => updateTextAttrs({ fontname: value as string })"
        :options="FONTS"
      >
        <template #icon>
          <i-icon-park-outline:font-size />
        </template>
      </Select>
      <Select
        style="width: 50%;"
        :value="textAttrs.fontsize"
        search
        :searchLabel="t('搜索字号')"
        autofocus
        @update:value="value => updateTextAttrs({ fontsize: value as string })"
        :options="fontSizeOptions.map(item => ({
          label: item, value: item
        }))"
      >
        <template #icon>
          <i-icon-park-outline:add-text />
        </template>
      </Select>
    </SelectGroup>

    <ButtonGroup class="row" passive>
      <Popover trigger="click" style="width: 50%;">
        <template #content>
          <ColorPicker
            :modelValue="textAttrs.color"
            @update:modelValue="value => updateTextAttrs({ color: value })"
          />
        </template>
        <TextColorButton first v-tooltip="t('文字颜色')" :color="textAttrs.color">
          <i-icon-park-outline:text />
        </TextColorButton>
      </Popover>
      <Popover trigger="click" style="width: 50%;">
        <template #content>
          <ColorPicker
            :modelValue="textAttrs.backcolor"
            @update:modelValue="value => updateTextAttrs({ backcolor: value })"
          />
        </template>
        <TextColorButton last v-tooltip="t('单元格填充')" :color="textAttrs.backcolor">
          <i-icon-park-outline:fill />
        </TextColorButton>
      </Popover>
    </ButtonGroup>

    <ButtonGroup class="row">
      <CheckboxButton
        style="flex: 1;"
        :checked="textAttrs.bold"
        v-tooltip="t('加粗')"
        @click="updateTextAttrs({ bold: !textAttrs.bold })"
      ><i-icon-park-outline:text-bold /></CheckboxButton>
      <CheckboxButton
        style="flex: 1;"
        :checked="textAttrs.em"
        v-tooltip="t('斜体')"
        @click="updateTextAttrs({ em: !textAttrs.em })"
      ><i-icon-park-outline:text-italic /></CheckboxButton>
      <CheckboxButton
        style="flex: 1;"
        :checked="textAttrs.underline"
        v-tooltip="t('下划线')"
        @click="updateTextAttrs({ underline: !textAttrs.underline })"
      ><i-icon-park-outline:text-underline /></CheckboxButton>
      <CheckboxButton
        style="flex: 1;"
        :checked="textAttrs.strikethrough"
        v-tooltip="t('删除线')"
        @click="updateTextAttrs({ strikethrough: !textAttrs.strikethrough })"
      ><i-icon-park-outline:strikethrough /></CheckboxButton>
    </ButtonGroup>

    <RadioGroup
      class="row"
      button-style="solid"
      :value="textAttrs.align"
      @update:value="value => updateTextAttrs({ align: value as TextAlign })"
    >
      <RadioButton value="left" v-tooltip="t('左对齐')" style="flex: 1;"><i-icon-park-outline:align-text-left /></RadioButton>
      <RadioButton value="center" v-tooltip="t('居中')" style="flex: 1;"><i-icon-park-outline:align-text-center /></RadioButton>
      <RadioButton value="right" v-tooltip="t('右对齐')" style="flex: 1;"><i-icon-park-outline:align-text-right /></RadioButton>
      <RadioButton value="justify" v-tooltip="t('两端对齐')" style="flex: 1;"><i-icon-park-outline:align-text-both /></RadioButton>
    </RadioGroup>

    <RadioGroup
      class="row"
      button-style="solid"
      :value="textAttrs.vAlign"
      @update:value="value => updateTextAttrs({ vAlign: value as TextAlignVertical })"
    >
      <RadioButton value="top" v-tooltip="t('顶对齐')" style="flex: 1;"><i-icon-park-outline:align-text-top-one /></RadioButton>
      <RadioButton value="middle" v-tooltip="t('垂直居中')" style="flex: 1;"><i-icon-park-outline:align-text-middle-one /></RadioButton>
      <RadioButton value="bottom" v-tooltip="t('底对齐')" style="flex: 1;"><i-icon-park-outline:align-text-bottom-one /></RadioButton>
    </RadioGroup>

    <Divider />

    <ElementOutline :fixed="true" />

    <Divider />

    <div class="row">
      <div style="width: 40%;">{{ t("操作行：") }}</div>
      <ButtonGroup style="width: 60%;" passive>
        <Button first style="flex: 1;" @click="emitTableCommand('insert-row', 'after')">{{ t("添加行") }}</Button>
        <Popover trigger="click">
          <template #content>
            <PopoverMenuItem center @click="emitTableCommand('insert-row', 'before')">{{ t("上方添加") }}</PopoverMenuItem>
            <PopoverMenuItem center @click="emitTableCommand('insert-row', 'after')">{{ t("下方添加") }}</PopoverMenuItem>
            <PopoverMenuItem center @click="emitTableCommand('delete-row')">{{ t("删除行") }}</PopoverMenuItem>
          </template>
          <Button last class="popover-btn"><i-icon-park-outline:down /></Button>
        </Popover>
      </ButtonGroup>
    </div>
    <div class="row">
      <div style="width: 40%;">{{ t("操作列：") }}</div>
      <ButtonGroup style="width: 60%;" passive>
        <Button first style="flex: 1;" @click="emitTableCommand('insert-col', 'after')">{{ t("添加列") }}</Button>
        <Popover trigger="click">
          <template #content>
            <PopoverMenuItem center @click="emitTableCommand('insert-col', 'before')">{{ t("左侧添加") }}</PopoverMenuItem>
            <PopoverMenuItem center @click="emitTableCommand('insert-col', 'after')">{{ t("右侧添加") }}</PopoverMenuItem>
            <PopoverMenuItem center @click="emitTableCommand('delete-col')">{{ t("删除列") }}</PopoverMenuItem>
          </template>
          <Button last class="popover-btn"><i-icon-park-outline:down /></Button>
        </Popover>
      </ButtonGroup>
    </div>

    <Divider />

    <div class="row theme-switch">
      <div style="width: 40%;">{{ t("启用主题表格：") }}</div>
      <div class="switch-wrapper" style="width: 60%;">
        <Switch
          :value="hasTheme"
          @update:value="value => toggleTheme(value)"
        />
      </div>
    </div>

    <template v-if="theme">
      <div class="row">
        <Checkbox
          @update:value="value => updateTheme({ rowHeader: value })"
          :value="theme.rowHeader"
          style="flex: 1;"
        >{{ t("标题行") }}</Checkbox>
        <Checkbox
          @update:value="value => updateTheme({ rowFooter: value })"
          :value="theme.rowFooter"
          style="flex: 1;"
        >{{ t("汇总行") }}</Checkbox>
      </div>
      <div class="row">
        <Checkbox
          @update:value="value => updateTheme({ colHeader: value })"
          :value="theme.colHeader"
          style="flex: 1;"
        >{{ t("第一列") }}</Checkbox>
        <Checkbox
          @update:value="value => updateTheme({ colFooter: value })"
          :value="theme.colFooter"
          style="flex: 1;"
        >{{ t("最后一列") }}</Checkbox>
      </div>
      <div class="row">
        <div style="width: 40%;">{{ t("主题颜色：") }}</div>
        <Popover trigger="click" style="width: 60%;">
          <template #content>
            <ColorPicker
              :modelValue="theme.color"
              @update:modelValue="value => updateTheme({ color: value })"
            />
          </template>
          <ColorButton :color="theme.color" />
        </Popover>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { t } from '@/i18n'
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore, useSlidesStore } from '@/store'
import type { PPTTableElement, TableCell, TableCellStyle, TableTheme, TextAlign, TextAlignVertical } from '@/types/slides'
import { FONTS } from '@/configs/font'
import emitter, { EmitterEvents, type TableCommand } from '@/utils/emitter'
import useHistorySnapshot from '@/hooks/useHistorySnapshot'

import ElementOutline from '../common/ElementOutline.vue'
import ColorButton from '@/components/ColorButton.vue'
import TextColorButton from '@/components/TextColorButton.vue'
import CheckboxButton from '@/components/CheckboxButton.vue'
import ColorPicker from '@/components/ColorPicker/index.vue'
import Divider from '@/components/Divider.vue'
import Switch from '@/components/Switch.vue'
import Checkbox from '@/components/Checkbox.vue'
import Button from '@/components/Button.vue'
import ButtonGroup from '@/components/ButtonGroup.vue'
import RadioButton from '@/components/RadioButton.vue'
import RadioGroup from '@/components/RadioGroup.vue'
import Select from '@/components/Select.vue'
import SelectGroup from '@/components/SelectGroup.vue'
import Popover from '@/components/Popover.vue'
import PopoverMenuItem from '@/components/PopoverMenuItem.vue'

const slidesStore = useSlidesStore()
const { handleElement, handleElementId, selectedTableCells: selectedCells } = storeToRefs(useMainStore())
const themeColor = computed(() => slidesStore.theme.themeColors[0])

const fontSizeOptions = [
  '12px', '14px', '16px', '18px', '20px', '22px', '24px', '28px', '32px',
]

const textAttrs = ref({
  bold: false,
  em: false,
  underline: false,
  strikethrough: false,
  color: '#000',
  backcolor: '',
  fontsize: '12px',
  fontname: '',
  align: 'left',
  vAlign: 'top',
})

const theme = ref<TableTheme>()
const hasTheme = ref(false)

watch(handleElement, () => {
  if (!handleElement.value || handleElement.value.type !== 'table') return

  theme.value = handleElement.value.theme
  hasTheme.value = !!theme.value
}, { deep: true, immediate: true })

const { addHistorySnapshot } = useHistorySnapshot()

// 更新当前选中单元格的文本样式状态
const updateTextAttrState = () => {
  if (!handleElement.value || handleElement.value.type !== 'table') return

  let rowIndex = 0
  let colIndex = 0
  if (selectedCells.value.length) {
    const selectedCell = selectedCells.value[0]
    rowIndex = +selectedCell.split('_')[0]
    colIndex = +selectedCell.split('_')[1]
  }
  const style = handleElement.value.data[rowIndex][colIndex].style

  if (!style) {
    textAttrs.value = {
      bold: false,
      em: false,
      underline: false,
      strikethrough: false,
      color: '#000',
      backcolor: '',
      fontsize: '12px',
      fontname: '',
      align: 'left',
      vAlign: 'top',
    }
  }
  else {
    textAttrs.value = {
      bold: !!style.bold,
      em: !!style.em,
      underline: !!style.underline,
      strikethrough: !!style.strikethrough,
      color: style.color || '#000',
      backcolor: style.backcolor || '',
      fontsize: style.fontsize || '12px',
      fontname: style.fontname || '',
      align: style.align || 'left',
      vAlign: style.vAlign || 'top',
    }
  }
}

onMounted(() => {
  updateTextAttrState()
})

watch(selectedCells, updateTextAttrState)

const updateElement = (props: Partial<PPTTableElement>) => {
  slidesStore.updateElement({ id: handleElementId.value, props })
  addHistorySnapshot()
}

// 设置单元格内容文本样式
const updateTextAttrs = (textAttrProp: Partial<TableCellStyle>) => {
  const _handleElement = handleElement.value as PPTTableElement

  const data: TableCell[][] = JSON.parse(JSON.stringify(_handleElement.data))

  for (let i = 0; i < data.length; i++) {
    for (let j = 0; j < data[i].length; j++) {
      if (!selectedCells.value.length || selectedCells.value.includes(`${i}_${j}`)) {
        const style = data[i][j].style || {}
        data[i][j].style = { ...style, ...textAttrProp }
      }
    }
  }
  updateElement({ data })
  updateTextAttrState()
}

// 更新表格主题：主题色、标题行、汇总行、第一列、最后一列
const updateTheme = (themeProp: Partial<TableTheme>) => {
  if (!theme.value) return
  const _theme = { ...theme.value, ...themeProp }
  updateElement({ theme: _theme })
}

// 开启/关闭表格主题
const toggleTheme = (checked: boolean) => {
  if (checked) {
    const props = {
      theme: {
        color: themeColor.value,
        rowHeader: true,
        rowFooter: false,
        colHeader: false,
        colFooter: false,
      }
    }
    updateElement(props)
  }
  else {
    slidesStore.removeElementProps({ id: handleElementId.value, propName: 'theme' })
    addHistorySnapshot()
  }
}

const emitTableCommand = (command: TableCommand['command'], position?: TableCommand['position']) => {
  emitter.emit(EmitterEvents.TABLE_COMMAND, {
    targetId: handleElementId.value,
    command,
    position,
  })
}
</script>

<style lang="scss" scoped>
.row {
  width: 100%;
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}
.theme-switch {
  margin-bottom: 18px;
}
.switch-wrapper {
  text-align: right;
}
.popover-btn {
  width: 32px;
  padding: 0 3px;
}
</style>
