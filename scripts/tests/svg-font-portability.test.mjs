/* eslint-env node, es2022 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({ entryPoints: ['src/utils/svgFontPortability.ts'], absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm' })
const { assertPortableSvgImageFonts } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)

// The browser's existing DOMParser supplies these elements in production.
const element = (localName, text = '') => ({ localName, cloneNode: () => ({ textContent: text, querySelectorAll: () => [] }) })
const svg = children => ({ querySelectorAll: selector => children.filter(child => selector.split(',').includes(child.localName)) })

test('MathJax paths, images, and non-rendering SVG titles retain vector output', () => {
  assert.doesNotThrow(() => assertPortableSvgImageFonts(svg([element('path'), element('use'), element('image'), element('title', 'Formula x+y'), element('desc', 'Accessible description')])))
})

test('SVG text, tspan, and textPath resources fail before producing a font-dependent file', () => {
  for (const name of ['text', 'tspan', 'textPath']) assert.throws(() => assertPortableSvgImageFonts(svg([element(name, 'Physics αβ')])), /将文字转为轮廓.*文稿文本框/)
})

test('empty text nodes are harmless, while foreignObject is rejected even for generated text', () => {
  assert.doesNotThrow(() => assertPortableSvgImageFonts(svg([element('text', ' \n ')])))
  assert.throws(() => assertPortableSvgImageFonts(svg([element('foreignObject')])), /HTML 内容.*普通图片/)
})

test('metadata nested inside an otherwise empty SVG text element is ignored', () => {
  const text = { localName: 'text', cloneNode: () => {
    const copy = { textContent: 'accessible metadata', querySelectorAll: () => [{ remove: () => {
      copy.textContent = ''
    } }] }
    return copy
  } }
  assert.doesNotThrow(() => assertPortableSvgImageFonts(svg([text])))
})
