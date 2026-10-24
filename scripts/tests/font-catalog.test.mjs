/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'
import { generateLocalFontCatalog, getDefaultFontDirectories, createLocalFontLink } from '../font-catalog.mjs'

function names(entries) {
  const encoded = entries.map(([id, text, language = 0x409]) => ({ id, language, text: Buffer.from(text, 'utf16le').swap16() }))
  const start = 6 + encoded.length * 12
  const output = Buffer.alloc(start + encoded.reduce((sum, item) => sum + item.text.length, 0))
  output.writeUInt16BE(encoded.length, 2)
  output.writeUInt16BE(start, 4)
  let textOffset = 0
  encoded.forEach((item, i) => {
    const offset = 6 + i * 12
    output.writeUInt16BE(3, offset)
    output.writeUInt16BE(1, offset + 2)
    output.writeUInt16BE(item.language, offset + 4)
    output.writeUInt16BE(item.id, offset + 6)
    output.writeUInt16BE(item.text.length, offset + 8)
    output.writeUInt16BE(textOffset, offset + 10)
    item.text.copy(output, start + textOffset)
    textOffset += item.text.length
  })
  return output
}

function cmap12(groups = [[0x41, 0x43, 0], [0x1f600, 0x1f601, 7]]) {
  const output = Buffer.alloc(12 + 16 + groups.length * 12)
  output.writeUInt16BE(1, 2)
  output.writeUInt16BE(3, 4)
  output.writeUInt16BE(10, 6)
  output.writeUInt32BE(12, 8)
  output.writeUInt16BE(12, 12)
  output.writeUInt32BE(output.length - 12, 16)
  output.writeUInt32BE(groups.length, 24)
  groups.forEach(([start, end, glyph], i) => {
    const offset = 28 + i * 12
    output.writeUInt32BE(start, offset)
    output.writeUInt32BE(end, offset + 4)
    output.writeUInt32BE(glyph, offset + 8)
  })
  return output
}

function cmap4() {
  // First segment uses a glyphIdArray with a missing-glyph hole; the next uses
  // idDelta and the mandatory sentinel. Coverage must not count glyph zero.
  const segments = 3, tableLength = 16 + segments * 8 + 3 * 2
  const table = Buffer.alloc(tableLength)
  table.writeUInt16BE(4, 0)
  table.writeUInt16BE(tableLength, 2)
  table.writeUInt16BE(segments * 2, 6)
  ;[0x43, 0x51, 0xffff].forEach((value, i) => table.writeUInt16BE(value, 14 + i * 2))
  ;[0x41, 0x50, 0xffff].forEach((value, i) => table.writeUInt16BE(value, 16 + segments * 2 + i * 2))
  table.writeInt16BE(-0x50, 16 + segments * 4 + 2)
  table.writeInt16BE(1, 16 + segments * 4 + 4)
  table.writeUInt16BE(6, 16 + segments * 6)
  ;[10, 0, 12].forEach((value, i) => table.writeUInt16BE(value, 16 + segments * 8 + i * 2))
  const output = Buffer.alloc(12 + tableLength)
  output.writeUInt16BE(1, 2)
  output.writeUInt16BE(3, 4)
  output.writeUInt16BE(1, 6)
  output.writeUInt32BE(12, 8)
  table.copy(output, 12)
  return output
}

function fontTables(options = {}) {
  const { family = 'Fixture Sans', subfamily = 'Regular', weight = 400, fsType = 0, coverage = cmap12(), localized = true, variable = false } = options
  const list = [[1, family], [2, subfamily], [4, `${family} ${subfamily}`], [6, `${family.replaceAll(' ', '')}-${subfamily}`], [16, 'Fixture Extended Sans'], [17, subfamily]]
  if (localized) list.push([1, '夹具黑体', 0x804])
  const os2 = Buffer.alloc(96)
  os2.writeUInt16BE(4, 0)
  os2.writeUInt16BE(weight, 4)
  os2.writeUInt16BE(fsType, 8)
  os2.writeUInt16BE(/italic/i.test(subfamily) ? 1 : 0, 62)
  const tables = new Map([['name', names(list)], ['OS/2', os2], ['cmap', coverage], ['head', Buffer.alloc(54)], ['post', Buffer.alloc(32)]])
  if (variable) {
    const fvar = Buffer.alloc(36)
    fvar.writeUInt16BE(1, 0)
    fvar.writeUInt16BE(16, 4)
    fvar.writeUInt16BE(1, 8)
    fvar.writeUInt16BE(20, 10)
    fvar.write('wght', 16)
    ;[100, weight, 900].forEach((value, i) => fvar.writeInt32BE(value * 65536, 20 + i * 4))
    tables.set('fvar', fvar)
  }
  return tables
}

