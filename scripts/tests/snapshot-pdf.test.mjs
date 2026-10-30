/* eslint-env node, es2022 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['src/utils/snapshotPdf.ts'], absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)), bundle: true, write: false, platform: 'node', format: 'esm' })
const { buildSnapshotPdf, createSnapshotPdf, SNAPSHOT_PDF_MAX_DIMENSION, SNAPSHOT_PDF_MAX_PIXELS, SNAPSHOT_PDF_MAX_FRAMES } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const options = { width: 960, height: 540, margin: 0, count: 1 }
const rgbPage = (color = [255, 0, 0], width = 16, height = 9) => ({ width, height, rgb: Uint8Array.from({ length: width * height * 3 }, (_, index) => color[index % 3]) })
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII='

const parsePdf = async blob => {
  assert.equal(blob.type, 'application/pdf')
  const bytes = Buffer.from(await blob.arrayBuffer()), source = bytes.toString('latin1')
  assert.equal(source.slice(0, 9), '%PDF-1.4\n')
  assert.ok(source.endsWith('%%EOF\n'))
  const startxref = Number(source.match(/startxref\n(\d+)\n%%EOF\n$/)[1])
  assert.equal(source.slice(startxref, startxref + 5), 'xref\n')
  const table = source.slice(startxref).split('\n'), size = Number(table[1].split(' ')[1])
  assert.equal(table[2], '0000000000 65535 f ')
  const offsets = []
  for (let id = 1; id < size; id++) {
    assert.match(table[id + 2], /^\d{10} 00000 n $/)
    const offset = Number(table[id + 2].slice(0, 10))
    assert.equal(source.slice(offset, offset + `${id} 0 obj\n`.length), `${id} 0 obj\n`, `object ${id} must start at its exact binary xref offset`)
    offsets[id] = offset
  }
  assert.match(source.slice(startxref), new RegExp(`trailer\\n<< /Size ${size} /Root 1 0 R >>`))
  const object = id => {
    const end = Math.min(...offsets.filter(offset => offset > offsets[id]), startxref)
    return source.slice(offsets[id], end)
  }
  const stream = id => {
    const text = object(id), offset = text.indexOf('\nstream\n')
    const length = Number(text.slice(0, offset).match(/\/Length (\d+)/)[1])
    const start = offsets[id] + offset + '\nstream\n'.length
    const data = bytes.subarray(start, start + length)
    assert.match(source.slice(start + length), /^\n?endstream\nendobj\n/)
    return data
  }
  return { bytes, source, object, stream, size }
}

test('image PDF has exact binary xref offsets, RGB samples and no fonts or executable content', async () => {
  const page = rgbPage([17, 128, 241])
  const pdf = await parsePdf(await buildSnapshotPdf([page], options))
  assert.match(pdf.object(1), /\/Type \/Catalog \/Pages 2 0 R/)
  assert.match(pdf.object(2), /\/Type \/Pages \/Count 1 \/Kids \[5 0 R\]/)
  assert.match(pdf.object(3), /\/Subtype \/Image \/Width 16 \/Height 9 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8/)
  assert.match(pdf.object(3), /\/Filter \/FlateDecode/)
  assert.deepEqual(inflateSync(pdf.stream(3)), Buffer.from(page.rgb))
  assert.match(pdf.object(5), /\/MediaBox \[0 0 720 405\]/)
  assert.doesNotMatch(pdf.source, /\/Font\b|\/JavaScript\b|\/OpenAction\b|\/EmbeddedFile\b|\/URI\b/)
})

test('one, two and three frames per page retain order, margins and an unfilled final sheet', async () => {
  const frames = Array.from({ length: 7 }, (_, index) => rgbPage([index * 30, 0, 255]))
  for (const count of [1, 2, 3]) {
    const pdf = await parsePdf(await buildSnapshotPdf(frames, { ...options, count, margin: 50 }))
    const pageCount = Math.ceil(frames.length / count)
    assert.match(pdf.object(2), new RegExp(`/Count ${pageCount} /Kids`))
    for (let index = 0; index < frames.length; index++) assert.deepEqual(inflateSync(pdf.stream(index + 3)), Buffer.from(frames[index].rgb))
    for (let page = 0; page < pageCount; page++) {
      const contentId = 3 + frames.length + page, pageId = 3 + frames.length + pageCount + page
      const content = pdf.stream(contentId).toString('ascii')
      assert.match(pdf.object(pageId), new RegExp(`/MediaBox \\[0 0 795 ${405 * count + 75}\\]`))
      assert.ok(content.startsWith(`1 1 1 rg\n0 0 795 ${405 * count + 75} re f\n`))
      const expected = frames.slice(page * count, (page + 1) * count).map((_, offset) => page * count + offset + 1)
      assert.deepEqual([...content.matchAll(/\/Im(\d+) Do/g)].map(match => Number(match[1])), expected)
      for (let slot = 0; slot < expected.length; slot++) {
        const y = 37.5 + (count - slot - 1) * 405
        assert.ok(content.includes(`720 0 0 405 37.5 ${y} cm\n/Im${expected[slot]} Do`))
      }
    }
  }
})

test('different image aspect ratios are centered without stretching or cropping', async () => {
  const pdf = await parsePdf(await buildSnapshotPdf([rgbPage([1, 2, 3], 4, 4)], options))
  assert.match(pdf.stream(4).toString('ascii'), /405 0 0 405 157\.5 0 cm/)
})

test('compression includes only a typed-array view and reports sequential progress', async () => {
  const allocation = new Uint8Array(20).fill(0xa5)
  const view = allocation.subarray(7, 13)
  view.set([255, 0, 0, 0, 0, 255])
  const progress = []
  const pdf = await parsePdf(await buildSnapshotPdf([{ width: 2, height: 1, rgb: view }, rgbPage()], { ...options, onProgress: (completed, total) => progress.push([completed, total]) }))
  assert.deepEqual(inflateSync(pdf.stream(3)), Buffer.from([255, 0, 0, 0, 0, 255]))
  assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]])
  assert.deepEqual([...allocation.subarray(0, 7)], Array(7).fill(0xa5))
})

test('invalid page counts, dimensions, excessive media boxes and malformed RGB fail before writing', async () => {
  await assert.rejects(buildSnapshotPdf([], options), /先加入冻结画面/)
  await assert.rejects(buildSnapshotPdf(Array(SNAPSHOT_PDF_MAX_FRAMES + 1).fill(rgbPage()), options), /最多导出/)
  for (const invalid of [{ width: 0 }, { height: NaN }, { margin: -1 }, { count: 0 }, { count: 4 }, { width: 30000 }]) {
    await assert.rejects(buildSnapshotPdf([rgbPage()], { ...options, ...invalid }), /页面尺寸|每页数量|留白/)
  }
  for (const invalid of [{ width: SNAPSHOT_PDF_MAX_DIMENSION + 1, height: 1 }, { width: 8192, height: 4097 }, { width: 1.5, height: 1 }]) {
    await assert.rejects(buildSnapshotPdf([{ ...invalid, rgb: new Uint8Array(3) }], options), /尺寸无效或过大/)
  }
  assert.equal(SNAPSHOT_PDF_MAX_PIXELS, 32 * 1024 * 1024)
  await assert.rejects(buildSnapshotPdf([{ width: 2, height: 2, rgb: new Uint8Array(3) }], options), /RGB 图像数据无效/)
})

test('public PNG input rejects wrong MIME, bad signatures, corrupt encoding and mismatched dimensions before decoding', async () => {
  for (const dataUrl of ['https://example.test/frame.png', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,???=', 'data:image/png;base64,' + Buffer.alloc(33).toString('base64')]) {
    await assert.rejects(createSnapshotPdf([{ dataUrl, width: 1, height: 1 }], options), /PNG/)
  }
  await assert.rejects(createSnapshotPdf([{ dataUrl: png, width: 2, height: 1 }], options), /实际尺寸与记录不一致/)
})

test('browser PNG conversion paints an opaque white base, removes alpha samples and releases its canvas', async t => {
  const previousDocument = globalThis.document, calls = []
  const image = { naturalWidth: 1, naturalHeight: 1, src: '', decode: () => Promise.resolve() }
  const context = {
    fillStyle: '',
    fillRect() {
      calls.push(['fill', this.fillStyle])
    },
    drawImage(input) {
      assert.equal(input, image); calls.push(['draw'])
    },
    getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  globalThis.document = { createElement: tag => tag === 'img' ? image : canvas }
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  })
  const pdf = await parsePdf(await createSnapshotPdf([{ dataUrl: png, width: 1, height: 1 }], options))
  assert.deepEqual(calls, [['fill', '#fff'], ['draw']])
  assert.deepEqual(inflateSync(pdf.stream(3)), Buffer.from([255, 255, 255]))
  assert.equal(image.src, '')
  assert.equal(canvas.width, 1)
  assert.equal(canvas.height, 1)
})

test('a failed browser image decode still releases the image and canvas without creating a partial PDF', async t => {
  const previousDocument = globalThis.document
  const image = { src: '', decode: () => Promise.reject(new Error('Invalid PNG')) }
  const canvas = { width: 99, height: 99 }
  globalThis.document = { createElement: tag => tag === 'img' ? image : canvas }
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  })
  await assert.rejects(createSnapshotPdf([{ dataUrl: png, width: 1, height: 1 }], options), /载入失败/)
  assert.equal(image.src, '')
  assert.equal(canvas.width, 1)
  assert.equal(canvas.height, 1)
})
