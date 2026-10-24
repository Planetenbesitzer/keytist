/* eslint-env node, es2022 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-html-font-capture-test-'))
const server = await createServer({ configFile: false, cacheDir: cache, logLevel: 'error', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false } })
const originalParser = globalThis.DOMParser
// Only attribute access is needed by snapshotting; browser rendering/measurement
// remains a separate real-browser gate, never simulated by this fixture.
class AttributeParser {
  parseFromString(source) {
    const nodes = [...source.matchAll(/<(meta|link|base)\b([^>]*)>/gi)].map(([, tag, raw]) => {
      const attrs = Object.fromEntries([...raw.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(([, name, double, single, plain]) => [name.toLowerCase(), (double ?? single ?? plain).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")]))
      return { tag: tag.toLowerCase(), getAttribute: name => attrs[name] ?? null }
    })
    return { querySelectorAll: selector => nodes.filter(node => node.tag === selector), querySelector: selector => nodes.find(node => node.tag === selector.replace('[href]', '')) || null }
  }
}
globalThis.DOMParser = AttributeParser
after(async () => {
  globalThis.DOMParser = originalParser
  try {
    await server.close()
  }
  finally {
    await fs.rm(cache, { recursive: true, force: true })
  }
})
const { assertPortableFontCsp, absolutizePortableCssUrls, snapshotPortableHtmlCss, injectPortableFontStyles } = await server.ssrLoadModule('/src/utils/htmlFontCapture.ts')

test('font-style injection finds actual head markup while preserving scripts, comments and CSS strings', () => {
  const script = 'const marker="</head>";const template="<head><style>font:16px serif</style></head>";'
  const source = '<!doctype html><html><head><!-- </head> --><script>' + script + '</script><style>.x::after{content:"</head>"}</style></head><body>ok</body></html>'
  const result = injectPortableFontStyles(source, '@font-face{font-family:Packed}', {})
  assert.equal(result.match(/<script>([\s\S]*?)<\/script>/)[1], script)
  assert.ok(result.includes('<style>.x::after{content:"</head>"}</style><style data-slide-studio-fonts>'))
  assert.equal(result.replace(/<style data-slide-studio-fonts>[\s\S]*?<\/style>/, ''), source)
  const fragment = '<!doctype html><script>const x="<head>"</script><p>fragment</p>'
  assert.ok(injectPortableFontStyles(fragment, '', {}).startsWith('<!doctype html><style data-slide-studio-fonts>'))
})

test('CSP accepts permitted embedded fonts/styles and rejects effective blocking directives without weakening them', () => {
  for (const policies of [[], ["script-src 'none'"], ["default-src 'self';font-src data:;style-src 'unsafe-inline'"], ["default-src 'none';font-src data:;style-src 'none';style-src-elem 'unsafe-inline'"], ['upgrade-insecure-requests']]) assert.doesNotThrow(() => assertPortableFontCsp(policies, 3))
  for (const policy of ["default-src 'self'", "font-src *;style-src 'unsafe-inline'", "font-src data:;style-src 'self'", "font-src data:;style-src 'unsafe-inline' 'nonce-abc'", "font-src data:;style-src 'unsafe-inline' 'sha256-abc'", "font-src data:;style-src 'unsafe-inline';style-src-elem 'none'"]) assert.throws(() => assertPortableFontCsp([policy], 3), /第 3 页.*CSP/)
  assert.throws(() => assertPortableFontCsp(["font-src data:;style-src 'unsafe-inline'", "font-src 'none'"], 2), /第 2 页/)
})

test('CSS URLs resolve against their own stylesheet, preserving literals and local SVG references', () => {
  const css = '/*url(ignore)*/p{background:image-set(url(../image.png) 1x,url("image2.png") 2x);content:"url(unchanged)";filter:url(#shadow)}@font-face{src:url("../font.woff2")} '
  const result = absolutizePortableCssUrls(css, 'https://example.test/css/theme.css')
  assert.equal(result, '/*url(ignore)*/p{background:image-set(url("https://example.test/image.png") 1x,url("https://example.test/css/image2.png") 2x);content:"url(unchanged)";filter:url(#shadow)}@font-face{src:url("https://example.test/font.woff2")} ')
})

test('snapshots linked stylesheets in position and expands imports with layer, supports and media order intact', async () => {
  const calls = []
  const files = new Map([
    ['https://cdn.test/css/main.css', '@import "nested/fonts.css" layer(theme) supports(display:grid) screen and (min-width:1px);body{font-family:system-ui;background:url(../bg.png)}'],
    ['https://cdn.test/css/nested/fonts.css', '@font-face{font-family:Remote;src:url(../../fonts/face.woff2)}.nested{font-family:Remote}'],
  ])
  const script = 'const fake="<link rel=stylesheet href=bad.css><style>font-family:serif</style>";'
  const source = '<!doctype html><html><head><style>.before{color:red}</style><link id="theme" rel="stylesheet" media="screen" href="https://cdn.test/css/main.css"><script>' + script + '</script><style>.after{font-family:serif}</style></head></html>'
  const result = await snapshotPortableHtmlCss(source, 'https://local.test/editor/', 1, url => {
    calls.push(url); return Promise.resolve(new Response(files.get(url), { status: files.has(url) ? 200 : 404 }))
  })
  assert.deepEqual(calls, [...files.keys()])
  assert.ok(result.includes('<style id="theme" rel="stylesheet" media="screen" href="https://cdn.test/css/main.css">@layer theme{@supports (display:grid){@media screen and (min-width:1px){@font-face'))
  assert.ok(result.includes('url("https://cdn.test/fonts/face.woff2")'))
  assert.ok(result.includes('url("https://cdn.test/bg.png")'))
  assert.equal(result.match(/<script>([\s\S]*?)<\/script>/)[1], script)
  assert.ok(result.indexOf('.before') < result.indexOf('.nested') && result.indexOf('.nested') < result.indexOf('.after'))
})

test('uses HTML base URL, terminates import cycles and rejects unreadable CSS with a page-specific error', async () => {
  const source = '<head><base href="https://cdn.test/assets/"><link rel="stylesheet" href="main.css"></head>'
  const calls = []
  const result = await snapshotPortableHtmlCss(source, 'https://local.test/', 4, url => {
    calls.push(url); return Promise.resolve(new Response('@import "main.css";.x{font-family:serif}'))
  })
  assert.deepEqual(calls, ['https://cdn.test/assets/main.css'])
  assert.ok(result.includes('.x{font-family:serif}'))
  await assert.rejects(snapshotPortableHtmlCss(source, 'https://local.test/', 4, () => Promise.reject(new TypeError('CORS blocked'))), /第 4 页.*跨域.*未导出/)
})

test('measurement stays transparent without inheriting visibility:hidden and retains permitted CSP', async () => {
  const source = await fs.readFile(new URL('../../src/utils/htmlFontCapture.ts', import.meta.url), 'utf8')
  assert.match(source, /opacity:0;pointer-events:none/)
  assert.doesNotMatch(source, /frame\.style\.cssText\s*=.*visibility:hidden/)
  assert.match(source, /!== 'content-security-policy'\) node\.remove\(\)/)
})