function sfnt(tables, base = 0) {
  const size = 12 + tables.size * 16 + [...tables.values()].reduce((sum, table) => sum + Math.ceil(table.length / 4) * 4, 0)
  const output = Buffer.alloc(size)
  output.writeUInt32BE(0x10000, 0)
  output.writeUInt16BE(tables.size, 4)
  let index = 0, offset = 12 + tables.size * 16
  for (const [name, table] of tables) {
    const record = 12 + index++ * 16
    output.write(name, record)
    output.writeUInt32BE(base + offset, record + 8)
    output.writeUInt32BE(table.length, record + 12)
    table.copy(output, offset)
    offset += Math.ceil(table.length / 4) * 4
  }
  return output
}

function collection(faces) {
  const headerSize = 12 + faces.length * 4
  const output = Buffer.alloc(headerSize + faces.reduce((sum, face) => sum + sfnt(face).length, 0))
  output.write('ttcf', 0)
  output.writeUInt32BE(0x10000, 4)
  output.writeUInt32BE(faces.length, 8)
  let offset = headerSize
  faces.forEach((face, index) => {
    output.writeUInt32BE(offset, 12 + index * 4)
    const bytes = sfnt(face, offset)
    bytes.copy(output, offset)
    offset += bytes.length
  })
  return output
}

function woff(tables) {
  const packed = [...tables].map(([tag, bytes]) => {
    const compressed = deflateSync(bytes)
    return { tag, bytes, stored: compressed.length < bytes.length ? compressed : bytes }
  })
  const headerSize = 44 + tables.size * 20
  const size = headerSize + packed.reduce((sum, table) => sum + Math.ceil(table.stored.length / 4) * 4, 0)
  const output = Buffer.alloc(size)
  output.write('wOFF', 0)
  output.writeUInt32BE(0x10000, 4)
  output.writeUInt32BE(size, 8)
  output.writeUInt16BE(tables.size, 12)
  let offset = headerSize
  packed.forEach((item, i) => {
    const record = 44 + i * 20
    output.write(item.tag, record)
    output.writeUInt32BE(offset, record + 4)
    output.writeUInt32BE(item.stored.length, record + 8)
    output.writeUInt32BE(item.bytes.length, record + 12)
    item.stored.copy(output, offset)
    offset += Math.ceil(item.stored.length / 4) * 4
  })
  return output
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-font-catalog-test-'))
  const fonts = path.join(directory, 'fonts'), dist = path.join(directory, 'dist')
  const cleanup = []
  await fs.mkdir(fonts)
  await fs.mkdir(dist)
  t.after(async () => {
    for (const action of cleanup) await action()
    await fs.rm(directory, { recursive: true, force: true })
  })
  const generate = () => generateLocalFontCatalog({ distDirectory: dist, fontDirectories: [fonts] })
  return { directory, fonts, dist, generate, beforeCleanup: action => cleanup.push(action) }
}

