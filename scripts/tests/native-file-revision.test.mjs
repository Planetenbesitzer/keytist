/* eslint-env node, es2022 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['src/utils/nativeFileRevision.ts'], absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)), bundle: true, write: false, platform: 'node', format: 'esm' })
const { getNativeFileRevision, assertNativeFileUnchanged } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const hash = value => createHash('sha256').update(value).digest('hex')

test('hashes strings and file bytes with real SHA-256, including Unicode and line endings', async () => {
  assert.equal(await getNativeFileRevision('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  for (const contents of ['', 'Title\r\nα➢😀', '{"title":"A"}\n']) {
    const revision = await getNativeFileRevision(contents)
    assert.equal(revision, hash(contents))
    assert.equal(await getNativeFileRevision(new File([contents], 'document.json')), revision)
  }
})

test('keeps BOM, whitespace and non-text bytes in the revision instead of normalizing through text()', async () => {
  const raw = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63, 0xff])
  const file = new File([raw], 'document.json')
  assert.equal(await getNativeFileRevision(file), hash(raw))
  assert.notEqual(await getNativeFileRevision(file), await getNativeFileRevision(await file.text()))
  assert.notEqual(await getNativeFileRevision('{"a":1}'), await getNativeFileRevision('{ "a": 1 }'))
})

test('an unchanged file succeeds without writes or mutation of the caller baseline', async () => {
  const file = new File(['original'], 'document.json', { lastModified: 123 })
  const baseline = await getNativeFileRevision(file)
  let reads = 0
  const handle = { getFile: () => {
    reads++; return Promise.resolve(file)
  } }
  assert.equal(await assertNativeFileUnchanged(handle, baseline), undefined)
  assert.equal(reads, 1)
  assert.equal(await file.text(), 'original')
  assert.equal(await assertNativeFileUnchanged(handle, baseline.toUpperCase()), undefined)
})

test('external edits with identical filename, size and modification time still conflict', async () => {
  const original = new File(['{"title":"A"}'], 'document.json', { lastModified: 123 })
  const external = new File(['{"title":"B"}'], 'document.json', { lastModified: 123 })
  assert.equal(original.size, external.size)
  assert.equal(original.lastModified, external.lastModified)
  const baseline = await getNativeFileRevision(original)
  await assert.rejects(assertNativeFileUnchanged({ getFile: () => Promise.resolve(external) }, baseline), {
    message: '文件已在外部修改或替换。请另存为新文件，避免覆盖。',
  })
  assert.equal(await external.text(), '{"title":"B"}')
})

test('unknown and malformed old baselines fail before reading the disk file', async () => {
  let reads = 0
  const handle = { getFile: () => {
    reads++; return Promise.resolve(new File(['new'], 'document.json'))
  } }
  for (const revision of [undefined, null, '', 'old-mtime', 'g'.repeat(64), 'a'.repeat(63)]) {
    await assert.rejects(assertNativeFileUnchanged(handle, revision), /无法确认原文件.*重新选择文件或另存为/)
  }
  assert.equal(reads, 0)
})

test('deleted or unreadable files cannot pass the revision guard', async () => {
  for (const cause of [new DOMException('Gone', 'NotFoundError'), new DOMException('Denied', 'NotAllowedError')]) {
    await assert.rejects(assertNativeFileUnchanged({ getFile: () => Promise.reject(cause) }, hash('old')), /无法读取原文件.*避免覆盖/)
  }
})

test('a Blob read failure is reported rather than treated as an empty or new baseline', async () => {
  class UnreadableFile extends File {
    arrayBuffer() {
      return Promise.reject(new Error('File became unreadable'))
    }
  }
  const file = new UnreadableFile(['original'], 'document.json')
  await assert.rejects(getNativeFileRevision(file), /无法读取原文件/)
  await assert.rejects(assertNativeFileUnchanged({ getFile: () => Promise.resolve(file) }, hash('original')), /无法读取原文件/)
})

test('an unavailable Web Crypto implementation blocks saving instead of bypassing the check', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
  try {
    await assert.rejects(getNativeFileRevision('data'), /不支持原文件修改检查/)
    await assert.rejects(assertNativeFileUnchanged({ getFile: () => Promise.resolve(new File(['data'], 'document.json')) }, hash('data')), /不支持原文件修改检查/)
  }
  finally {
    Object.defineProperty(globalThis, 'crypto', descriptor)
  }
})
