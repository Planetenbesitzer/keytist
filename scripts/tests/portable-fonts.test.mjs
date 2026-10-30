/* eslint-env node, es2022 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createDingbatFontSources, generateLocalFontCatalog } from '../font-catalog.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({ entryPoints: ['src/utils/portableFonts.ts'], absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' })
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const { parseFontFamilies, normalizeFontFamily, parseCssUnicodeRange, replacePortableFontFamilies, extractSfntFace, readFontCoverage, readFontEmbeddingType, assertFontEmbeddingAllowed, hasFontCodePoint, findMatchingFontFace, sfntToWoff, preparePortableFonts, isExcludedCjkCodePoint, isCjkFontSource } = api

const align = value => (value + 3) & ~3
const makeFont = (ranges = [[0x20, 0x7E]], fsType = 0, unicodeFormat = 12) => {
  const head = new Uint8Array(54), os2 = new Uint8Array(96)
  new DataView(os2.buffer).setUint16(8, fsType)
  let subtable
  if (unicodeFormat === 12) {
    subtable = new Uint8Array(16 + ranges.length * 12)
    const view = new DataView(subtable.buffer)
    view.setUint16(0, 12); view.setUint32(4, subtable.length); view.setUint32(12, ranges.length)
    ranges.forEach(([start, end, glyph = 1], index) => {
      const at = 16 + index * 12; view.setUint32(at, start); view.setUint32(at + 4, end); view.setUint32(at + 8, glyph)
    })
  }
  else {
    // One ordinary segment with an idDelta and a 0xFFFF terminator.
    subtable = new Uint8Array(32)
    const view = new DataView(subtable.buffer)
    view.setUint16(0, 4); view.setUint16(2, 32); view.setUint16(6, 4)
    view.setUint16(14, ranges[0][1]); view.setUint16(16, 0xFFFF)
    view.setUint16(20, ranges[0][0]); view.setUint16(22, 0xFFFF)
    view.setInt16(24, 1 - ranges[0][0]); view.setInt16(26, 1)
  }
  const cmap = new Uint8Array(12 + subtable.length), cmapView = new DataView(cmap.buffer)
  cmapView.setUint16(2, 1); cmapView.setUint16(4, 3); cmapView.setUint16(6, unicodeFormat === 12 ? 10 : 1); cmapView.setUint32(8, 12); cmap.set(subtable, 12)
  const tables = [['OS/2', os2], ['cmap', cmap], ['head', head]]
  const bytes = new Uint8Array(60 + tables.reduce((sum, [, data]) => sum + align(data.length), 0)), view = new DataView(bytes.buffer)
  view.setUint32(0, 0x10000); view.setUint16(4, tables.length)
  let offset = 60
  tables.forEach(([tag, data], index) => {
    const at = 12 + index * 16
    bytes.set(Buffer.from(tag), at); view.setUint32(at + 8, offset); view.setUint32(at + 12, data.length); bytes.set(data, offset); offset += align(data.length)
  })
  return extractSfntFace(bytes)
}
const makeCollection = (...fonts) => {
  const header = align(12 + fonts.length * 4), size = header + fonts.reduce((sum, font) => sum + align(font.length), 0)
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer)
  bytes.set(Buffer.from('ttcf')); view.setUint32(4, 0x10000); view.setUint32(8, fonts.length)
  let offset = header
  fonts.forEach((font, index) => {
    view.setUint32(12 + index * 4, offset); bytes.set(font, offset)
    const count = new DataView(font.buffer, font.byteOffset, font.byteLength).getUint16(4)
    for (let table = 0; table < count; table++) {
      const at = offset + 12 + table * 16 + 8; view.setUint32(at, view.getUint32(at) + offset)
    }
    offset += align(font.length)
  })
  return bytes
}
const dataUrl = bytes => `data:font/ttf;base64,${Buffer.from(bytes).toString('base64')}`
const fontSource = (family, bytes, extra = {}) => ({ family, url: dataUrl(bytes), weight: 400, style: 'normal', ...extra })
const fakeCatalog = faces => ({ version: 1, faces, defaultFallbacks: [] })
const generatedCatalog = async (t, faces) => {
  const directory = await mkdtemp(join(tmpdir(), 'slide-studio-symbol-fallback-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const files = faces.map(face => ({ url: face.url, faces: [{ ...face, fsType: 0, coverage: { complete: true, ranges: readFontCoverage(Buffer.from(face.url.split(',')[1], 'base64')) } }] }))
  return { ...await generateLocalFontCatalog({ distDirectory: directory, fontDirectories: [] }), faces: [...createDingbatFontSources(files), ...faces] }
}

test('CSS font stacks retain quoted commas and escaped names', () => {
  assert.deepEqual(parseFontFamilies('"A, B", Helvetica Neue, serif'), ['A, B', 'Helvetica Neue', 'serif'])
  assert.deepEqual(parseFontFamilies('"A\\" B",Arial'), ['A" B', 'Arial'])
  assert.equal(normalizeFontFamily('"Helvetica Neue"'), 'helvetica neue')
  assert.equal(normalizeFontFamily('Apple\\20 Chancery'), 'apple chancery')
  assert.deepEqual(parseCssUnicodeRange('U+4??, U+1F600-1F64F'), [[0x400, 0x4FF], [0x1F600, 0x1F64F]])
})

test('TTC extraction selects the requested face and fixes the SFNT checksum', () => {
  const collection = makeCollection(makeFont([[65, 90]]), makeFont([[0x4E00, 0x4E02]], 8))
  const extracted = extractSfntFace(collection, 1)
  assert.deepEqual(readFontCoverage(extracted), [[0x4E00, 0x4E02]])
  assert.equal(readFontEmbeddingType(extracted), 8)
  let sum = 0
  const view = new DataView(extracted.buffer)
  for (let at = 0; at < extracted.length; at += 4) sum = (sum + view.getUint32(at)) >>> 0
  assert.equal(sum, 0xB1B0AFBA)
  assert.throws(() => extractSfntFace(collection, 2), /索引/)
})

test('cmap formats 4 and 12 check glyph IDs instead of broad Unicode blocks', () => {
  assert.deepEqual(readFontCoverage(makeFont([[65, 67]], 0, 4)), [[65, 67]])
  const ranges = readFontCoverage(makeFont([[65, 67, 0], [0x1F600, 0x1F602]]))
  assert.deepEqual(ranges, [[66, 67], [0x1F600, 0x1F602]])
  assert.equal(hasFontCodePoint(ranges, 65), false)
  assert.equal(hasFontCodePoint(ranges, 0x1F601), true)
  assert.equal(hasFontCodePoint(ranges, 0x4E00), false)
})

test('embedding restrictions are enforced; full-face no-subsetting remains allowed', () => {
  assert.throws(() => assertFontEmbeddingAllowed(2, 'Restricted'), /禁止嵌入/)
  assert.throws(() => assertFontEmbeddingAllowed(0x200), /位图/)
  assert.throws(() => assertFontEmbeddingAllowed(4, 'Preview only', true), /预览或打印/)
  assert.doesNotThrow(() => assertFontEmbeddingAllowed(4, 'Preview only', false))
  assert.doesNotThrow(() => assertFontEmbeddingAllowed(0x100))
  assert.doesNotThrow(() => assertFontEmbeddingAllowed(8, 'Editable', true))
})

test('face matching distinguishes weight/style, aliases, and variable ranges', () => {
  const sources = [
    { family: 'A', url: '/regular', weight: 400 },
    { family: 'A', url: '/bold', weight: 700 },
    { family: 'A', url: '/italic', weight: 400, style: 'italic' },
    { family: 'V', families: ['Variable Alias'], url: '/variable', weight: '100 900' },
  ]
  assert.equal(findMatchingFontFace(sources, 'A', 'bold').url, '/bold')
  assert.equal(findMatchingFontFace(sources, 'A', 400, 'italic').url, '/italic')
  assert.equal(findMatchingFontFace(sources, 'variable alias', 850).url, '/variable')
})

test('SFNT converts to compressed WOFF without losing coverage or permissions', async () => {
  const original = makeFont([[32, 126]], 8), woff = await sfntToWoff(original)
  assert.equal(Buffer.from(woff.subarray(0, 4)).toString(), 'wOFF')
  const result = await preparePortableFonts({}, [], { usages: [{ family: 'Fixture', text: 'Hello' }], catalog: fakeCatalog([fontSource('Fixture', woff)]) })
  assert.equal(result.report.faces.length, 1)
  assert.equal(result.report.faces[0].sourceFamily, 'Fixture')
  assert.match(result.css, /data:font\/woff;base64,/)
})

test('offline preparation embeds regular, bold, italic as distinct faces and deduplicates resources', async () => {
  const regular = makeFont(), bold = makeFont([[32, 127]]), italic = makeFont([[32, 128]])
  const result = await preparePortableFonts({}, [], {
    catalog: fakeCatalog([fontSource('A', regular), fontSource('A', bold, { weight: 700 }), fontSource('A', italic, { style: 'italic' })]),
    usages: [{ family: 'A', text: 'regular' }, { family: 'A', text: 'bold', weight: 700 }, { family: 'A', text: 'italic', style: 'italic' }, { family: 'A', text: 'again' }],
    warningTotalBytes: 1,
  })
  assert.equal(result.report.faces.length, 3)
  assert.equal(result.report.totalBytes, result.report.faces.reduce((sum, face) => sum + face.bytes, 0))
  assert.match(result.css, /font-weight:700/)
  assert.match(result.css, /font-style:italic/)
  assert.match(result.report.warnings.join(' '), /字体包合计/)
})

test('CJK text stays unchanged without downloading an extra Chinese fallback font', async () => {
  const catalog = fakeCatalog([fontSource('Helvetica Neue', makeFont()), fontSource('SourceHanSans', makeFont([[0x4E00, 0x9FFF]]))])
  catalog.defaultFallbacks = ['SourceHanSans']
  const usage = { family: 'Helvetica Neue', text: 'Hello 中文' }, requests = []
  const result = await preparePortableFonts({}, [], { catalog, usages: [usage], fetcher: (...args) => {
    requests.push(args[0]); return fetch(...args)
  } })
  assert.equal(result.report.faces.length, 1)
  assert.equal(result.report.faces[0].family, 'Helvetica Neue')
  assert.equal(result.report.excludedCjkCharacters, 2)
  assert.equal(result.report.coveragePolicy, 'latin-and-math')
  assert.equal(usage.text, 'Hello 中文')
  assert.deepEqual(requests, [catalog.faces[0].url])
  assert.doesNotMatch(result.css, /U\+4e00-9fff/)
})

test('Google-style unicode subset faces are combined, respecting their unicode-range declarations', async () => {
  const bytes = makeFont([[32, 126], [0x400, 0x4FF]])
  const sources = [fontSource('Subset', bytes, { unicodeRange: 'U+20-7E' }), fontSource('Subset', bytes, { unicodeRange: 'U+400-4FF' })]
  const result = await preparePortableFonts({}, [], { catalog: fakeCatalog([]), sources, usages: [{ family: 'Subset', text: 'aЖ' }] })
  assert.equal(result.report.faces.length, 1)
  assert.match(result.css, /U\+20-7e,U\+400-4ff/)
})

test('missing fonts/glyphs and forbidden fonts fail with actionable errors', async () => {
  await assert.rejects(preparePortableFonts({}, [], { catalog: fakeCatalog([]), usages: [{ family: 'Absent', text: 'text' }] }), /找不到.*Absent/)
  await assert.rejects(preparePortableFonts({}, [], { catalog: fakeCatalog([fontSource('Latin', makeFont())]), usages: [{ family: 'Latin', text: 'Ψ' }] }), /缺少字符.*U\+3A8/)
  await assert.rejects(preparePortableFonts({}, [], { catalog: fakeCatalog([fontSource('Restricted', makeFont([[32, 126]], 2))]), usages: [{ family: 'Restricted', text: 'text' }] }), /禁止嵌入/)
})

test('CJK classification excludes Chinese, Japanese, Korean, and fullwidth punctuation while retaining physics symbols', () => {
  for (const character of ['中', 'あ', 'ア', '한', 'ㄅ', '，', '。', '𠀀']) assert.equal(isExcludedCjkCodePoint(character.codePointAt(0)), true, character)
  for (const character of ['A', 'é', 'α', 'Ψ', '∑', '→', '𝛼']) assert.equal(isExcludedCjkCodePoint(character.codePointAt(0)), false, character)
  assert.equal(isCjkFontSource({ family: 'Apple Chancery' }), false)
  assert.equal(isCjkFontSource({ family: 'Arial' }), false)
  assert.equal(isCjkFontSource({ family: 'SourceHanSans' }), false)
  assert.equal(isCjkFontSource({ family: 'aliasFoo', coverage: [[0x4E00, 0x9FFF]] }), true)
  assert.equal(isCjkFontSource({ family: 'Arial Unicode MS', coverage: [[0x4E00, 0x9FFF]] }), true)
  assert.equal(isCjkFontSource({ family: 'SourceHandwriting', coverage: [[32, 126]] }), false)
  assert.equal(isCjkFontSource({ family: 'SourceHanSans', coverage: [[32, 126]] }), false)
  assert.equal(isCjkFontSource({ family: 'Exactly 256 Han', coverage: [[0x4E00, 0x4EFF]] }), true)
  assert.equal(isCjkFontSource({ family: 'Only 255 Han', coverage: [[0x4E00, 0x4EFE]] }), false)
})

test('Chinese-only text does not fetch any font or fail for a missing font', async () => {
  let reads = 0
  const result = await preparePortableFonts({}, [], { catalog: fakeCatalog([]), usages: [{ family: 'Not installed', text: '中文 文稿，。' }], fetcher: () => {
    reads++; return Promise.reject(new Error('unexpected download'))
  } })
  assert.equal(reads, 0)
  assert.equal(result.report.totalBytes, 0)
  assert.equal(result.css, '')
  assert.ok(result.report.excludedCjkCharacters > 0)
})

test('a CJK primary font is skipped with an explicit unlocked-English warning, including renamed fonts', async () => {
  for (const source of [fontSource('SourceHanSans', makeFont([[0x4E00, 0x9FFF]]), { coverage: [[0x4E00, 0x9FFF]] }), fontSource('aliasFoo', makeFont([[0x4E00, 0x9FFF]]), { coverage: [[0x4E00, 0x9FFF]] })]) {
    let reads = 0
    const result = await preparePortableFonts({}, [], { catalog: fakeCatalog([source]), usages: [{ family: source.family, text: 'English 中文' }], fetcher: () => {
      reads++; return Promise.reject(new Error('unexpected CJK download'))
    } })
    assert.equal(reads, 0)
    assert.equal(result.report.totalBytes, 0)
    assert.match(result.report.warnings.join(' '), /英文也未锁定/)
    assert.equal(result.css, '')
  }
})

test('pure Latin imported fonts with CJK-looking names still embed using their actual cmap', async () => {
  for (const family of ['SourceHandwriting', 'SourceHanSans']) {
    const result = await preparePortableFonts({}, [], { catalog: fakeCatalog([fontSource(family, makeFont())]), usages: [{ family, text: 'English ABC' }] })
    assert.equal(result.report.faces.length, 1)
    assert.equal(result.report.faces[0].sourceFamily, family)
    assert.ok(result.report.totalBytes > 0)
    assert.equal(result.report.warnings.length, 0)
  }
})

test('an unknown renamed large CJK font is identified by its actual cmap and never duplicated into font CSS', async () => {
  const source = fontSource('Anonymous', makeFont([[32, 126], [0x4E00, 0x9FFF]]), { preserve: true, scope: 'web' })
  const result = await preparePortableFonts({}, [], { catalog: fakeCatalog([]), sources: [source], usages: [{ family: 'Anonymous', text: 'English 中文', scope: 'web' }] })
  assert.equal(result.report.totalBytes, 0)
  assert.equal(result.report.faces.length, 0)
  assert.equal(result.cssByScope.web, '')
  assert.match(result.report.warnings.join(' '), /大型中文字库/)
})

test('Greek and mathematical symbols still receive a bundled non-CJK fallback', async () => {
  const catalog = fakeCatalog([fontSource('Latin', makeFont()), fontSource('Apple Symbols', makeFont([[0x3A8, 0x3A8], [0x2211, 0x2211]]))])
  const result = await preparePortableFonts({}, [], { catalog, usages: [{ family: 'Latin', text: 'English Ψ∑' }] })
  assert.equal(result.report.faces.length, 2)
  assert.equal(result.report.faces[1].sourceFamily, 'Apple Symbols')
  assert.equal(result.report.excludedCjkCharacters, 0)
  assert.match(result.css, /U\+3a8/)
})

test('generated fallback policy embeds Arial dingbats in regular, bold and italic text', async t => {
  const arrow = [[0x27A2, 0x27A2]], faces = []
  for (const [weight, style] of [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']]) {
    faces.push(fontSource('Arial', makeFont([[32, 126], [weight, weight]]), { weight, style }))
    faces.push(fontSource('Menlo', makeFont(style === 'normal' ? [[32, 126], ...arrow, [weight, weight]] : [[32, 126], [weight + 1, weight + 1]]), {
      weight, style,
    }))
  }
  faces.push(fontSource('Apple Symbols', makeFont([[0x3A8, 0x3A8]])))
  const catalog = await generatedCatalog(t, faces)
  for (const [weight, style] of [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']]) {
    const usage = { family: 'Arial', text: 'Arial ➢', weight, style }
    const result = await preparePortableFonts({}, [], { catalog, usages: [usage] })
    assert.equal(result.report.faces.length, 2)
    assert.equal(result.report.faces[0].sourceFamily, 'Arial')
    assert.equal(result.report.faces[0].weight, weight)
    assert.equal(result.report.faces[0].style, style)
    assert.equal(result.report.faces[1].sourceFamily, 'Menlo (symbols)')
    assert.match(result.css, /unicode-range:[^;}]*U\+27a2[,;]/)
    assert.equal(usage.text, 'Arial ➢')
  }
})

test('generated symbol fallbacks work with Windows and Linux families without Menlo', async t => {
  for (const family of ['Segoe UI Symbol', 'Noto Sans Symbols 2', 'DejaVu Sans']) {
    const catalog = await generatedCatalog(t, [fontSource('Arial', makeFont()), fontSource(family, makeFont([[0x27A2, 0x27A2]]))])
    const result = await preparePortableFonts({}, [], { catalog, usages: [{ family: 'Arial', text: 'Text ➢' }] })
    assert.deepEqual(result.report.faces.map(face => face.sourceFamily), ['Arial', `${family} (symbols)`])
  }
})

test('a primary font covering the symbol does not fetch supplementary fonts', async t => {
  const primary = fontSource('Arial', makeFont([[32, 126], [0x27A2, 0x27A2]]))
  const catalog = await generatedCatalog(t, [primary, fontSource('Menlo', makeFont([[0x27A2, 0x27A2]]))])
  const requests = []
  const result = await preparePortableFonts({}, [], { catalog, usages: [{ family: 'Arial', text: 'Text ➢' }], fetcher: (...args) => {
    requests.push(args[0]); return fetch(...args)
  } })
  assert.equal(result.report.faces.length, 1)
  assert.deepEqual(requests, [primary.url])
})

test('generated symbol fallbacks still reject a genuinely unavailable glyph', async t => {
  const catalog = await generatedCatalog(t, [fontSource('Arial', makeFont()), fontSource('Menlo', makeFont()), fontSource('.LastResort', makeFont([[0x27A2, 0x27A2]]))])
  await assert.rejects(preparePortableFonts({}, [], { catalog, usages: [{ family: 'Arial', text: 'Text ➢' }] }), /缺少字符.*U\+27A2/)
})

test('dingbat descriptors do not shadow a native symbol-family font used for ordinary italic text', async t => {
  const italic = fontSource('Menlo', makeFont(), { style: 'italic' })
  const catalog = await generatedCatalog(t, [fontSource('Menlo', makeFont([[32, 126], [0x27A2, 0x27A2]])), italic])
  const requests = []
  const result = await preparePortableFonts({}, [], { catalog, usages: [{ family: 'Menlo', text: 'Italic text', style: 'italic' }], fetcher: (...args) => {
    requests.push(args[0]); return fetch(...args)
  } })
  assert.deepEqual(result.report.faces.map(face => [face.sourceFamily, face.style]), [['Menlo', 'italic']])
  assert.deepEqual(requests, [italic.url])
})

test('generic families receive explicit aliases that can replace CSS keywords', async () => {
  const result = await preparePortableFonts({}, [], { catalog: fakeCatalog([fontSource('Arial', makeFont())]), usages: [{ family: 'sans-serif', text: 'Hello' }] })
  assert.equal(result.report.faces[0].family, 'SlideStudioPortable-sans-serif')
  assert.match(result.css, /font-family:"SlideStudioPortable-sans-serif"/)
  assert.equal(replacePortableFontFamilies('sans-serif, "Times New Roman"', result.familyAliases), '"SlideStudioPortable-sans-serif", "Times New Roman"')
})

test('separate iframe scopes keep same-name fonts independent and share only identical resources', async () => {
  const one = makeFont([[65, 90]]), two = makeFont([[97, 122]])
  const result = await preparePortableFonts({}, [], {
    catalog: fakeCatalog([fontSource('Shared', makeFont())]),
    sources: [fontSource('Shared', one, { scope: 'page1' }), fontSource('Shared', two, { scope: 'page2' })],
    usages: [{ family: 'Shared', text: 'ABC', scope: 'page1' }, { family: 'Shared', text: 'abc', scope: 'page2' }],
  })
  assert.equal(result.css, '')
  assert.match(result.cssByScope.page1, /U\+41-5a/)
  assert.doesNotMatch(result.cssByScope.page1, /U\+61-7a/)
  assert.match(result.cssByScope.page2, /U\+61-7a/)
  assert.equal(result.report.faces.length, 2)
  assert.notEqual(result.cssByScope.page1, result.cssByScope.page2)
})

test('explicit iframe font declarations can be preserved for JS-generated text', async () => {
  const result = await preparePortableFonts({}, [], { catalog: fakeCatalog([]), sources: [fontSource('Dynamic', makeFont(), { scope: 'dynamic-page', preserve: true })] })
  assert.equal(result.css, '')
  assert.match(result.cssByScope['dynamic-page'], /font-family:"Dynamic"/)
  assert.equal(result.report.faces.length, 1)
})

test('catalog files schema resolves alternate system family names and TTC face indices', async () => {
  const collection = makeCollection(makeFont([[65, 90]]), makeFont([[97, 122]]))
  const catalog = { version: 1, defaultFallbacks: [], files: [{ url: dataUrl(collection), faces: [{ family: 'System A', families: ['Alias A'], faceIndex: 1, weight: 400, style: 'normal', fsType: 0, coverage: { complete: true, ranges: [[97, 122]] } }] }] }
  const result = await preparePortableFonts({}, [], { catalog, usages: [{ family: 'Alias A', text: 'abc' }] })
  assert.equal(result.report.faces[0].sourceFamily, 'System A')
  assert.equal(result.report.faces[0].family, 'Alias A')
})

test('actual Helvetica Neue TTC parses and compresses on macOS without copying it into test artifacts', async context => {
  let bytes
  try {
    bytes = new Uint8Array(await readFile('/System/Library/Fonts/HelveticaNeue.ttc'))
  }
  catch {
    context.skip('macOS font is not present'); return
  }
  const extracted = extractSfntFace(bytes, 0), coverage = readFontCoverage(extracted), packed = await sfntToWoff(extracted)
  assert.equal(hasFontCodePoint(coverage, 65), true)
  assert.equal(readFontEmbeddingType(extracted), 0)
  assert.ok(packed.length < extracted.length)
})