test('catalog reads TTC faces, localized aliases, styles, variable axes and actual Unicode coverage without copying font bytes', async t => {
  const f = await fixture(t)
  const source = path.join(f.fonts, 'fixture.ttc')
  const bytes = collection([fontTables(), fontTables({ subfamily: 'Bold Italic', weight: 700, fsType: 0x108, coverage: cmap4(), variable: true })])
  await fs.writeFile(source, bytes)
  const catalog = await f.generate()
  assert.equal(catalog.version, 1)
  assert.equal(catalog.files.length, 1)
  assert.equal(catalog.warnings.length, 0)
  const file = catalog.files[0]
  assert.equal(file.format, 'collection')
  assert.equal(file.byteLength, bytes.length)
  assert.match(file.url, /^\/local-fonts\/[a-f0-9]{64}\.ttc$/)
  assert.equal(file.faces.length, 2)
  const [regular, boldItalic] = file.faces
  assert.equal(regular.family, 'Fixture Extended Sans')
  assert.ok(regular.families.includes('Fixture Sans'))
  assert.ok(regular.families.includes('夹具黑体'))
  assert.equal(regular.faceIndex, 0)
  assert.equal(boldItalic.faceIndex, 1)
  assert.equal(boldItalic.weight, 700)
  assert.equal(boldItalic.style, 'italic')
  assert.deepEqual(regular.coverage, { ranges: [[0x42, 0x43], [0x1f600, 0x1f601]], complete: true })
  assert.deepEqual(boldItalic.coverage, { ranges: [[0x41, 0x41], [0x43, 0x43], [0x51, 0x51]], complete: true })
  assert.deepEqual(boldItalic.variable.axes, [{ tag: 'wght', min: 100, default: 700, max: 900 }])
  assert.equal(boldItalic.embedding.noSubsetting, true)
  assert.equal(boldItalic.embedding.editable, true)
  const link = path.join(f.dist, file.url.slice(1))
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true)
  assert.equal(await fs.readlink(link), await fs.realpath(source))
  assert.deepEqual(await fs.readFile(link), bytes)
  assert.equal(JSON.stringify(catalog).includes(f.directory), false)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.dist, 'local-fonts/catalog.json'), 'utf8')), catalog)
  assert.equal((await f.generate()).files[0].url, file.url)
  assert.equal((await fs.readdir(path.join(f.dist, 'local-fonts'))).length, 2)
  assert.deepEqual(await fs.readFile(source), bytes)
})

test('standalone TTF and compressed WOFF metadata agree; unknown embedding rights fail closed', async t => {
  const f = await fixture(t)
  const tables = fontTables({ fsType: 4 })
  await fs.writeFile(path.join(f.fonts, 'font.ttf'), sfnt(tables))
  await fs.writeFile(path.join(f.fonts, 'font.woff'), woff(tables))
  const unknown = fontTables()
  unknown.delete('OS/2')
  await fs.writeFile(path.join(f.fonts, 'unknown.ttf'), sfnt(unknown))
  const catalog = await f.generate()
  assert.equal(catalog.files.length, 3)
  const ttf = catalog.files.find(file => file.format === 'truetype' && file.faces[0].fsType === 4)
  const compressed = catalog.files.find(file => file.format === 'woff')
  assert.deepEqual(ttf.faces, compressed.faces)
  assert.equal(ttf.faces[0].embedding.previewPrint, true)
  const missing = catalog.files.find(file => file.faces[0].fsType === null)
  assert.equal(missing.faces[0].embedding.restricted, true)
})

test('malformed fonts, unsupported WOFF2 and symlinks outside allowed roots are not published', async t => {
  const f = await fixture(t)
  await fs.mkdir(path.join(f.fonts, 'Nested'))
  await fs.writeFile(path.join(f.fonts, 'Nested/okay.otf'), sfnt(fontTables()))
  await fs.writeFile(path.join(f.fonts, 'bad.ttf'), Buffer.from('not a font'))
  await fs.writeFile(path.join(f.fonts, 'unsupported.woff2'), Buffer.from('wOF2' + ' '.repeat(48)))
  const outside = path.join(f.directory, 'outside.ttf')
  await fs.writeFile(outside, sfnt(fontTables()))
  await fs.symlink(outside, path.join(f.fonts, 'outside.ttf'))
  await fs.symlink(path.join(f.fonts, 'Nested/okay.otf'), path.join(f.fonts, 'duplicate.ttf'))
  const badBounds = sfnt(fontTables())
  badBounds.writeUInt32BE(0xffffffff, 20)
  await fs.writeFile(path.join(f.fonts, 'bounds.ttf'), badBounds)
  const catalog = await f.generate()
  assert.equal(catalog.files.length, 1)
  assert.equal(catalog.warnings.length, 4)
  assert.ok(catalog.warnings.some(item => item.code === 'font-outside-allowed-directory'))
  assert.ok(catalog.warnings.some(item => item.reason?.includes('WOFF2')))
  assert.equal(JSON.stringify(catalog).includes(f.directory), false)
  assert.equal((await fs.readdir(path.join(f.dist, 'local-fonts'))).length, 2)
})

