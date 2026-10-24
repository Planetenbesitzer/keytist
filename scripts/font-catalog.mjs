/* eslint-env node */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

// Read only metadata tables, never the complete font or glyph outlines. A large
// CJK collection can exceed 100 MB; the catalog and its file links stay small.
const MAX_TABLE_BYTES = 16 * 1024 * 1024
const MAX_TABLES = 512
const MAX_FACES = 512
const MAX_FILES = 5000
const EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2'])
const SFNT_SIGNATURES = new Set(['00010000', '4f54544f', '74727565', '74797031'])
const normalizeName = value => value.replace(/\0/g, '').trim()
const unique = values => [...new Set(values.filter(Boolean))]
const inside = (root, file) => file === root || file.startsWith(root + path.sep)

export function getDefaultFontDirectories(platform = process.platform, environment = process.env, home = os.homedir()) {
  if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts')]
  if (platform === 'win32') {
    return unique([
      path.win32.join(environment.WINDIR || 'C:\\Windows', 'Fonts'),
      environment.LOCALAPPDATA && path.win32.join(environment.LOCALAPPDATA, 'Microsoft/Windows/Fonts'),
    ])
  }
  return unique([
    '/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'),
    path.join(environment.XDG_DATA_HOME || path.join(home, '.local/share'), 'fonts'),
  ])
}

async function readAt(handle, fileSize, position, length) {
  if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position + length > fileSize || length > MAX_TABLE_BYTES) throw new Error('Invalid font table bounds')
  const buffer = Buffer.alloc(length)
  let count = 0
  while (count < length) {
    const { bytesRead } = await handle.read(buffer, count, length - count, position + count)
    if (!bytesRead) throw new Error('Truncated font table')
    count += bytesRead
  }
  return buffer
}

function decodeName(bytes, platform, encoding) {
  if (platform === 0 || platform === 3) {
    if (bytes.length % 2) return ''
    const swapped = Buffer.from(bytes)
    swapped.swap16()
    return normalizeName(swapped.toString('utf16le'))
  }
  if (platform === 1 && encoding === 0) {
    try {
      return normalizeName(new TextDecoder('macintosh').decode(bytes))
    }
    catch {
      return normalizeName(bytes.toString('latin1'))
    }
  }
  return ''
}

function parseNames(buffer) {
  if (!buffer || buffer.length < 6) return []
  const count = buffer.readUInt16BE(2), storage = buffer.readUInt16BE(4)
  if (6 + count * 12 > buffer.length || storage > buffer.length) throw new Error('Invalid name table')
  const records = []
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 12
    const platform = buffer.readUInt16BE(offset), encoding = buffer.readUInt16BE(offset + 2), language = buffer.readUInt16BE(offset + 4), id = buffer.readUInt16BE(offset + 6)
    if (![1, 2, 4, 6, 16, 17, 21, 22].includes(id)) continue
    const length = buffer.readUInt16BE(offset + 8), start = storage + buffer.readUInt16BE(offset + 10)
    if (start + length > buffer.length) continue
    const text = decodeName(buffer.subarray(start, start + length), platform, encoding)
    if (text) records.push({ id, text, platform, language })
  }
  return records.sort((a, b) => {
    const priority = item => (item.language === 0x409 || (item.platform === 1 && item.language === 0) ? 0 : item.platform === 0 ? 1 : 2)
    return priority(a) - priority(b)
  })
}

function mergeRanges(ranges) {
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged = []
  for (const [rawStart, rawEnd] of ranges) {
    const start = Math.max(0, rawStart), end = Math.min(0x10ffff, rawEnd)
    if (start > end) continue
    const previous = merged.at(-1)
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end)
    else merged.push([start, end])
  }
  return merged
}

function appendMappedRange(ranges, start, end, glyphAt) {
  let runStart
  for (let code = start; code <= end; code++) {
    const mapped = glyphAt(code) !== 0
    if (mapped && runStart === undefined) runStart = code
    if ((!mapped || code === end) && runStart !== undefined) {
      ranges.push([runStart, mapped && code === end ? code : code - 1])
      runStart = undefined
    }
  }
}

