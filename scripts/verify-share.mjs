/* eslint-env node */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const run = promisify(execFile)
const repository = fileURLToPath(new URL('../', import.meta.url))
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const omittedFonts = new Set(['AlibabaPuHuiTi', 'MiSans'])
const executableEntries = ['启动 Keytist.command', '安装到应用程序.command', 'start-keytist.sh', 'scripts/install-macos-app.sh']
const launcherEntries = [...executableEntries, 'Start Keytist.bat']
const requiredRuntime = ['scripts/serve.mjs', 'scripts/local-files.mjs', 'scripts/font-catalog.mjs', 'package.json']
const forbiddenSegments = new Set(['local-fonts', 'output', 'node_modules', '.git', '.vite', 'verification', '.codex', 'KeynoteLocalDocuments', 'Application Support'])
const allowedExamples = new Set(['examples/我的第一份演示.json', 'examples/HTML演示示例.html'])

const assert = (condition, reason) => {
  if (!condition) throw new Error(reason)
}

function assertPublicName(name) {
  assert(name.startsWith('Keytist/'), `Unexpected archive root: ${name}`)
  const relative = name.slice('Keytist/'.length), segments = relative.split('/')
  assert(!name.includes('\\') && !segments.some(segment => segment === '..' || segment === '.'), `Unsafe archive path: ${name}`)
  assert(!['启动 Slide Studio.command', 'Start Slide Studio.bat', 'start-slides-studio.sh'].includes(relative), `Obsolete launcher name: ${name}`)
  assert(!segments.some(segment => forbiddenSegments.has(segment)), `Private directory in archive: ${name}`)
  assert(!/(?:^|\/)(?:save-key|launcher\.json|\.env(?:\..*)?|\.DS_Store|verification\.html)$|(?:\.before-codex\.json|\.bak|\.backup|\.partial\.zip)$/i.test(relative), `Private or intermediate file in archive: ${name}`)
  if (relative.startsWith('examples/') && !name.endsWith('/')) assert(allowedExamples.has(relative), `Unapproved example document: ${name}`)
}

async function stopChild(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, 'close')
    child.kill('SIGTERM')
    await closed
  }
}