test('refuses a redirected catalog directory and font-link collisions without replacing foreign files', async t => {
  const f = await fixture(t)
  const outside = path.join(f.directory, 'elsewhere')
  await fs.mkdir(outside)
  await fs.symlink(outside, path.join(f.dist, 'local-fonts'))
  await assert.rejects(f.generate, /real directory/)
  assert.deepEqual(await fs.readdir(outside), [])
  await fs.unlink(path.join(f.dist, 'local-fonts'))
  const source = path.join(f.fonts, 'fixture.ttf')
  await fs.writeFile(source, sfnt(fontTables()))
  const first = await f.generate(), file = path.join(f.dist, first.files[0].url.slice(1))
  await fs.unlink(file)
  await fs.writeFile(file, 'foreign data')
  const second = await f.generate()
  assert.equal(second.files.length, 0)
  assert.equal(second.warnings[0].reason, 'Local font link collision')
  assert.equal(await fs.readFile(file, 'utf8'), 'foreign data')
})

test('default font locations cover Mac, Windows and Linux without requiring all directories to exist', () => {
  assert.deepEqual(getDefaultFontDirectories('darwin', {}, '/Users/test'), ['/System/Library/Fonts', '/Library/Fonts', '/Users/test/Library/Fonts'])
  assert.deepEqual(getDefaultFontDirectories('win32', { WINDIR: 'D:\\Windows', LOCALAPPDATA: 'D:\\Users\\test\\AppData\\Local' }), ['D:\\Windows\\Fonts', 'D:\\Users\\test\\AppData\\Local\\Microsoft\\Windows\\Fonts'])
  assert.ok(getDefaultFontDirectories('linux', { XDG_DATA_HOME: '/data/share' }, '/home/test').includes('/data/share/fonts'))
})

test('Windows denied symlinks fall back to real same-inode hard links, never font copies', async t => {
  const f = await fixture(t)
  const source = path.join(f.fonts, 'fixture.ttf'), destination = path.join(f.dist, 'linked.ttf')
  const bytes = sfnt(fontTables())
  await fs.writeFile(source, bytes)
  const filesystem = { ...fs, symlink: () => Promise.reject(Object.assign(new Error('No developer mode'), { code: 'EPERM' })) }
  assert.equal(await createLocalFontLink(source, destination, { platform: 'win32', filesystem }), 'hardlink')
  const original = await fs.stat(source), link = await fs.lstat(destination)
  assert.equal(link.isFile(), true)
  assert.equal(link.ino, original.ino)
  assert.equal(link.dev, original.dev)
  assert.equal(link.nlink, 2)
  assert.deepEqual(await fs.readFile(destination), bytes)
  assert.equal(await createLocalFontLink(source, destination, { platform: 'win32', filesystem }), 'hardlink')
  const failed = path.join(f.dist, 'cross-volume.ttf')
  await assert.rejects(createLocalFontLink(source, failed, {
    platform: 'win32', filesystem: { ...filesystem, link: () => Promise.reject(Object.assign(new Error('Cross volume'), { code: 'EXDEV' })) },
  }), { code: 'EXDEV' })
  await assert.rejects(fs.stat(failed), { code: 'ENOENT' })
})

