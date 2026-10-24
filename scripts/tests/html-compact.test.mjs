/* eslint-env node, es2020 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { randomBytes } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createServer } from 'vite'

const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-html-compact-test-'))
const server = await createServer({
  configFile: false, cacheDir: cacheDirectory, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true, hmr: false },
})
after(async () => {
  try {
    await server.close()
  }
  finally {
    await fs.rm(cacheDirectory, { recursive: true, force: true })
  }
})
const { packHtmlPresentation, unpackCompactHtml, decodeCompactHtmlManifest, COMPACT_HTML_MAX_BYTES } = await server.ssrLoadModule('/src/utils/htmlCompact.ts')
const options = { editable: false, title: '中文标题 <& "safe"' }
const extractManifest = source => JSON.parse(source.match(/<script id="slide-studio-compact" type="application\/json">([\s\S]*?)<\/script>/)[1])
const decodePayload = manifest => JSON.parse(gunzipSync(Buffer.from(manifest.payload, 'base64')).toString('utf8'))
const makeManifest = (payload, extra = {}) => ({ version: 1, encoding: 'gzip-base64', editable: false, payload: gzipSync(JSON.stringify(payload)).toString('base64'), ...extra })
const wrap = manifest => `<script type="application/json" id="slide-studio-compact">${JSON.stringify(manifest)}</script>`

test('exact roundtrip preserves Unicode, every quote, SVG, CSS and executable demo source', async () => {
  const html = '<!doctype html>\r\n<html><style>.x{color:#123;background:url("data:image/png;base64,aGVsbG8=")}</style><body>中文 😀 é\u2028\u2029 &amp; \' " <svg><path d="M0 0"/></svg><img src=\'data:image/png;base64,aGVsbG8=\'><script>window.demo = "<tag>"; /* no import execution */</script></body></html>\n'
  const packed = await packHtmlPresentation(html, options)
  assert.equal(await unpackCompactHtml(packed), html)
  assert.equal(extractManifest(packed).editable, false)
  assert.ok(packed.includes('<title>中文标题 &lt;&amp; &quot;safe&quot;</title>'))
  assert.equal(packed.includes('https://'), false)
  assert.equal(packed.includes('http://'), false)
  assert.equal(COMPACT_HTML_MAX_BYTES, 512 * 1024 * 1024)
})

test('deduplicates repeated data URLs once and never rewrites the dictionary', async () => {
  const image = `data:image/png;base64,${Buffer.from('image-resource-'.repeat(2000)).toString('base64')}`
  const font = `data:font/woff2;charset=utf-8;base64,${Buffer.from('font-resource-'.repeat(1000)).toString('base64')}`
  const html = `<style>@font-face{src:url('${font}')}p{background:url(${image})}</style>${`<img src="${image}"><span data-font='${font}'>中文</span>`.repeat(30)}`
  const packed = await packHtmlPresentation(html, options)
  const decoded = decodePayload(extractManifest(packed))
  assert.deepEqual(decoded.resources, [font, image])
  assert.equal(decoded.html.includes(image), false)
  assert.equal(decoded.html.includes(font), false)
  assert.equal((decoded.html.match(/SS_RESOURCE_/g) || []).length, 62)
  assert.ok(Buffer.byteLength(packed) < Buffer.byteLength(html) / 20)
  assert.equal(await unpackCompactHtml(packed), html)
})

test('resource tokens cannot collide with any literal content already in the HTML', async () => {
  const html = '\u0000SS_RESOURCE_0_0\u0000 中文 \u0000SS_RESOURCE_1_' + '<img src="data:image/png;base64,AAAA">'.repeat(2)
  const packed = await packHtmlPresentation(html, { ...options, editable: true })
  const manifest = extractManifest(packed)
  assert.equal(manifest.editable, true)
  assert.equal(decodePayload(manifest).token, '\u0000SS_RESOURCE_2_')
  assert.equal(await unpackCompactHtml(packed), html)
})