function parseCoverage(buffer) {
  if (!buffer || buffer.length < 4) return { ranges: [], complete: false }
  const count = buffer.readUInt16BE(2)
  if (count > 256 || 4 + count * 8 > buffer.length) throw new Error('Invalid cmap records')
  const ranges = [], seen = new Set()
  let recognized = 0, complete = true
  for (let i = 0; i < count; i++) {
    const record = 4 + i * 8, platform = buffer.readUInt16BE(record), encoding = buffer.readUInt16BE(record + 2), offset = buffer.readUInt32BE(record + 4)
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue
    if (seen.has(offset)) continue
    seen.add(offset)
    if (offset + 2 > buffer.length) throw new Error('Invalid cmap subtable')
    const format = buffer.readUInt16BE(offset)
    if (format === 14) continue // Variation selectors do not add independent characters.
    const longLength = format >= 8 && format <= 13
    if (offset + (longLength ? 8 : 4) > buffer.length) throw new Error('Truncated cmap header')
    const length = longLength ? buffer.readUInt32BE(offset + 4) : buffer.readUInt16BE(offset + 2)
    if (length < 4 || offset + length > buffer.length) throw new Error('Invalid cmap length')
    const table = buffer.subarray(offset, offset + length)
    if (format === 0 && length >= 262) {
      appendMappedRange(ranges, 0, 255, code => table[6 + code])
    }
    else if (format === 4) {
      if (length < 16) throw new Error('Invalid cmap format 4')
      const segments = table.readUInt16BE(6) / 2
      if (!Number.isInteger(segments) || 16 + segments * 8 > length) throw new Error('Invalid cmap segments')
      let previousEnd = -1
      for (let s = 0; s < segments; s++) {
        const end = table.readUInt16BE(14 + s * 2), start = table.readUInt16BE(16 + segments * 2 + s * 2)
        if (start > end || start <= previousEnd) throw new Error('Invalid cmap segment order')
        previousEnd = end
        if (start === 0xffff) continue
        const delta = table.readInt16BE(16 + segments * 4 + s * 2), rangePosition = 16 + segments * 6 + s * 2, rangeOffset = table.readUInt16BE(rangePosition)
        appendMappedRange(ranges, start, Math.min(end, 0xfffe), code => {
          if (!rangeOffset) return (code + delta) & 0xffff
          const glyphPosition = rangePosition + rangeOffset + (code - start) * 2
          if (glyphPosition + 2 > table.length) throw new Error('Invalid cmap glyph array')
          const glyph = table.readUInt16BE(glyphPosition)
          return glyph ? (glyph + delta) & 0xffff : 0
        })
      }
    }
    else if (format === 6 || format === 10) {
      const startOffset = format === 6 ? 6 : 12, entrySize = format === 6 ? 2 : 4, arrayOffset = format === 6 ? 10 : 20
      if (length < arrayOffset) throw new Error('Invalid cmap trimmed array')
      const start = entrySize === 2 ? table.readUInt16BE(startOffset) : table.readUInt32BE(startOffset)
      const entries = entrySize === 2 ? table.readUInt16BE(startOffset + 2) : table.readUInt32BE(startOffset + 4)
      if (arrayOffset + entries * 2 > length || start + entries > 0x110000) throw new Error('Invalid cmap trimmed array entries')
      appendMappedRange(ranges, start, start + entries - 1, code => table.readUInt16BE(arrayOffset + (code - start) * 2))
    }
    else if (format === 12 || format === 13) {
      if (length < 16) throw new Error('Invalid cmap groups')
      const groups = table.readUInt32BE(12)
      if (16 + groups * 12 > length) throw new Error('Invalid cmap group length')
      let previousEnd = -1
      for (let g = 0; g < groups; g++) {
        const group = 16 + g * 12, start = table.readUInt32BE(group), end = table.readUInt32BE(group + 4), glyph = table.readUInt32BE(group + 8)
        if (end < start || end > 0x10ffff || start <= previousEnd) throw new Error('Invalid Unicode cmap range')
        previousEnd = end
        if (format === 13) {
          if (glyph) ranges.push([start, end])
        }
        else if (glyph || start < end) ranges.push([glyph ? start : start + 1, end])
      }
    }
    else {
      complete = false
      continue
    }
    recognized++
  }
  return { ranges: mergeRanges(ranges), complete: complete && recognized > 0 }
}

