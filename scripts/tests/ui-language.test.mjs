/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { computed } from 'vue'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const { parse } = require('@vue/compiler-sfc')
const ts = require('typescript')
const compiled = await build({
  stdin: { contents: "export * from './src/i18n/index.ts'; export * from './src/i18n/messages.ts'", resolveDir: root },
  absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
})
const sourceModule = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, sourceModule, sourceModule.exports)
const { t, language, setUiLanguage, readUiLanguage, englishMessages, uiOptionLabel } = sourceModule.exports

test('new installation follows browser language while existing preferences retain Chinese', () => {
  const storage = entries => ({ getItem: key => entries[key] || null })
  assert.equal(readUiLanguage(storage({}), 'en-US'), 'en')
  assert.equal(readUiLanguage(storage({}), 'zh-TW'), 'zh-CN')
  assert.equal(readUiLanguage(storage({ 'slide-studio:sidebar-layout-v1': '{}' }), 'en-US'), 'zh-CN')
  assert.equal(readUiLanguage(storage({ 'slide-studio-style-library-v1': '{}' }), 'en-US'), 'zh-CN')
  assert.equal(readUiLanguage(storage({ PPTIST_DISCARDED_DB: '[]' }), 'en-US'), 'zh-CN')
  assert.equal(readUiLanguage(storage({ 'slide-studio:ui-language-v1': 'en', PPTIST_DISCARDED_DB: '[]' }), 'zh-CN'), 'en')
  assert.equal(readUiLanguage({ getItem() {
    throw new Error('Blocked') 
  } }, 'en'), 'en')
})

test('language switch is reactive and writes only its separate preference, retaining documents and custom settings', () => {
  const documentJson = JSON.stringify({ title: '标题', slides: [{ content: '<p>样式 English 公式</p>', html: { source: '<script>const label="保存"</script>' } }] })
  const settings = JSON.stringify({ presets: [{ name: '柔和', values: { fill: '#123456' } }], defaults: { text: 'mine' } })
  const memory = new Map([['user-document', documentJson], ['slide-studio-style-library-v1', settings], ['slide-studio:sidebar-layout-v1', '{"navigationVisible":false}']])
  const writes = []
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = { localStorage: { setItem(key, value) {
    writes.push(key); memory.set(key, value) 
  } } }
  globalThis.document = { documentElement: {} }
  try {
    const title = computed(() => t('格式'))
    setUiLanguage('en')
    assert.equal(title.value, 'Format')
    assert.equal(t('导出'), 'Export')
    assert.equal(t('第 {page} 页图片 {label}：{error}', { page: 3, label: '标题', error: 'Failure' }), 'Slide 3, image 标题: Failure')
    assert.equal(t('Unregistered user text — 标题'), 'Unregistered user text — 标题')
    assert.equal(t('已保存 /my-files/标题.json'), 'Saved /my-files/标题.json')
    assert.equal(uiOptionLabel({ label: '标题', fontFamily: '标题' }), '标题')
    assert.equal(uiOptionLabel({ label: '柔和', localize: false }), '柔和')
    assert.equal(uiOptionLabel({ label: '标题' }), 'Title')
    setUiLanguage('zh-CN')
    assert.equal(title.value, '格式')
    assert.equal(language.value, 'zh-CN')
    assert.equal(globalThis.document.documentElement.lang, 'zh-CN')
    assert.deepEqual([...new Set(writes)], ['slide-studio:ui-language-v1'])
    assert.equal(memory.get('user-document'), documentJson)
    assert.equal(memory.get('slide-studio-style-library-v1'), settings)
    assert.equal(memory.get('slide-studio:sidebar-layout-v1'), '{"navigationVisible":false}')
  }
  finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})

test('all explicit UI translation keys have English translations with matching parameters', async () => {
  const files = async directory => (await Promise.all((await fs.readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat()
  const missing = new Set()
  for (const file of await files(path.join(root, 'src'))) {
    if (!/\.(vue|ts)$/.test(file) || file.includes(`${path.sep}i18n${path.sep}`)) continue
    let source = await fs.readFile(file, 'utf8')
    if (file.endsWith('.vue')) {
      const descriptor = parse(source).descriptor
      source = [descriptor.script?.content || '', descriptor.scriptSetup?.content || '', descriptor.template?.content || ''].join('\n')
    }
    // Literal t() calls are the public translation contract, including templates.
    for (const match of source.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const literal = ts.createSourceFile('literal.ts', match[1] + match[2] + match[1], ts.ScriptTarget.Latest, true).statements[0]?.expression
      const key = literal?.text
      if (key && /[\u3400-\u9fff]/.test(key) && !(key in englishMessages)) missing.add(key)
    }
  }
  assert.deepEqual([...missing], [])
  for (const [key, value] of Object.entries(englishMessages)) {
    assert.equal(typeof value, 'string', key)
    assert.deepEqual([...key.matchAll(/\{([\w]+)\}/g)].map(match => match[1]).sort(), [...value.matchAll(/\{([\w]+)\}/g)].map(match => match[1]).sort(), key)
  }
})