async function isolatedServer(t, catalogBlocked = false) {
  const f = await fixture(t)
  const scripts = path.join(f.directory, 'scripts')
  await fs.mkdir(scripts)
  for (const name of ['serve.mjs', 'local-files.mjs', 'font-catalog.mjs']) await fs.copyFile(new URL(`../${name}`, import.meta.url), path.join(scripts, name))
  await fs.writeFile(path.join(f.dist, 'index.html'), '<!doctype html><title>Isolated font catalog test</title>')
  if (catalogBlocked) await fs.writeFile(path.join(f.dist, 'local-fonts'), 'Keep this unrelated file')
  const child = spawn(process.execPath, [path.join(scripts, 'serve.mjs')], {
    cwd: f.directory,
    env: { ...process.env, STUDIO_PORT: '0', STUDIO_OUTPUT_DIR: path.join(f.directory, 'output'), STUDIO_SETTINGS_DIR: path.join(f.directory, 'settings') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stderr.on('data', bytes => {
    output += bytes
  })
  f.beforeCleanup(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await once(child, 'close')
    }
  })
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Isolated server failed to start: ${output}`)), 20000)
    child.once('error', error => {
      clearTimeout(timer); reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`))
    })
    child.stdout.on('data', bytes => {
      output += bytes
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/)
      if (match) {
        clearTimeout(timer); resolve(match[0])
      }
    })
  })
  return { ...f, origin, output: () => output }
}

test('isolated real server generates and serves local catalog before requests; JSON saves stay isolated', async t => {
  const f = await isolatedServer(t)
  const response = await fetch(`${f.origin}/local-fonts/catalog.json`)
  assert.equal(response.status, 200)
  const catalog = await response.json()
  assert.equal(catalog.version, 1)
  assert.equal(JSON.stringify(catalog).includes(f.directory), false)
  if (catalog.files.length) {
    const face = catalog.files[0], font = await fetch(f.origin + face.url, { method: 'HEAD' })
    assert.equal(font.status, 200)
    assert.match(font.headers.get('content-type'), /^font\//)
  }
  const config = await (await fetch(`${f.origin}/api/local/config`)).json()
  assert.equal(config.outputDirectory, await fs.realpath(path.join(f.directory, 'output')))
  const saved = await fetch(`${f.origin}/api/local/files?name=font-catalog-test.json`, { method: 'POST', headers: { 'X-SlideStudio-Token': config.token }, body: '{"slides":[]}' })
  assert.equal(saved.status, 200)
  assert.equal(await fs.readFile(path.join(f.directory, 'output/font-catalog-test.json'), 'utf8'), '{"slides":[]}')
})

test('a catalog generation failure leaves server and JSON file saving available', async t => {
  const f = await isolatedServer(t, true)
  assert.ok(f.output().includes('文稿保存不受影响'))
  const config = await (await fetch(`${f.origin}/api/local/config`)).json()
  const saved = await fetch(`${f.origin}/api/local/files?name=unaffected.json`, { method: 'POST', headers: { 'X-SlideStudio-Token': config.token }, body: '{"slides":[]}' })
  assert.equal(saved.status, 200)
  assert.equal(await fs.readFile(path.join(f.dist, 'local-fonts'), 'utf8'), 'Keep this unrelated file')
})

test('bundled font metadata contains exact current font hashes and coverage without local machine paths', async () => {
  const root = new URL('../../', import.meta.url)
  const metadata = JSON.parse(await fs.readFile(new URL('src/configs/bundledFontMetadata.json', root), 'utf8'))
  assert.equal(metadata.version, 1)
  const files = (await fs.readdir(new URL('src/assets/fonts/', root))).filter(name => name.endsWith('.woff2')).sort()
  assert.deepEqual(metadata.fonts.map(font => `${font.key}.woff2`).sort(), files)
  for (const font of metadata.fonts) {
    const bytes = await fs.readFile(new URL(`src/assets/fonts/${font.key}.woff2`, root))
    assert.equal(font.sha256, crypto.createHash('sha256').update(bytes).digest('hex'))
    assert.equal(font.byteLength, bytes.length)
    assert.equal(font.coverage.complete, true)
    assert.ok(font.coverage.ranges.length > 0)
    assert.ok(font.families.includes(font.key))
    assert.ok(typeof font.fsType === 'number')
    assert.ok(font.coverage.ranges.every(([start, end], index, ranges) => start <= end && start >= 0 && end <= 0x10ffff && (index === 0 || ranges[index - 1][1] + 1 < start)))
  }
  assert.equal(JSON.stringify(metadata).includes('/Users/'), false)
})