function parseAxes(buffer) {
  if (!buffer || buffer.length < 16) return undefined
  const start = buffer.readUInt16BE(4), count = buffer.readUInt16BE(8), size = buffer.readUInt16BE(10)
  if (size < 20 || start + count * size > buffer.length) throw new Error('Invalid fvar axes')
  const axes = []
  for (let i = 0; i < count; i++) {
    const offset = start + i * size
    axes.push({ tag: buffer.toString('ascii', offset, offset + 4), min: buffer.readInt32BE(offset + 4) / 65536, default: buffer.readInt32BE(offset + 8) / 65536, max: buffer.readInt32BE(offset + 12) / 65536 })
  }
  return { axes }
}

function faceMetadata(tables, faceIndex) {
  const names = parseNames(tables.get('name'))
  const named = id => names.filter(item => item.id === id).map(item => item.text)
  const family = named(16)[0] || named(1)[0] || named(21)[0]
  if (!family) throw new Error('Font has no readable family name')
  const subfamily = named(17)[0] || named(2)[0] || named(22)[0] || 'Regular'
  const os2 = tables.get('OS/2'), head = tables.get('head'), post = tables.get('post')
  const selection = os2 && os2.length >= 64 ? os2.readUInt16BE(62) : 0
  const macStyle = head && head.length >= 46 ? head.readUInt16BE(44) : 0
  const italic = Boolean(selection & 1 || macStyle & 2 || post && post.length >= 8 && post.readInt32BE(4) !== 0 || /italic|oblique/i.test(subfamily))
  const weight = os2 && os2.length >= 6 ? Math.max(1, Math.min(1000, os2.readUInt16BE(4) || 400)) : (selection & 32 || macStyle & 1 || /bold/i.test(subfamily) ? 700 : 400)
  const fsType = os2 && os2.length >= 10 ? os2.readUInt16BE(8) : null
  const variable = parseAxes(tables.get('fvar'))
  return {
    family, families: unique([family, ...named(1), ...named(16), ...named(21)]),
    subfamily, subfamilies: unique([subfamily, ...named(2), ...named(17), ...named(22)]),
    fullName: named(4)[0] || `${family} ${subfamily}`, fullNames: unique(named(4)),
    postscriptName: named(6)[0] || '', faceIndex, weight, style: italic ? 'italic' : 'normal', fsType,
    embedding: {
      restricted: fsType === null || Boolean(fsType & 0x0002),
      previewPrint: fsType !== null && Boolean(fsType & 0x0004),
      editable: fsType !== null && Boolean(fsType & 0x0008),
      noSubsetting: fsType !== null && Boolean(fsType & 0x0100),
      bitmapOnly: fsType !== null && Boolean(fsType & 0x0200),
    },
    coverage: parseCoverage(tables.get('cmap')),
    ...(variable ? { variable } : {}),
  }
}

