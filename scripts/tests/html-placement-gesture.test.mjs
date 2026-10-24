/* eslint-env node, es2020 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

const moduleUrl = async path => {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
}
const placementUrl = await moduleUrl('../../src/utils/htmlPlacement.ts')
const source = await readFile(new URL('../../src/utils/htmlPlacementGesture.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace("from './htmlPlacement'", `from '${placementUrl}'`)
const { moveHtmlPlacement, resizeHtmlPlacement } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const { HTML_MIN_SCALE, HTML_MAX_SCALE } = await import(placementUrl)

const tests = []
const check = (name, fn) => tests.push([name, fn])
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
const anchor = (placement, corner, width, height) => ({
  x: placement.left + (corner[1] === 'w' ? width * placement.scale : 0),
  y: placement.top + (corner[0] === 'n' ? height * placement.scale : 0),
})
const original = Object.freeze({ left: -13.123456789, top: 29.987654321, scale: 0.83 })

check('Movement uses slide deltas, preserves scale and accepts negative coordinates', () => {
  const changed = moveHtmlPlacement(original, -80.25, 45.125)
  close(changed.left, original.left - 80.25)
  close(changed.top, original.top + 45.125)
  assert.equal(changed.scale, original.scale)
  assert.deepEqual(original, { left: -13.123456789, top: 29.987654321, scale: 0.83 })
})
check('All four corners double uniformly and retain their opposite anchor', () => {
  const width = 1000, height = 562.5
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const dx = width * original.scale * (corner[1] === 'w' ? -1 : 1)
    const dy = height * original.scale * (corner[0] === 'n' ? -1 : 1)
    const changed = resizeHtmlPlacement(original, corner, dx, dy, width, height)
    close(changed.scale, original.scale * 2)
    const before = anchor(original, corner, width, height), after = anchor(changed, corner, width, height)
    close(after.x, before.x)
    close(after.y, before.y)
  }
})
check('Either pointer axis independently contributes its diagonal projection', () => {
  const origin = { left: 10, top: 20, scale: 1 }
  const horizontal = resizeHtmlPlacement(origin, 'se', 100, 0, 200, 100)
  const vertical = resizeHtmlPlacement(origin, 'se', 0, 50, 200, 100)
  close(horizontal.scale, 1.4)
  close(vertical.scale, 1.1)
  close(resizeHtmlPlacement(origin, 'nw', -100, 0, 200, 100).scale, horizontal.scale)
  close(resizeHtmlPlacement(origin, 'ne', 0, -50, 200, 100).scale, vertical.scale)
})
check('Minimum and maximum scale clamps retain the opposite corner', () => {
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const vx = 1000 * original.scale * (corner[1] === 'w' ? -1 : 1)
    const vy = 600 * original.scale * (corner[0] === 'n' ? -1 : 1)
    for (const [delta, expectedScale] of [[-100, HTML_MIN_SCALE], [100, HTML_MAX_SCALE]]) {
      const changed = resizeHtmlPlacement(original, corner, vx * delta, vy * delta, 1000, 600)
      assert.equal(changed.scale, expectedScale)
      const before = anchor(original, corner, 1000, 600), after = anchor(changed, corner, 1000, 600)
      close(after.x, before.x)
      close(after.y, before.y)
    }
  }
})
check('Zero movement and perpendicular projection do not round or rewrite original values', () => {
  const moved = moveHtmlPlacement(original, 0, -0)
  assert.deepEqual(moved, original)
  assert.notEqual(moved, original)
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    assert.deepEqual(resizeHtmlPlacement(original, corner, 0, 0, 1000, 600), original)
  }
  const precise = { left: 0.1234567891, top: 0.9876543219, scale: 0.1234567891 }
  assert.deepEqual(resizeHtmlPlacement(precise, 'se', 100, -200, 200, 100), precise)
})
check('Invalid inputs and overflowing geometry return an unchanged clone', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(moveHtmlPlacement(original, invalid, 1), original)
    assert.deepEqual(moveHtmlPlacement(original, 1, invalid), original)
    for (const args of [[invalid, 1, 1000, 600], [1, invalid, 1000, 600], [1, 1, invalid, 600], [1, 1, 1000, invalid]]) {
      assert.deepEqual(resizeHtmlPlacement(original, 'se', ...args), original)
    }
    for (const field of ['left', 'top', 'scale']) {
      const badOrigin = { ...original, [field]: invalid }
      assert.deepEqual(moveHtmlPlacement(badOrigin, 1, 1), badOrigin)
      assert.deepEqual(resizeHtmlPlacement(badOrigin, 'se', 1, 1, 1000, 600), badOrigin)
    }
  }
  for (const scale of [0, -1, HTML_MIN_SCALE / 2, HTML_MAX_SCALE + 1]) {
    const badOrigin = { ...original, scale }
    assert.deepEqual(resizeHtmlPlacement(badOrigin, 'se', 1, 1, 1000, 600), badOrigin)
  }
  for (const [width, height] of [[0, 600], [1000, 0], [-1, 600], [1000, -1]]) {
    assert.deepEqual(resizeHtmlPlacement(original, 'se', 1, 1, width, height), original)
  }
  assert.deepEqual(resizeHtmlPlacement(original, 'invalid', 1, 1, 1000, 600), original)
  const huge = { left: Number.MAX_VALUE, top: 0, scale: 1 }
  assert.deepEqual(moveHtmlPlacement(huge, Number.MAX_VALUE, 0), huge)
  const hugeScale = { left: 0, top: 0, scale: HTML_MAX_SCALE }
  assert.deepEqual(resizeHtmlPlacement(hugeScale, 'se', 1, 1, Number.MAX_VALUE, 1), hugeScale)
})
check('Repeated calls use the fixed gesture origin rather than accumulating drift', () => {
  const first = resizeHtmlPlacement(original, 'nw', -30, -20, 1000, 600)
  for (let index = 0; index < 100; index++) {
    assert.deepEqual(resizeHtmlPlacement(original, 'nw', -30, -20, 1000, 600), first)
  }
  const restored = moveHtmlPlacement(moveHtmlPlacement(original, 80, -50), -80, 50)
  close(restored.left, original.left)
  close(restored.top, original.top)
  assert.equal(restored.scale, original.scale)
})

for (const [name, fn] of tests) {
  fn()
  process.stdout.write(`PASS ${name}\n`)
}
process.stdout.write(`${tests.length} HTML placement gesture checks passed. No files were created.\n`)