async function verifyRuntime(zip, directory, expectedVersion) {
  const bundle = path.join(directory, 'Keytist'), home = path.join(directory, 'home')
  await fs.mkdir(bundle)
  await fs.mkdir(home)
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const relative = name.slice('Keytist/'.length)
    if (!relative.startsWith('dist/') && !requiredRuntime.includes(relative)) continue
    const destination = path.join(bundle, relative)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, await entry.async('nodebuffer'))
  }
  let child
  try {
    // Explicitly replace inherited settings/output variables as well as HOME;
    // no test action can reach the user's production server or save directory.
    child = spawn(process.execPath, ['scripts/serve.mjs'], {
      cwd: bundle,
      env: {
        ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: path.join(home, 'AppData/Local'),
        XDG_DATA_HOME: path.join(home, '.local/share'), STUDIO_PORT: '0',
        STUDIO_OUTPUT_DIR: path.join(home, 'Documents/Code/Keytist/output'),
        STUDIO_SETTINGS_DIR: path.join(home, 'Library/Application Support/Keytist'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    child.stderr.on('data', bytes => {
      log += bytes
    })
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Isolated share startup timed out: ${log}`)), 20000)
      child.once('error', error => {
        clearTimeout(timer); reject(error)
      })
      child.once('exit', code => {
        clearTimeout(timer); reject(new Error(`Isolated server exited ${code}: ${log}`))
      })
      child.stdout.on('data', bytes => {
        log += bytes
        const match = log.match(/http:\/\/127\.0\.0\.1:(\d+)/)
        if (match) {
          clearTimeout(timer)
          assert(match[1] !== '4178', 'Isolation failed: production port was used')
          resolve(match[0])
        }
      })
    })
    const indexResponse = await fetch(origin)
    assert(indexResponse.ok, 'Published entry could not be fetched')
    const index = await indexResponse.text()
    assert(/<title>Keytist(?:\s|[<·])/.test(index), 'Published entry does not show the Keytist name')
    for (const asset of [...index.matchAll(/(?:src|href)="(\/assets\/[^"\s]+)"/g)].map(match => match[1])) {
      const response = await fetch(origin + asset)
      assert(response.ok, `Missing built entry asset: ${asset}`)
      const expected = await zip.file(`Keytist/dist${asset}`).async('nodebuffer')
      assert(sha256(new Uint8Array(await response.arrayBuffer())) === sha256(expected), `Served asset differs from archive: ${asset}`)
    }
    const catalogResponse = await fetch(`${origin}/local-fonts/catalog.json`)
    assert(catalogResponse.ok, 'Recipient startup did not generate a font catalog')
    const catalog = await catalogResponse.json()
    assert(catalog.version === 1 && Array.isArray(catalog.files), 'Recipient font catalog is invalid')
    assert(!JSON.stringify(catalog).includes(home), 'Recipient font catalog exposes filesystem paths')
    const config = await (await fetch(`${origin}/api/local/config`)).json()
    const output = await fs.realpath(path.join(home, 'Documents/Code/Keytist/output'))
    assert(config.outputDirectory === output, 'Save API is not isolated inside temporary HOME')
    const example = await zip.file('Keytist/examples/我的第一份演示.json').async('string')
    const headers = { 'X-SlideStudio-Token': config.token }
    const saved = await fetch(`${origin}/api/local/files?name=share-verification.json`, { method: 'POST', headers, body: example })
    assert(saved.ok, `New JSON save failed: ${saved.status}`)
    const binding = await saved.json()
    assert(binding.path.startsWith(output + path.sep), 'JSON save escaped temporary output')
    assert(await fs.readFile(binding.path, 'utf8') === example, 'Saved JSON did not read back exactly')
    const updated = JSON.stringify({ ...JSON.parse(example), title: 'Isolated share verification' })
    const repeated = await fetch(`${origin}/api/local/files?name=${encodeURIComponent(binding.fileName)}`, {
      method: 'POST', headers: { ...headers, 'X-SlideStudio-File-Key': binding.fileKey, 'X-SlideStudio-Revision': binding.revision }, body: updated,
    })
    assert(repeated.ok, `Bound JSON update failed: ${repeated.status}`)
    assert(await fs.readFile(binding.path, 'utf8') === updated, 'Updated JSON did not read back exactly')
    const metadata = JSON.parse(await fs.readFile(path.join(bundle, 'package.json'), 'utf8'))
    assert(metadata.version === expectedVersion, 'Runtime version does not match inspected archive')
    return { version: metadata.version, isolatedBoot: true, entryAssetHashes: true, catalogFiles: catalog.files.length, jsonSaveAndReadback: true, boundUpdateAndReadback: true }
  }
  finally {
    await stopChild(child)
  }
}

export async function verifyShareArchive(archive) {
  // macOS unzip can transcode UTF-8 entry names incorrectly. Use it only for
  // independent CRC validation; JSZip preserves the original names below.
  await run('unzip', ['-tq', archive], { maxBuffer: 4 * 1024 * 1024 })
  const archiveBytes = await fs.readFile(archive)
  const zip = await JSZip.loadAsync(archiveBytes)
  for (const [name, entry] of Object.entries(zip.files)) {
    assertPublicName(name)
    assert(!entry.unsafeOriginalName || entry.unsafeOriginalName === name, `ZIP filename was sanitized: ${name}`)
    const mode = Number(entry.unixPermissions) || 0
    assert((mode & 0o170000) !== 0o120000, `Symlink in archive: ${name}`)
  }
  const manifestFile = zip.file('Keytist/SHA256SUMS.txt')
  assert(manifestFile, 'SHA256 manifest is missing')
  const lines = (await manifestFile.async('string')).trim().split('\n')
  const manifest = new Map()
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/)
    assert(match, 'Invalid SHA256 manifest line')
    const [, hash, relative] = match
    assertPublicName(`Keytist/${relative}`)
    assert(!manifest.has(relative), `Duplicate manifest path: ${relative}`)
    manifest.set(relative, hash)
  }
  const sourceMetadata = JSON.parse(await fs.readFile(path.join(repository, 'src/configs/bundledFontMetadata.json'), 'utf8'))
  const approvedFonts = sourceMetadata.fonts.filter(font => !omittedFonts.has(font.key))
  const approvedHashes = new Set(approvedFonts.map(font => font.sha256))
  let fileCount = 0, fontCount = 0
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === 'Keytist/SHA256SUMS.txt') continue
    const relative = name.slice('Keytist/'.length)
    assert(manifest.has(relative), `File absent from manifest: ${relative}`)
    const bytes = await entry.async('nodebuffer'), hash = sha256(bytes)
    assert(hash === manifest.get(relative), `SHA256 mismatch: ${relative}`)
    manifest.delete(relative)
    fileCount++
    const signature = bytes.subarray(0, 4).toString('hex')
    if (['00010000', '4f54544f', '74727565', '74797031', '74746366', '774f4646', '774f4632'].includes(signature) || /\.(tt[cf]|ot[cf]|woff2?|dfont)$/i.test(relative)) {
      assert(approvedHashes.has(hash), `Unapproved or system font binary: ${relative}`)
      assert(relative.startsWith('src/assets/fonts/') || relative.startsWith('dist/assets/'), `Font outside expected assets: ${relative}`)
      fontCount++
    }
    if (relative.endsWith('.json')) {
      const parsed = JSON.parse(bytes.toString('utf8'))
      if (parsed && Array.isArray(parsed.slides) && 'width' in parsed && 'height' in parsed) {
        assert(allowedExamples.has(relative) || /^(public|dist)\/mocks\//.test(relative), `Private native document in source archive: ${relative}`)
      }
    }
  }
  assert(manifest.size === 0, `Manifest references absent files: ${[...manifest.keys()].join(', ')}`)
  for (const name of executableEntries) {
    const entry = zip.file(`Keytist/${name}`)
    assert(entry && (Number(entry.unixPermissions) & 0o111) === 0o111, `Missing executable permissions: ${name}`)
  }
  for (const name of launcherEntries) assert(zip.file(`Keytist/${name}`), `Missing launcher: ${name}`)
  const packagedMetadata = JSON.parse(await zip.file('Keytist/src/configs/bundledFontMetadata.json').async('string'))
  assert(packagedMetadata.fonts.length === approvedFonts.length, 'Unexpected packaged font metadata count')
  for (const font of packagedMetadata.fonts) {
    assert(!omittedFonts.has(font.key) && approvedHashes.has(font.sha256), `Omitted/unapproved font remains in metadata: ${font.key}`)
    const bytes = await zip.file(`Keytist/src/assets/fonts/${font.key}.woff2`).async('nodebuffer')
    assert(sha256(bytes) === font.sha256, `Bundled font and metadata mismatch: ${font.key}`)
  }
  const metadata = JSON.parse(await zip.file('Keytist/package.json').async('string'))
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'keytist-share-verification-'))
  try {
    const runtime = await verifyRuntime(zip, temporary, metadata.version)
    return { archive: path.resolve(archive), bytes: archiveBytes.length, sha256: sha256(archiveBytes), crc: true, manifestFiles: fileCount, fontBinaries: fontCount, privateDataExcluded: true, executableEntries: executableEntries.length, ...runtime }
  }
  finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || process.argv.includes('--help')) process.stdout.write('Usage: node scripts/verify-share.mjs /absolute/path/to/Keytist-version-share.zip\nVerifies CRC, every manifest hash, font/data privacy, executable flags and isolated dependency-free boot/save; cleans its temporary copy.\n')
  else process.stdout.write(JSON.stringify(await verifyShareArchive(path.resolve(process.argv[2])), null, 2) + '\n')
}