test('a repeated 2 MiB incompressible asset roundtrips without regexp stack exhaustion', async () => {
  const resource = `data:image/png;base64,${randomBytes(2 * 1024 * 1024).toString('base64')}`
  const html = '<!doctype html><body>' + `<img src="${resource}">`.repeat(8) + '</body>'
  const packed = await packHtmlPresentation(html, options)
  assert.ok(extractManifest(packed).payload.length > 2 * 1024 * 1024)
  assert.ok(packed.length < html.length / 4)
  assert.equal(await unpackCompactHtml(packed), html)
})

test('ordinary HTML is not interpreted as a wrapper and importing never executes scripts', async () => {
  globalThis.__slideStudioCompactExecuted = false
  const source = '<html><body>slide-studio-compact<script>globalThis.__slideStudioCompactExecuted=true</script></body></html>'
  assert.equal(await unpackCompactHtml(source), undefined)
  const packed = await packHtmlPresentation(source, options)
  assert.equal(await unpackCompactHtml(packed), source)
  assert.equal(globalThis.__slideStudioCompactExecuted, false)
  delete globalThis.__slideStudioCompactExecuted
})

test('the emitted self-contained loader restores directly into the document without an iframe', async () => {
  const html = '<!doctype html><html><body>独立打开<script>window.demo=42</script></body></html>'
  const packed = await packHtmlPresentation(html, options)
  const manifestText = JSON.stringify(extractManifest(packed))
  const loader = [...packed.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1]
  const calls = []
  const status = { textContent: '' }
  const document = {
    getElementById(id) {
      return id === 'slide-studio-compact' ? { textContent: manifestText } : status
    },
    open() {
      calls.push('open')
    },
    write(value) {
      calls.push(value)
    },
    close() {
      calls.push('close')
    },
  }
  await vm.runInNewContext(loader, { document, Blob, TextDecoder, Uint8Array, DecompressionStream, atob, Error })
  assert.deepEqual(calls, ['open', html, 'close'])
  assert.equal(packed.includes('<iframe'), false)
  assert.equal(status.textContent, '')
})

test('known malformed headers and duplicate manifests fail explicitly', async () => {
  const manifest = makeManifest({ html: '<html>ok</html>', token: '\u0000SS_RESOURCE_0_', resources: [] })
  await assert.rejects(unpackCompactHtml('<script id="slide-studio-compact" type="application/json">{'), /文件头缺失或不完整/)
  await assert.rejects(unpackCompactHtml('<script id="slide-studio-compact" type="application/json">bad</script>'), /JSON 损坏/)
  await assert.rejects(unpackCompactHtml(wrap(manifest) + wrap(manifest)), /重复/)
  await assert.rejects(unpackCompactHtml(wrap(manifest).replace('application/json', 'text/javascript')), /类型无效/)
  await assert.rejects(unpackCompactHtml(wrap({ ...manifest, version: 2 })), /版本/)
  await assert.rejects(unpackCompactHtml(wrap({ ...manifest, encoding: 'plain' })), /编码/)
  await assert.rejects(unpackCompactHtml(wrap({ ...manifest, editable: 'yes' })), /字段无效/)
  await assert.rejects(unpackCompactHtml(wrap({ ...manifest, other: 1 })), /文件头格式/)
})

test('the standalone loader also displays malformed manifest JSON instead of remaining at loading', async () => {
  const packed = await packHtmlPresentation('<html>ok</html>', options)
  const loader = [...packed.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1]
  const status = { textContent: '' }
  const document = {
    getElementById(id) {
      return id === 'slide-studio-compact' ? { textContent: '{broken' } : status
    },
  }
  await vm.runInNewContext(loader, { document, Error })
  assert.match(status.textContent, /无法打开此文稿/)
  assert.equal(document.title, '文稿打开失败')
})

test('truncated, corrupted, non-base64, malformed UTF-8 and non-JSON gzip data are rejected', async () => {
  const manifest = makeManifest({ html: '<html>ok</html>', token: '\u0000SS_RESOURCE_0_', resources: [] })
  const bytes = Buffer.from(manifest.payload, 'base64')
  bytes[bytes.length - 5] ^= 1
  for (const payload of [manifest.payload.slice(0, -4), bytes.toString('base64'), 'not base64!', '']) {
    await assert.rejects(unpackCompactHtml(wrap({ ...manifest, payload })), /损坏|无效|不完整/)
  }
  await assert.rejects(unpackCompactHtml(wrap({ ...manifest, payload: gzipSync(Buffer.from([0xff, 0xfe])).toString('base64') })), /损坏/)
  await assert.rejects(unpackCompactHtml(wrap({ ...manifest, payload: gzipSync('not JSON').toString('base64') })), /损坏/)
})

