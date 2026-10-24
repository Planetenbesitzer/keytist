/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { compile } from 'sass'

const { fonts } = JSON.parse(await fs.readFile(new URL('../../src/configs/bundledFontMetadata.json', import.meta.url), 'utf8'))
const css = compile(fileURLToPath(new URL('../../src/assets/styles/font.scss', import.meta.url))).css
const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, block]) => Object.fromEntries(
  [...block.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, property, value]) => [property, value.trim()]),
))
const find = key => faces.find(face => face['font-family'].replace(/^['"]|['"]$/g, '') === key)

test('registers each bundled face with its actual static weight or variable range', () => {
  assert.equal(faces.length, fonts.length)
  for (const font of fonts) {
    const face = find(font.key)
    assert.ok(face, `${font.key} face is registered`)
    const axis = font.variable?.axes.find(candidate => candidate.tag === 'wght')
    const expected = axis ? `${axis.min} ${axis.max}` : String(font.weight)
    assert.equal(face['font-weight'], expected, `${font.key} matches actual font metadata`)
    assert.equal(/italic|oblique/.test(face['font-style']), font.style === 'italic', `${font.key} style matches actual font metadata`)
    assert.ok(face.src.includes(`${font.key}.woff2`))
  }
})

test('regular-only fonts are not advertised as supplying arbitrary bold or light weights', () => {
  for (const key of ['Inter', 'SourceSansPro', 'JetBrainsMono', 'SourceSerif4']) {
    assert.equal(find(key)['font-weight'], '400')
    assert.equal(find(key)['font-style'], 'normal')
  }
  for (const key of ['SourceHanSans', 'SourceHanSerif']) assert.equal(find(key)['font-weight'], '250 900')
})
