/* eslint-env node, es2020 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-style-test-'))
const server = await createServer({
  configFile: false, cacheDir: cacheDirectory, logLevel: 'error', server: { middlewareMode: true },
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
})
after(async () => {
  try {
    await server.close()
  }
  finally {
    await fs.rm(cacheDirectory, { recursive: true, force: true })
  }
})
const { captureElementStyle, applyElementStyle, sanitizeStyleValues, BUILTIN_OBJECT_STYLES } = await server.ssrLoadModule('/src/utils/stylePresets.ts')
const base = { id: 'private-id', left: 10, top: 20, width: 300, height: 200, rotate: 23, groupId: 'private-group', lock: true, link: { type: 'web', target: 'https://example.com/private' } }

test('captured styles contain appearance only, including nested whitelist filtering', () => {
  const image = { ...base, type: 'image', src: 'data:image/png;base64,PRIVATE', clip: { range: [[20, 30], [80, 90]], shape: 'rect' }, radius: 12, shadow: { h: 2, v: 3, blur: 4, color: '#000', src: 'PRIVATE' }, outline: { width: 2, color: '#fff', content: 'PRIVATE' } }
  assert.deepEqual(captureElementStyle(image), { outline: { width: 2, color: '#fff' }, shadow: { h: 2, v: 3, blur: 4, color: '#000' }, radius: 12 })
  assert.equal(JSON.stringify(captureElementStyle(image)).includes('PRIVATE'), false)
  assert.deepEqual(sanitizeStyleValues('shape', { pattern: 'data:image/png;base64,PRIVATE', fill: 'url(data:image/png,PRIVATE)', content: 'private text', gradient: { type: 'linear', colors: [{ pos: 0, color: '#fff', src: 'PRIVATE' }], rotate: 90 } }), { gradient: { type: 'linear', colors: [{ pos: 0, color: '#fff' }], rotate: 90 } })
})

test('plain image style clears optional appearance and preserves all content/geometry', () => {
  const image = { ...base, type: 'image', src: 'PRIVATE', fixedRatio: true, radius: 12, outline: { width: 3 }, shadow: { h: 2, v: 3, blur: 4, color: '#000' }, filters: { blur: '3px' }, colorMask: '#fff', clip: { range: [[0, 0], [80, 90]], shape: 'rect' } }
  const original = JSON.stringify(image)
  const result = applyElementStyle(image, { kind: 'image', values: {} })
  assert.deepEqual(result, { ...base, type: 'image', src: 'PRIVATE', fixedRatio: true, clip: image.clip })
  assert.equal(JSON.stringify(image), original)
})

test('formula styles preserve LaTeX, rendered SVG and intrinsic geometry exactly', () => {
  const formula = { ...base, type: 'latex', latex: '\\int_0^1 x dx', svg: '<svg>PRIVATE</svg>', path: 'PRIVATE', viewBox: [300, 200], fixedRatio: true, color: '#000', strokeWidth: 2 }
  const result = applyElementStyle(formula, { kind: 'latex', values: { color: '#007aff', strokeWidth: 3, latex: 'WRONG', width: 100 } })
  assert.deepEqual(result, { ...formula, color: '#007aff', strokeWidth: 3 })
  assert.deepEqual(captureElementStyle(formula), { color: '#000', strokeWidth: 2 })
})

test('line styles treat stroke width as appearance but never copy endpoint coordinates', () => {
  const line = { ...base, type: 'line', start: [0, 0], end: [100, 50], cubic: [[20, 30], [50, 60]], color: '#000', width: 2, style: 'solid', points: ['', ''] }
  const result = applyElementStyle(line, { kind: 'line', values: { color: '#a477c8', width: 4, style: 'dashed', points: ['', 'arrow'], start: [90, 90] } })
  assert.deepEqual(result, { ...line, color: '#a477c8', width: 4, style: 'dashed', points: ['', 'arrow'] })
  assert.deepEqual(applyElementStyle(line, { kind: 'image', values: {} }), line)
})

test('table style transfer changes cell appearance while preserving text, merges and row sizes', () => {
  const table = { ...base, type: 'table', outline: { width: 2, color: '#000' }, colWidths: [.3, .7], cellMinHeight: 36, rowHeights: [72], data: [[{ id: 'cell-private', text: 'Words retained', rowspan: 2, colspan: 1, style: { color: '#000' } }]] }
  const style = captureElementStyle(table)
  assert.deepEqual(style, { outline: table.outline, cellStyle: { color: '#000' } })
  const result = applyElementStyle(table, { kind: 'table', values: { outline: { width: 1, color: '#d1d1d6' }, cellStyle: { color: '#007aff', fontname: 'Arial', fontsize: '24px', text: 'WRONG' } } })
  assert.deepEqual(result.data[0][0], { ...table.data[0][0], style: { color: '#007aff', fontname: 'Arial', fontsize: '24px' } })
  assert.deepEqual(result.rowHeights, table.rowHeights)
  assert.deepEqual(result.colWidths, table.colWidths)
})

test('library persists only whitelist values and commits in-memory state after successful write', async () => {
  const memory = new Map()
  globalThis.localStorage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) }
  const { createPinia } = await import('pinia')
  const { useStylePresetsStore, STYLE_LIBRARY_STORAGE_KEY } = await server.ssrLoadModule('/src/store/stylePresets.ts')
  const store = useStylePresetsStore(createPinia())
  const id = store.add('image', 'My frame', { radius: 12, src: 'data:image/png,PRIVATE', left: 999, outline: { color: '#fff', width: 2 } })
  store.setDefault('image', id)
  store.update('image-1', { name: 'Renamed builtin', values: { shadow: { h: 1, v: 2, blur: 3, color: '#000' } } })
  const saved = memory.get(STYLE_LIBRARY_STORAGE_KEY)
  assert.equal(saved.includes('PRIVATE'), false)
  assert.equal(saved.includes('999'), false)
  const loaded = useStylePresetsStore(createPinia())
  assert.equal(loaded.library.defaults.image, id)
  assert.equal(loaded.library.presets.find(preset => preset.id === id).name, 'My frame')
  assert.equal(loaded.library.presets.find(preset => preset.id === 'image-1').name, 'Renamed builtin')
  const previous = JSON.stringify(loaded.library)
  globalThis.localStorage.setItem = () => {
    throw new Error('QuotaExceededError')
  }
  assert.throws(() => loaded.add('image', 'Cannot save', {}), /无法保存样式库/)
  assert.equal(JSON.stringify(loaded.library), previous)
  globalThis.localStorage.setItem = (key, value) => memory.set(key, value)
  loaded.remove(id)
  assert.equal(loaded.library.defaults.image, undefined)
  loaded.restore('image')
  assert.deepEqual(loaded.library.presets.find(preset => preset.id === 'image-1'), BUILTIN_OBJECT_STYLES.find(preset => preset.id === 'image-1'))
  const manyPresets = Array.from({ length: 263 }, (_, index) => ({ id: `large-library-${index}`, kind: 'image', name: `Style ${index}`, values: { radius: index % 20 } }))
  loaded.save({ ...loaded.library, presets: manyPresets, defaults: {} })
  assert.equal(useStylePresetsStore(createPinia()).library.presets.length, 263)
})