async function readFontMetadata(filename, stat) {
  const handle = await fs.open(filename, 'r')
  try {
    const header = await readAt(handle, stat.size, 0, Math.min(44, stat.size))
    if (header.length < 12) throw new Error('Font header is too short')
    const signature = header.toString('ascii', 0, 4), hex = header.subarray(0, 4).toString('hex')
    if (signature === 'wOF2') throw new Error('WOFF2 metadata is not supported by the local catalog; import this font in the editor')
    const wanted = new Set(['name', 'OS/2', 'cmap', 'head', 'post', 'fvar'])
    if (signature === 'wOFF') {
      if (header.length < 44 || header.readUInt32BE(8) !== stat.size) throw new Error('Invalid WOFF header')
      const count = header.readUInt16BE(12)
      if (!count || count > MAX_TABLES) throw new Error('Invalid WOFF table count')
      const directory = await readAt(handle, stat.size, 44, count * 20), tables = new Map()
      for (let t = 0; t < count; t++) {
        const offset = t * 20, tag = directory.toString('ascii', offset, offset + 4)
        if (!wanted.has(tag)) continue
        const position = directory.readUInt32BE(offset + 4), compressed = directory.readUInt32BE(offset + 8), original = directory.readUInt32BE(offset + 12)
        if (original > MAX_TABLE_BYTES || compressed > original) throw new Error('Invalid WOFF table size')
        const bytes = await readAt(handle, stat.size, position, compressed)
        const table = compressed === original ? bytes : inflateSync(bytes, { maxOutputLength: original })
        if (table.length !== original) throw new Error('Invalid WOFF decompressed length')
        tables.set(tag, table)
      }
      return { format: 'woff', faces: [faceMetadata(tables, 0)] }
    }
    let offsets
    if (signature === 'ttcf') {
      const count = header.readUInt32BE(8)
      if (!count || count > MAX_FACES) throw new Error('Invalid font collection size')
      const bytes = await readAt(handle, stat.size, 12, count * 4)
      offsets = Array.from({ length: count }, (_, index) => bytes.readUInt32BE(index * 4))
    }
    else if (SFNT_SIGNATURES.has(hex)) offsets = [0]
    else throw new Error('Unsupported font signature')
    const faces = []
    for (let index = 0; index < offsets.length; index++) {
      const offset = offsets[index], faceHeader = await readAt(handle, stat.size, offset, 12)
      if (!SFNT_SIGNATURES.has(faceHeader.subarray(0, 4).toString('hex'))) throw new Error('Invalid collection face signature')
      const count = faceHeader.readUInt16BE(4)
      if (!count || count > MAX_TABLES) throw new Error('Invalid sfnt table count')
      const directory = await readAt(handle, stat.size, offset + 12, count * 16), tables = new Map()
      for (let t = 0; t < count; t++) {
        const entry = t * 16, tag = directory.toString('ascii', entry, entry + 4)
        if (wanted.has(tag)) tables.set(tag, await readAt(handle, stat.size, directory.readUInt32BE(entry + 8), directory.readUInt32BE(entry + 12)))
      }
      faces.push(faceMetadata(tables, index))
    }
    return { format: signature === 'ttcf' ? 'collection' : hex === '4f54544f' ? 'opentype' : 'truetype', faces }
  }
  finally {
    await handle.close()
  }
}

