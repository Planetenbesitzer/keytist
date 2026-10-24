/* eslint-env node */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Load the real TypeScript utility and geometry dependency without producing a build.
const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-marquee-test-'))
const server = await createServer({
  configFile: false,
  cacheDir: cacheDirectory,
  logLevel: 'error',
  server: { middlewareMode: true },
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
const { getMarqueeRange, getMarqueeSelectedIds } = await server.ssrLoadModule('/src/utils/marqueeSelection.ts')
const shape = (id, left = 100, top = 100, options = {}) => ({ id, type: 'shape', left, top, width: 100, height: 80, rotate: 0, ...options })
const select = (elements, start, end, hidden) => getMarqueeSelectedIds(elements, getMarqueeRange(start, end), hidden)

test('partial overlap works for all four drag directions and retains document order', () => {
  const elements = [shape('a'), shape('b', 300)]
  for (const [start, end] of [[[90, 90], [110, 110]], [[110, 90], [90, 110]], [[110, 110], [90, 90]], [[90, 110], [110, 90]]]) {
    assert.deepEqual(select(elements, start, end), ['a'])
  }
  assert.deepEqual(select(elements, [80, 80], [410, 190]), ['a', 'b'])
  assert.deepEqual(select(elements, [400, 180], [190, 170]), ['a', 'b'])
})

test('blank, edge-only contact, and zero-area selections do not select', () => {
  const elements = [shape('a')]
  for (const [start, end] of [[[1, 1], [40, 40]], [[80, 100], [100, 180]], [[200, 90], [230, 190]], [[90, 80], [210, 100]], [[90, 180], [210, 220]], [[110, 110], [110, 150]], [[110, 110], [150, 110]]]) {
    assert.deepEqual(select(elements, start, end), [])
  }
  assert.deepEqual(select(elements, [199.9, 179.9], [220, 200]), ['a'])
})

test('locked and hidden objects never enter marquee selection', () => {
  const elements = [shape('a'), shape('locked', 110, 110, { lock: true }), shape('hidden', 120)]
  assert.deepEqual(select(elements, [90, 90], [250, 200], ['hidden']), ['a'])
})

test('a hit on any group member selects the whole group; unavailable members protect the group', () => {
  const elements = [shape('a', 100, 100, {groupId: 'g'}), shape('b', 400, 100, {groupId: 'g'}), shape('c', 650)]
  assert.deepEqual(select(elements, [90, 90], [110, 110]), ['a', 'b'])
  assert.deepEqual(select(elements, [90, 90], [110, 110], ['b']), [])
  assert.deepEqual(select([elements[0], {...elements[1], lock: true}], [90, 90], [110, 110]), [])
  assert.deepEqual(select(elements, [90, 90], [670, 190]), ['a', 'b', 'c'])
})

test('rotation and line geometry use the existing visible bounding range without mutating data', () => {
  const elements = [shape('rotated', 100, 100, {rotate: 45}), { id: 'line', type: 'line', left: 300, top: 100, start: [0, 0], end: [100, 0], width: 100, height: 0 }]
  const original = JSON.stringify(elements)
  assert.deepEqual(select(elements, [85, 95], [100, 115]), ['rotated'])
  assert.deepEqual(select(elements, [320, 90], [340, 110]), ['line'])
  assert.equal(JSON.stringify(elements), original)
})
