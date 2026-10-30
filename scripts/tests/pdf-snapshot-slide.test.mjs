/* eslint-env node, es2022 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({ entryPoints: ['src/utils/pdfSnapshotSlide.ts'], absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' })
const { getPdfSnapshotPlacement, createPdfSnapshotSlide } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const slide = (html = {}) => ({ id: 'slide', elements: [], html: { source: '<p>Interactive page</p>', ...html } })
const png = (width, height) => {
  const bytes = Buffer.alloc(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12)
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20)
  return `data:image/png;base64,${bytes.toString('base64')}`
}

test('matching viewports retain the screenshot density without adding a letterbox or changing placement', () => {
  const placement = getPdfSnapshotPlacement(slide(), { width: 960, height: 540 }, { width: 1920, height: 1080 })
  assert.deepEqual(placement.draw, { left: 0, top: 0, width: 960, height: 540 })
  assert.deepEqual(placement.image, { left: 0, top: 0, width: 960, height: 540 })
  assert.deepEqual([placement.canvasWidth, placement.canvasHeight], [1920, 1080])
})

test('a 4:3 source is letterboxed before the entire clipped webpage layer is moved and scaled', () => {
  const input = slide({ width: 800, height: 600, left: -150.25, top: 80.5, scale: 0.375 })
  const before = JSON.stringify(input)
  const placement = getPdfSnapshotPlacement(input, { width: 1000, height: 562.5 }, { width: 1600, height: 1200 })
  assert.equal(placement.fit, 0.9375)
  assert.deepEqual(placement.draw, { left: 125, top: 0, width: 750, height: 562.5 })
  assert.deepEqual(placement.image, { left: -150.25, top: 80.5, width: 375, height: 210.9375 })
  assert.deepEqual([placement.canvasWidth, placement.canvasHeight], [2133, 1200])
  assert.equal(JSON.stringify(input), before)
})

test('wide webpage viewports receive vertical letterboxing and raster allocation stays bounded', () => {
  const placement = getPdfSnapshotPlacement(slide({ width: 2000, height: 500 }), { width: 1000, height: 1000 }, { width: 8000, height: 2000 })
  assert.deepEqual(placement.draw, { left: 0, top: 375, width: 1000, height: 250 })
  assert.ok(placement.canvasWidth <= 8192 && placement.canvasHeight <= 8192)
  assert.ok(placement.canvasWidth * placement.canvasHeight <= 32 * 1024 * 1024)
  assert.ok(placement.canvasWidth > 5000)
})

test('invalid input geometry and oversized screenshots fail before canvas allocation', () => {
  const size = { width: 960, height: 540 }, snapshot = { width: 1920, height: 1080 }
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => getPdfSnapshotPlacement(slide(), { ...size, width: value }, snapshot))
    assert.throws(() => getPdfSnapshotPlacement(slide({ height: value }), size, snapshot))
  }
  for (const value of [0, -1, 10.1, Infinity, NaN]) assert.throws(() => getPdfSnapshotPlacement(slide({ scale: value }), size, snapshot))
  for (const value of [0, -1, 1.5, 8193, Infinity]) assert.throws(() => getPdfSnapshotPlacement(slide(), size, { ...snapshot, width: value }))
  assert.throws(() => getPdfSnapshotPlacement(slide(), size, { width: 8192, height: 8192 }))
  assert.throws(() => getPdfSnapshotPlacement({ id: 'native', elements: [] }, size, snapshot))
  assert.throws(() => getPdfSnapshotPlacement(slide(), { width: Number.MIN_VALUE, height: Number.MIN_VALUE }, snapshot))
})

const browser = (t, { width = 1600, height = 1200, decodeError, canvasFailure = false } = {}) => {
  const previous = globalThis.document, calls = [], images = [], canvases = []
  globalThis.document = {
    createElement(tag) {
      if (tag === 'img') {
        const image = { src: '', naturalWidth: width, naturalHeight: height, decode: () => decodeError ? Promise.reject(decodeError) : Promise.resolve() }
        images.push(image); return image
      }
      if (tag !== 'canvas') throw new Error(`Unexpected element ${tag}`)
      const canvas = {
        width: 0, height: 0,
        getContext: () => canvasFailure ? null : {
          scale: (...args) => calls.push(['scale', ...args]),
          drawImage: (_image, ...args) => calls.push(['draw', ...args]),
          set imageSmoothingQuality(value) {
            calls.push(['quality', value])
          },
        },
        toDataURL: () => {
          calls.push(['encode', canvas.width, canvas.height]); return png(canvas.width, canvas.height)
        },
      }
      canvases.push(canvas); return canvas
    },
  }
  t.after(() => {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous
  })
  return { calls, images, canvases }
}

test('a detached frozen slide preserves its background, unknown metadata and native overlay order', async t => {
  const env = browser(t)
  const input = {
    ...slide({ width: 800, height: 600, left: -120, top: 15, scale: 0.5 }),
    background: { type: 'solid', color: '#fafafa' }, extension: { retained: true },
    elements: [
      { id: 'title', type: 'text', content: '<p>Native title</p>' },
      { id: 'video', type: 'video', autoplay: true },
      { id: 'shape', type: 'shape', path: 'M0 0L1 1' },
      { id: 'audio', type: 'audio', autoplay: true },
    ],
  }
  const before = JSON.stringify(input)
  const frozen = await createPdfSnapshotSlide(input, { dataUrl: png(1600, 1200), width: 1600, height: 1200 }, { width: 1000, height: 562.5 })
  assert.equal(JSON.stringify(input), before)
  assert.equal(frozen.html, undefined)
  assert.deepEqual(frozen.background, input.background)
  assert.deepEqual(frozen.extension, input.extension)
  assert.deepEqual(frozen.elements.slice(1), [input.elements[0], input.elements[2]])
  assert.notEqual(frozen.elements[1], input.elements[0])
  assert.deepEqual(Object.fromEntries(['type', 'left', 'top', 'width', 'height', 'rotate', 'fixedRatio'].map(key => [key, frozen.elements[0][key]])), {
    type: 'image', left: -120, top: 15, width: 500, height: 281.25, rotate: 0, fixedRatio: true,
  })
  assert.ok(frozen.elements[0].id.startsWith('pdf-snapshot-'))
  assert.ok(!input.elements.some(element => element.id === frozen.elements[0].id))
  assert.deepEqual(env.calls.find(call => call[0] === 'draw'), ['draw', 125, 0, 750, 562.5])
  assert.ok(!env.calls.some(call => call[0] === 'fill'))
  assert.deepEqual(env.canvases.map(canvas => [canvas.width, canvas.height]), [[0, 0]])
  assert.equal(env.images[0].src, '')
})

test('PNG dimensions and signature are checked before decoding untrusted screenshot data', async t => {
  const env = browser(t)
  const input = slide(), size = { width: 800, height: 600 }
  for (const dataUrl of ['https://example.com/image.png', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,not-png', png(8193, 100), png(800, 601)]) {
    await assert.rejects(createPdfSnapshotSlide(input, { dataUrl, width: 800, height: 600 }, size), /PNG/)
  }
  assert.equal(env.images.length, 0)
  assert.equal(env.canvases.length, 0)
})

test('decode failures keep the original slide intact and release temporary pixels', async t => {
  const env = browser(t, { decodeError: new Error('Invalid PNG pixels') })
  const input = slide(), before = JSON.stringify(input)
  await assert.rejects(createPdfSnapshotSlide(input, { dataUrl: png(1600, 1200), width: 1600, height: 1200 }, { width: 800, height: 600 }), /Invalid PNG pixels/)
  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(env.canvases.map(canvas => [canvas.width, canvas.height]), [[0, 0]])
  assert.equal(env.images[0].src, '')
})

test('an unavailable canvas context releases temporary pixels without returning a blank slide', async t => {
  const env = browser(t, { canvasFailure: true })
  await assert.rejects(createPdfSnapshotSlide(slide(), { dataUrl: png(1600, 1200), width: 1600, height: 1200 }, { width: 800, height: 600 }), /无法准备网页冻结画面/)
  assert.deepEqual(env.canvases.map(canvas => [canvas.width, canvas.height]), [[0, 0]])
  assert.equal(env.images[0].src, '')
})

test('a PNG whose decoded size differs from its header is refused', async t => {
  const env = browser(t, { width: 800, height: 600 })
  await assert.rejects(createPdfSnapshotSlide(slide(), { dataUrl: png(1600, 1200), width: 1600, height: 1200 }, { width: 800, height: 600 }), /图片尺寸无效/)
  assert.deepEqual(env.canvases.map(canvas => [canvas.width, canvas.height]), [[0, 0]])
})
