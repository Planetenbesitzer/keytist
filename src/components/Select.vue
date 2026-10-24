<template>
  <div class="select-wrap" v-if="disabled">
    <div class="select disabled" ref="selectRef">
      <div class="selector">{{ showLabel }}</div>
      <div class="icon">
        <slot name="icon">
          <i-icon-park-outline:down />
        </slot>
      </div>
    </div>
  </div>
  <Popover
    class="select-wrap"
    trigger="click"
    v-model:value="popoverVisible"
    placement="bottom"
    :contentStyle="{
      padding: 0,
      boxShadow: '0 6px 16px 0 rgba(0, 0, 0, 0.08)',
    }"
    v-else
  >
    <template #content>
      <template v-if="search">
        <Input ref="searchInputRef" simple :placeholder="t(searchLabel)" v-model:value="searchKey" :style="{ width: optionWidth + 2 + 'px' }" />
        <Divider :margin="0" />
      </template>
      <div class="options" ref="optionsRef" :style="{ width: optionWidth + 2 + 'px' }">
        <template v-for="(option, index) in showOptions" :key="option.value">
          <div class="option-group" v-if="option.group && (index === 0 || option.group !== showOptions[index - 1].group)">{{t(option.group)}}</div>
          <div class="option"
            :class="{ disabled: option.disabled, selected: option.value === value }"
            :style="option.fontFamily ? { fontFamily: option.fontFamily } : undefined"
            @click="handleSelect(option)"
          >{{ uiOptionLabel(option) }}<span class="option-note" v-if="option.note">{{t(option.note)}}</span></div>
        </template>
      </div>
    </template>
    <div class="select" ref="selectRef">
      <div class="selector">{{ showLabel }}</div>
      <div class="icon">
        <slot name="icon">
          <i-icon-park-outline:down />
        </slot>
      </div>
    </div>
  </Popover>
</template>

<script lang="ts" setup>
import { t, uiOptionLabel } from '@/i18n'
import { computed, onMounted, onUnmounted, ref, watch, nextTick, onBeforeUnmount, useTemplateRef } from 'vue'
import Popover from './Popover.vue'
import Input from './Input.vue'
import Divider from './Divider.vue'

interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
  fontFamily?: string
  group?: string
  note?: string
  localize?: boolean
}

const props = withDefaults(defineProps<{
  value: string | number
  options: SelectOption[]
  disabled?: boolean
  autofocus?: boolean
  defaultLabel?: string
  search?: boolean
  searchLabel?: string
}>(), {
  disabled: false,
  autofocus: false,
  defaultLabel: '',
  search: false,
  searchLabel: '搜索',
})

const emit = defineEmits<{
  (event: 'update:value', payload: string | number): void
}>()

const popoverVisible = ref(false)
const width = ref(0)
const optionWidth = computed(() => props.options.some(option => option.fontFamily) ? Math.max(width.value, 230) : width.value)
const searchKey = ref('')
const selectRef = useTemplateRef<HTMLElement>('selectRef')
const optionsRef = useTemplateRef<HTMLElement>('optionsRef')
const searchInputRef = useTemplateRef<InstanceType<typeof Input>>('searchInputRef')

const showLabel = computed(() => {
  const option = props.options.find(item => item.value === props.value)
  if (option?.fontFamily && option.disabled) return `${uiOptionLabel(option)} · ${t('未安装')}`
  return option ? uiOptionLabel(option) : props.defaultLabel ? t(props.defaultLabel) : props.value
})

const showOptions = computed(() => {
  if (!props.search) return props.options
  if (!searchKey.value.trim()) return props.options
  const opts = props.options.filter(item => {
    return uiOptionLabel(item).toLowerCase().includes(searchKey.value.toLowerCase()) || item.label.toLowerCase().includes(searchKey.value.toLowerCase())
  })
  return opts.length ? opts : props.options
})

watch(popoverVisible, () => {
  if (popoverVisible.value) {
    nextTick(() => {
      if (searchInputRef.value) searchInputRef.value.focus()
      if (props.autofocus && optionsRef.value) {
        optionsRef.value.querySelector('.option.selected')?.scrollIntoView({ block: 'center' })
      }
    })
  }
  else searchKey.value = ''
})
onBeforeUnmount(() => {
  searchKey.value = ''
})

const updateWidth = () => {
  if (!selectRef.value) return
  width.value = selectRef.value.clientWidth
}
const resizeObserver = new ResizeObserver(updateWidth)
onMounted(() => {
  if (!selectRef.value) return
  resizeObserver.observe(selectRef.value)
})
onUnmounted(() => {
  if (!selectRef.value) return
  resizeObserver.unobserve(selectRef.value)
})

const handleSelect = (option: SelectOption) => {
  if (option.disabled) return

  emit('update:value', option.value)
  popoverVisible.value = false
}
</script>

<style lang="scss" scoped>
.select {
  width: 100%;
  height: 32px;
  padding-right: 32px;
  border-radius: $borderRadius;
  transition: border-color .25s;
  font-size: 13px;
  user-select: none;
  background-color: #fff;
  border: 1px solid #d9d9d9;
  position: relative;
  cursor: pointer;

  &:not(.disabled):hover {
    border-color: $themeColor;
  }

  &.disabled {
    background-color: #f5f5f5;
    border-color: #dcdcdc;
    color: #b7b7b7;
    cursor: default;
  }

  .selector {
    min-width: 50px;
    height: 30px;
    line-height: 30px;
    padding-left: 10px;
    @include ellipsis-oneline();
  }
}
.options {
  max-height: 260px;
  padding: 5px;
  overflow: auto;
  text-align: left;
  font-size: 13px;
  user-select: none;
}
.option {
  height: 32px;
  line-height: 32px;
  padding: 0 5px;
  border-radius: $borderRadius;
  @include ellipsis-oneline();

  &.disabled {
    color: #b7b7b7;
  }
  &:not(.disabled, .selected):hover {
    background-color: rgba($color: $themeColor, $alpha: .05);
    cursor: pointer;
  }

  &.selected {
    color: $themeColor;
    font-weight: 700;
  }
}
.option-group { color: #929298; font: 500 10px -apple-system, BlinkMacSystemFont, sans-serif; padding: 8px 5px 3px; letter-spacing: .2px; }
.option-note { float: right; font: 10px/32px -apple-system, BlinkMacSystemFont, sans-serif; color: #929298; margin-left: 6px; }
.icon {
  width: 32px;
  height: 30px;
  color: #bfbfbf;
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