async function collectFonts(directories, warnings) {
  const found = [], visited = new Set()
  const roots = []
  for (const directory of directories) {
    try {
      const real = await fs.realpath(path.resolve(directory))
      if ((await fs.stat(real)).isDirectory()) roots.push(real)
    }
    catch (error) {
      if (error.code !== 'ENOENT') warnings.push({ code: 'font-directory-unavailable', directory: path.basename(directory) })
    }
  }
  async function visit(directory) {
    let actual, entries
    try {
      actual = await fs.realpath(directory)
      if (!roots.some(root => inside(root, actual))) return
      if (visited.has(actual)) return
      visited.add(actual)
      entries = await fs.readdir(actual, { withFileTypes: true })
    }
    catch (error) {
      if (error.code !== 'ENOENT') warnings.push({ code: 'font-directory-unavailable', directory: path.basename(directory) })
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const file = path.join(actual, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if ((entry.isFile() || entry.isSymbolicLink()) && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        try {
          const real = await fs.realpath(file), stat = await fs.stat(real)
          if (!roots.some(root => inside(root, real))) {
            warnings.push({ code: 'font-outside-allowed-directory', fileName: entry.name })
          }
          else if (stat.isFile() && !visited.has(real) && found.length < MAX_FILES) {
            visited.add(real)
            found.push({ path: real, stat })
          }
        }
        catch {
          warnings.push({ code: 'font-unavailable', fileName: entry.name })
        }
      }
    }
  }
  for (const directory of roots) await visit(directory)
  return found
}

// Windows can deny unprivileged symbolic links. A hard link on the same volume
// exposes the identical inode without duplicating the font's data blocks.
export async function createLocalFontLink(source, destination, { platform = process.platform, filesystem = fs } = {}) {
  try {
    await filesystem.symlink(source, destination, 'file')
  }
  catch (error) {
    if (platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      try {
        await filesystem.link(source, destination)
      }
      catch (linkError) {
        if (linkError.code !== 'EEXIST') throw linkError
      }
    }
    else if (error.code !== 'EEXIST') throw error
  }
  const existing = await filesystem.lstat(destination)
  if (existing.isSymbolicLink()) {
    if (await filesystem.readlink(destination) !== source) throw new Error('Local font link collision')
    return 'symlink'
  }
  const original = await filesystem.stat(source)
  if (platform !== 'win32' || !existing.isFile() || existing.dev !== original.dev || existing.ino !== original.ino || existing.nlink < 2) throw new Error('Local font link collision')
  return 'hardlink'
}

/**
 * Generate a versioned metadata catalog and opaque links to real local font
 * files. The distribution must omit local-fonts when it is shared. No font data
 * is copied, no application data is touched, and no server restart is needed.
 */
export async function generateLocalFontCatalog({ distDirectory, fontDirectories = getDefaultFontDirectories() } = {}) {
  if (!distDirectory) throw new TypeError('distDirectory is required')
  const dist = await fs.realpath(path.resolve(distDirectory))
  const target = path.join(dist, 'local-fonts')
  try {
    const existing = await fs.lstat(target)
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('local-fonts must be a real directory')
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    await fs.mkdir(target)
  }
  if (!inside(dist, await fs.realpath(target))) throw new Error('Local font directory escapes distribution')
  const warnings = [], files = []
  const sources = await collectFonts(fontDirectories, warnings)
  for (const source of sources) {
    try {
      const metadata = await readFontMetadata(source.path, source.stat)
      const id = crypto.createHash('sha256').update(`${source.path}\0${source.stat.size}\0${source.stat.mtimeMs}`).digest('hex')
      const extension = metadata.format === 'collection' ? '.ttc' : metadata.format === 'woff' ? '.woff' : metadata.format === 'opentype' ? '.otf' : '.ttf'
      const filename = `${id}${extension}`, link = path.join(target, filename)
      await createLocalFontLink(source.path, link)
      files.push({ id, url: `/local-fonts/${filename}`, format: metadata.format, byteLength: source.stat.size, modifiedMs: source.stat.mtimeMs, faces: metadata.faces })
    }
    catch (error) {
      warnings.push({
        code: 'font-skipped', fileName: path.basename(source.path),
        reason: error.code === 'EPERM' ? 'Creating font links requires filesystem permission' : error.code ? `Font file unavailable (${error.code})` : error.message,
      })
    }
  }
  files.sort((a, b) => a.faces[0].family.localeCompare(b.faces[0].family) || a.id.localeCompare(b.id))
  const catalog = {
    version: 1, generatedAt: new Date().toISOString(), platform: process.platform,
    refreshAfterMs: 24 * 60 * 60 * 1000,
    defaultFallbacks: { sans: ['Inter', 'SourceHanSans'], serif: ['SourceSerif4', 'SourceHanSerif'], mono: ['JetBrainsMono'] },
    files, warnings,
  }
  const temporary = path.join(target, `.catalog-${crypto.randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, JSON.stringify(catalog) + '\n', { flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, path.join(target, 'catalog.json'))
  }
  finally {
    await fs.rm(temporary, { force: true })
  }
  return catalog
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const distDirectory = path.resolve(process.argv[2] || fileURLToPath(new URL('../dist', import.meta.url)))
  const catalog = await generateLocalFontCatalog({ distDirectory })
  process.stdout.write(JSON.stringify({ files: catalog.files.length, faces: catalog.files.reduce((sum, file) => sum + file.faces.length, 0), warnings: catalog.warnings.length }) + '\n')
}
