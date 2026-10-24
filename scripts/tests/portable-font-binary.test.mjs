/* eslint-env node, es2020 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-font-binary-test-'))
const server = await createServer({
  configFile: false, cacheDir: cache, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true, hmr: false },
})
after(async () => {
  try {
    await server.close()
  }
  finally {
    await fs.rm(cache, { recursive: true, force: true })
  }
})
const { decodeWoff2Font, isWoff2Font, MAX_DECODED_FONT_BYTES } = await server.ssrLoadModule('/src/utils/portableFontBinary.ts')
const font = name => fs.readFile(new URL(`../../src/assets/fonts/${name}.woff2`, import.meta.url))
const tablesOf = buffer => {
  const view = new DataView(buffer), tables = new Map()
  assert.ok([0x00010000, 0x4f54544f].includes(view.getUint32(0)), 'decoded SFNT signature')
  for (let index = 0; index < view.getUint16(4); index++) {
    const directory = 12 + index * 16
    const name = String.fromCharCode(...new Uint8Array(buffer, directory, 4))
    const offset = view.getUint32(directory + 8), length = view.getUint32(directory + 12)
    assert.ok(offset + length <= buffer.byteLength, `${name} table is inside font`)
    assert.equal(offset % 4, 0, `${name} table alignment`)
    tables.set(name, { offset, length })
  }
  return { view, tables }
}

test('decodes three real bundled WOFF2 files including a full Chinese font', async () => {
  for (const name of ['Inter', 'SourceSansPro', 'SourceHanSans']) {
    const source = await font(name)
    assert.equal(isWoff2Font(source), true)
    const decoded = await decodeWoff2Font(source)
    const { view, tables } = tablesOf(decoded)
    for (const tag of ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'name', 'OS/2']) assert.ok(tables.has(tag), `${name} preserves ${tag}`)
    assert.ok(tables.get('cmap').length > 20)
    assert.ok(tables.get('name').length > 20)
    assert.ok(view.getUint16(tables.get('maxp').offset + 4) > 100, `${name} preserves glyphs`)
    assert.ok(decoded.byteLength > source.byteLength, `${name} reconstructs actual font data`)
    assert.ok(decoded.byteLength < MAX_DECODED_FONT_BYTES)
  }
})

test('uses only a Uint8Array view range and preserves caller bytes', async () => {
  const source = await font('Inter')
  const allocation = new Uint8Array(source.length + 26).fill(0xa5)
  allocation.set(source, 13)
  const slice = allocation.subarray(13, 13 + source.length)
  const before = allocation.slice()
  assert.equal(isWoff2Font(slice), true)
  assert.equal(isWoff2Font(allocation), false)
  const [normal, sliced] = await Promise.all([decodeWoff2Font(source), decodeWoff2Font(slice)])
  assert.deepEqual(new Uint8Array(normal), new Uint8Array(sliced))
  assert.deepEqual(allocation, before)
})

test('accepts advisory totalSfntSize differences and nonzero reserved field', async () => {
  const source = Uint8Array.from(await font('Inter'))
  const altered = source.slice(), header = new DataView(altered.buffer)
  header.setUint32(16, 16)
  header.setUint16(14, 1)
  const decoded = await decodeWoff2Font(altered)
  assert.deepEqual(new Uint8Array(decoded), new Uint8Array(await decodeWoff2Font(source)))
})

test('rejects malformed headers and declared excessive resources before decoding', async () => {
  const source = Uint8Array.from(await font('Inter'))
  assert.equal(isWoff2Font(new Uint8Array(3)), false)
  for (const invalid of [new Uint8Array(48), source.subarray(0, 20), source.subarray(0, source.length - 1)]) {
    await assert.rejects(decodeWoff2Font(invalid), /WOFF2/)
  }
  const oversized = source.slice()
  new DataView(oversized.buffer).setUint32(16, MAX_DECODED_FONT_BYTES + 1)
  await assert.rejects(decodeWoff2Font(oversized), /30 MiB/)
  const badCompressedSize = source.slice()
  new DataView(badCompressedSize.buffer).setUint32(20, source.length)
  await assert.rejects(decodeWoff2Font(badCompressedSize), /不完整/)
  // A small advisory header cannot bypass the per-table allocation limits.
  const excessiveTable = new Uint8Array(55), header = new DataView(excessiveTable.buffer)
  header.setUint32(0, 0x774f4632)
  header.setUint32(4, 0x00010000)
  header.setUint32(8, excessiveTable.length)
  header.setUint16(12, 1)
  header.setUint32(16, 16)
  header.setUint32(20, 1)
  excessiveTable.set([0, 0x8f, 0x80, 0x80, 0x01], 48) // cmap length = 30 MiB + 1
  await assert.rejects(decodeWoff2Font(excessiveTable), /30 MiB/)
})

test('rejects damaged compressed data and continues to decode valid fonts', async () => {
  const damaged = Uint8Array.from(await font('Inter'))
  damaged.fill(0, 48)
  await assert.rejects(decodeWoff2Font(damaged), /无法解码|解压后|目录/)
  const sources = await Promise.all(['Inter', 'SourceSansPro', 'Inter', 'SourceSansPro'].map(font))
  const decoded = await Promise.all(sources.map(decodeWoff2Font))
  decoded.forEach(buffer => tablesOf(buffer))
  assert.deepEqual(new Uint8Array(decoded[0]), new Uint8Array(decoded[2]))
  assert.deepEqual(new Uint8Array(decoded[1]), new Uint8Array(decoded[3]))
})
