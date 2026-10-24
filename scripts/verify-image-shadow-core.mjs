import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = path.join(root, `.image-shadow-core-${process.pid}.mjs`)
const results = []
const test = (name, operation) => {
  operation(); results.push({ name, passed: true }) 
}
try {
  const source = await fs.readFile(path.join(root, 'src/utils/imageShadow.ts'), 'utf8')
  await fs.writeFile(temporary, (await transform(source, { loader: 'ts', format: 'esm', target: 'es2020' })).code)
  const { normalizeImageShadow, getImageShadowKind, createImageShadowAsset } = await import(temporary)
  const base = { h: 0, v: 8, blur: 10, color: 'rgba(0,0,0,0.18)' }
  test('Legacy and explicit drop shadows keep their existing renderer and data', () => {
    assert.deepEqual(normalizeImageShadow(base), base)
    assert.equal(getImageShadowKind(base), 'drop')
    assert.equal(getImageShadowKind(), 'drop')
    assert.equal(createImageShadowAsset(base, 400, 250), null)
    assert.equal(createImageShadowAsset(undefined, 400, 250), null)
  })
  test('Invalid legacy fields and geometry ranges reject without mutating input', () => {
    const variants = [null, [], {}, { ...base, h: NaN }, { ...base, v: Infinity }, { ...base, blur: -1 }, { ...base, color: 'not-a-color' }, { ...base, type: 'unknown' }, { ...base, type: ['drop'] }, { ...base, perspective: -0.01 }, { ...base, perspective: 1.01 }, { ...base, curve: -1.01 }, { ...base, curve: 1.01 }, { ...base, curve: NaN }]
    for (const value of variants) {
      const before = structuredClone(value)
      assert.throws(() => normalizeImageShadow(value))
      assert.deepEqual(value, before)
    }
    for (const perspective of [0, 1]) normalizeImageShadow({ ...base, type: 'contact', perspective })
    for (const curve of [-1, 0, 1]) normalizeImageShadow({ ...base, type: 'curved', curve })
  })
  test('Rendering defaults match explicit perspective and curve without rewriting JSON', () => {
    const contact = { ...base, type: 'contact' }
    const curved = { ...base, type: 'curved' }
    assert.deepEqual(createImageShadowAsset(contact, 400, 250), createImageShadowAsset({ ...contact, perspective: 0.35 }, 400, 250))
    assert.deepEqual(createImageShadowAsset(curved, 400, 250), createImageShadowAsset({ ...curved, curve: 0.65 }, 400, 250))
    assert.equal(normalizeImageShadow(contact).perspective, undefined)
    assert.equal(normalizeImageShadow(curved).curve, undefined)
  })
  test('h/v move advanced assets exactly once without changing their extents', () => {
    for (const type of ['contact', 'curved']) {
      const original = createImageShadowAsset({ ...base, h: 0, v: 0, type }, 400, 250)
      const moved = createImageShadowAsset({ ...base, h: 13, v: -9, type }, 400, 250)
      assert.equal(moved.left - original.left, 13)
      assert.equal(moved.top - original.top, -9)
      assert.equal(moved.width, original.width)
      assert.equal(moved.height, original.height)
    }
  })
  test('Contact perspective changes projection thickness; curved sign changes concavity', () => {
    const thin = createImageShadowAsset({ ...base, type: 'contact', perspective: 0 }, 400, 250)
    const thick = createImageShadowAsset({ ...base, type: 'contact', perspective: 1 }, 400, 250)
    assert.ok(thick.height > thin.height && thick.width > thin.width)
    const pathNumbers = curve => {
      const asset = createImageShadowAsset({ ...base, type: 'curved', curve }, 400, 250)
      const svg = decodeURIComponent(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1))
      return { asset, points: svg.match(/<path d="([^"]+)/)[1].match(/-?[\d.]+/g).map(Number) }
    }
    for (const curve of [-1, -0.8, 0, 0.8, 1]) {
      const { asset, points: [left, top, right, edge, middle, control, endX, endY] } = pathNumbers(curve)
      const depth = Math.abs(curve) * Math.min(400 * 0.12, 250 * 0.25)
      assert.equal(middle, 200)
      assert.equal(left, endX)
      assert.equal(edge, endY)
      assert.ok(top <= edge && right > left)
      assert.ok((edge + control) / 2 >= top, 'Quadratic bottom crosses the strip top')
      assert.equal((edge + control) / 2, curve >= 0 ? 258 : 258 + depth)
      assert.equal(edge, curve >= 0 ? 258 + depth : 258)
      assert.ok(asset.top >= 258 - Math.max(depth, base.blur, 1) - 43, 'Curved asset still reaches the image top')
    }
  })
  test('SVG assets are self-contained, preserve alpha, and include four-sigma padding', () => {
    for (const type of ['contact', 'curved']) {
      const asset = createImageShadowAsset({ ...base, type }, 400, 250)
      const svg = decodeURIComponent(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1))
      assert.match(svg, /stdDeviation="10"/)
      assert.match(svg, /fill-opacity="0.18"/)
      assert.match(svg, /mask="url\(#shadow-frame-knockout\)"/)
      assert.match(svg, /<rect x="0" y="0" width="400" height="250" fill="black"\/>/)
      assert.doesNotMatch(svg, /(?:href|foreignObject|script|\bNaN\b|\bInfinity\b)/i)
      assert.ok(asset.left < 0 && asset.height > 84)
      assert.ok(Number.isFinite(asset.left + asset.top + asset.width + asset.height))
    }
    assert.throws(() => createImageShadowAsset({ ...base, type: 'contact' }, 0, 100))
    assert.throws(() => createImageShadowAsset({ ...base, type: 'curved' }, 100, Infinity))
  })
  await fs.mkdir(path.join(root, 'verification'), { recursive: true })
  for (const type of ['contact', 'curved']) {
    const asset = createImageShadowAsset({ ...base, type }, 400, 250)
    await fs.writeFile(path.join(root, `verification/shadow-core-${type}.svg`), decodeURIComponent(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1)))
  }
  await fs.writeFile(path.join(root, 'verification/shadow-core-geometry-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), passed: true, tests: results, scope: 'Validation and deterministic SVG geometry. Apple shadowPath supplies the ellipse and concave-path construction; normalized perspective/curve formulas are this editor design.' }, null, 2) + '\n')
  process.stdout.write(`Image shadow core: ${results.length} focused checks passed.\n`)
}
finally {
  await fs.rm(temporary, { force: true }) 
}
