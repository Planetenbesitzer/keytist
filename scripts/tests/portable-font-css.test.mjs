/* eslint-env node, es2022 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const built = await build({ entryPoints: ['src/utils/portableFontCss.ts'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external' })
const { rewritePortableFontCss, rewritePortableHtmlFonts } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const aliases = { 'sans-serif': 'PortableSans', serif: 'PortableSerif', 'system-ui': 'PortableSystem', monospace: 'PortableMono' }

test('rewrites generic families, shorthand, custom properties and var fallbacks', () => {
  const css = ':root{--font:system-ui;--body-font:italic 700 16px/1.4 serif;--accent-color:serif}.x{font-family:Arial,sans-serif!important;font:italic 700 16px/1.4 system-ui, Arial}.y{font-family:var(--body-font, monospace);font:var(--font, 16px serif)}'
  const rewritten = rewritePortableFontCss(css, aliases)
  assert.equal(rewritten, ':root{--font:"PortableSystem";--body-font:italic 700 16px/1.4 "PortableSerif";--accent-color:serif}.x{font-family:Arial,"PortableSans"!important;font:italic 700 16px/1.4 "PortableSystem", Arial}.y{font-family:var(--body-font, "PortableMono");font:var(--font, 16px "PortableSerif")}' )
})

test('keeps named families, strings, comments, URLs and unrelated declarations byte-identical', () => {
  const css = '/*font-family:serif*/font:hover{content:"font-family:serif";background:url("data:text/plain,font-family:serif");--label:"system-ui";font-family:"serif", My sans-serif, /*keep*/system-ui/*after*/;color:serif}'
  const expected = css.replace('/*keep*/system-ui/*after*/', '/*keep*/"PortableSystem"/*after*/')
  assert.equal(rewritePortableFontCss(css, aliases), expected)
  assert.equal(rewritePortableFontCss(css, {}), css)
  assert.equal(rewritePortableFontCss(expected, aliases), expected, 'rewriting is idempotent')
})

test('handles nested rules, escaped keywords, stretch percentage and calc font sizes', () => {
  const css = '@media(min-width:10px){.a{font-family:system\\2d ui,serif}.b{font:75% 18px / 1.5 sans-serif}.c{font:italic calc(1em + 1vw)/1.4 monospace}}'
  const expected = '@media(min-width:10px){.a{font-family:"PortableSystem","PortableSerif"}.b{font:75% 18px / 1.5 "PortableSans"}.c{font:italic calc(1em + 1vw)/1.4 "PortableMono"}}'
  assert.equal(rewritePortableFontCss(css, aliases), expected)
})

test('follows font custom-property references without changing unrelated identifier values', () => {
  const css = ':root{--body:var(--sans);--sans:system-ui;--Key:serif;--key:monospace;--animation:serif}.a{font-family:var(--body)}.b{font:16px var(--Key)}'
  const expected = css.replace('--sans:system-ui', '--sans:"PortableSystem"').replace('--Key:serif', '--Key:"PortableSerif"')
  assert.equal(rewritePortableFontCss(css, aliases), expected)
})

test('rewrites only HTML style content and attributes while retaining executable script bytes', () => {
  const script = 'const template=`<style>.fake{font-family:serif}</style><div style="font-family:system-ui">x</div>`;window.demo="font:16px monospace";'
  const source = '<!doctype html>\r\n<html data-test="keep"><head><!-- <style>font-family:serif</style> --><style>.real{font:16px serif}</style><script data-x="same">' + script + '</script></head><body><p style="font-family:system-ui;color:red" onclick="demo(\'font-family:serif\')">Text</p><textarea><style>font-family:serif</style></textarea></body></html>'
  const expected = source.replace('.real{font:16px serif}', '.real{font:16px "PortableSerif"}').replace('style="font-family:system-ui;color:red"', 'style="font-family:&quot;PortableSystem&quot;;color:red"')
  const result = rewritePortableHtmlFonts(source, aliases)
  assert.equal(result, expected)
  assert.equal(result.match(/<script data-x="same">([\s\S]*?)<\/script>/)[1], script)
})

test('preserves attribute entities and escapes inserted aliases for every attribute quoting mode', () => {
  const source = '<p style="font-family:&quot;My Font&quot;,system-ui;background:url(a?x=1&amp;y=2)">x</p><p STYLE=\'font:italic 14px serif\'>y</p><i style=font-family:monospace>z</i><b style="font&#45;family:&#115;ystem-ui">q</b>'
  const expected = '<p style="font-family:&quot;My Font&quot;,&quot;PortableSystem&quot;;background:url(a?x=1&amp;y=2)">x</p><p STYLE=\'font:italic 14px "PortableSerif"\'>y</p><i style=font-family:&#34;PortableMono&#34;>z</i><b style="font&#45;family:&quot;PortableSystem&quot;">q</b>'
  assert.equal(rewritePortableHtmlFonts(source, aliases), expected)
})

test('does not mistake comments, raw-text, data attributes or plain less-than text for styles', () => {
  const source = '1 < 2 <p data-template="<style>p{font-family:serif}</style>" style="font-family:serif">x</p><![CDATA[<style>font-family:serif</style>]]><SCRIPT>const x="<STYLE>font:12px serif</STYLE>";</SCRIPT><style>p{font-family:sans-serif}</STYLE><title><style>font-family:serif</style></title>'
  const expected = source.replace('style="font-family:serif"', 'style="font-family:&quot;PortableSerif&quot;"').replace('<style>p{font-family:sans-serif}</STYLE>', '<style>p{font-family:"PortableSans"}</STYLE>')
  assert.equal(rewritePortableHtmlFonts(source, aliases), expected)
})