test('resource schema, missing references and nested substitution tricks are rejected', async () => {
  const base = { html: '\u0000SS_RESOURCE_0_0\u0000', token: '\u0000SS_RESOURCE_0_', resources: ['data:image/png;base64,AAAA'] }
  for (const payload of [
    { ...base, html: '\u0000SS_RESOURCE_0_1\u0000' },
    { ...base, html: '\u0000SS_RESOURCE_0_00\u0000' },
    { ...base, html: '\u0000SS_RESOURCE_0_missing' },
    { ...base, token: 'unsafe' },
    { ...base, resources: ['<script>bad()</script>'] },
    { ...base, resources: [null] },
    { ...base, resources: ['data:image/png;base64,AAAA\u0000SS_RESOURCE_0_0\u0000'] },
    { ...base, extra: true },
  ]) await assert.rejects(decodeCompactHtmlManifest(makeManifest(payload)), /资源|格式/)
})

test('streaming decompression and resource expansion are independently bounded', async () => {
  const limit = 32768
  const giantJson = makeManifest({ html: 'a'.repeat(limit * 20), token: '\u0000SS_RESOURCE_0_', resources: [] })
  await assert.rejects(decodeCompactHtmlManifest(giantJson, limit), /解压后内容超过读取上限/)
  const expansion = makeManifest({ html: '\u0000SS_RESOURCE_0_0\u0000'.repeat(100), token: '\u0000SS_RESOURCE_0_', resources: [`data:image/png;base64,${'A'.repeat(4096)}`] })
  await assert.rejects(decodeCompactHtmlManifest(expansion, limit), /资源还原后内容超过读取上限/)
  await assert.rejects(decodeCompactHtmlManifest(giantJson, 0), /无效的读取上限/)
})

test('unsupported browser APIs produce a readable failure instead of a huge fallback file', async () => {
  const previous = globalThis.CompressionStream
  try {
    globalThis.CompressionStream = undefined
    await assert.rejects(packHtmlPresentation('<html>ok</html>', options), /不支持紧凑 HTML 导出/)
  }
  finally {
    globalThis.CompressionStream = previous
  }
  const html = '<html>ok</html>'
  const packed = await packHtmlPresentation(html, options)
  const loader = [...packed.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1]
  const status = { textContent: '' }
  const document = {
    getElementById(id) {
      return id === 'slide-studio-compact' ? { textContent: JSON.stringify(extractManifest(packed)) } : status
    },
  }
  await vm.runInNewContext(loader, { document, Error, DecompressionStream: undefined })
  assert.match(status.textContent, /此浏览器不支持本地解压/)
  assert.equal(document.title, '文稿打开失败')
})

test('English and Chinese standalone loading failures follow the selected UI language', async () => {
  for (const [language, opening, title, prefix] of [
    ['en', 'Opening presentation…', 'Unable to open presentation', 'Unable to open presentation: '],
    ['zh-CN', '正在打开演示文稿…', '文稿打开失败', '无法打开此文稿：'],
  ]) {
    const html = '<html><body>Document words 保留原文</body></html>'
    const packed = await packHtmlPresentation(html, { ...options, language })
    assert.ok(packed.includes(`<html lang="${language}">`))
    assert.ok(packed.includes(opening))
    assert.equal(await decodeCompactHtmlManifest(extractManifest(packed)), html)
    const loader = [...packed.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1]
    const status = { textContent: '' }
    const document = { getElementById: id => id === 'slide-studio-compact' ? { textContent: '{invalid JSON' } : status }
    await vm.runInNewContext(loader, { document, Error })
    assert.ok(status.textContent.startsWith(prefix))
    assert.equal(document.title, title)
  }
})
