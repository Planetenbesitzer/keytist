<template>
  <div class="hotkey-doc">
    <p class="intro">{{ IS_MAC ? 'Mac 快捷键使用 ⌘ Command、⌥ Option 和 ⇧ Shift。' : 'Ctrl 对应 Mac 上的 Command，Alt 对应 Option。' }} 公式和对象操作采用熟悉的 Keynote 组合。</p>
    <template v-for="item in HOTKEY_DOC" :key="item.type">
      <div class="title">{{item.type}}</div>
      <div class="hotkey-item" v-for="hotkey in item.children" :key="hotkey.label">
        <template v-if="hotkey.value">
          <div class="label">{{hotkey.label}}</div>
          <div class="value">{{hotkey.value}}</div>
        </template>
        <div class="row" v-else>{{hotkey.label}}</div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { HOTKEY_DOC, IS_MAC } from '@/configs/hotkey'
</script>

<style lang="scss" scoped>
.hotkey-doc {
  height: 100%;
  overflow: auto;
  font-size: 12px;
  margin: 0 -15px;
  padding: 0 15px 15px;
}
.title {
  font-size: 14px;
  font-weight: 700;
  border-bottom: 1px solid #e5e5e5;
  padding: 25px 0 5px 0;

  &:first-child {
    padding-top: 0;
  }
}
.intro { color: #7c818b; line-height: 1.7; margin: 0 0 12px; }
.hotkey-item {
  border-bottom: 1px solid #e5e5e5;
  padding: 15px 0 5px 0;
  display: flex;
  align-items: center;
}
.label {
  width: 140px;
  flex: 1;

  @include ellipsis-oneline();
}
.value { margin-left: 14px; white-space: nowrap; font-size: 11px; color: #656973; }
</style>
