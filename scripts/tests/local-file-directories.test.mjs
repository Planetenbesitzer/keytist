/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createLocalFileStore, resolveLocalFileDirectories } from '../local-files.mjs'

const directories = home => ({
  legacyOutput: path.join(home, 'Documents', 'Code', 'SlidesStudio', 'output'),
  legacySettings: path.join(home, 'Library', 'Application Support', 'Slide Studio'),
  output: path.join(home, 'Documents', 'Code', 'keytist', 'output'),
  settings: path.join(home, 'Library', 'Application Support', 'Keytist'),
})

const isolatedHome = async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'keytist-directory-test-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  return home
}

test('fresh defaults use lowercase keytist and legacy output/settings are retained independently', () => {
  const home = path.resolve('/isolated/keytist-home')
  const names = directories(home)
  for (const oldOutput of [false, true]) {
    for (const oldSettings of [false, true]) {
      const found = new Set([names.output, names.settings])
      if (oldOutput) found.add(names.legacyOutput)
      if (oldSettings) found.add(names.legacySettings)
      assert.deepEqual(resolveLocalFileDirectories({ home, env: {}, exists: name => found.has(name), readDirectory: () => [] }), {
        outputDirectory: oldOutput ? names.legacyOutput : names.output,
        settingsDirectory: oldSettings ? names.legacySettings : names.settings,
      })
    }
  }
})

test('explicit options override environment and environment overrides legacy defaults without probing', () => {
  const home = path.resolve('/isolated/keytist-home')
  const outputDirectory = path.join(home, 'chosen-output')
  const settingsDirectory = path.join(home, 'chosen-settings')
  const env = {
    STUDIO_OUTPUT_DIR: path.join(home, 'environment-output'),
    STUDIO_SETTINGS_DIR: path.join(home, 'environment-settings'),
  }
  const exists = () => {
    throw new Error('Explicit paths must not probe default locations')
  }
  const readDirectory = () => {
    throw new Error('Explicit output paths must not enumerate Code')
  }
  assert.deepEqual(resolveLocalFileDirectories({ home, outputDirectory, settingsDirectory, env, exists, readDirectory }), { outputDirectory, settingsDirectory })
  assert.deepEqual(resolveLocalFileDirectories({ home, env, exists, readDirectory }), { outputDirectory: env.STUDIO_OUTPUT_DIR, settingsDirectory: env.STUDIO_SETTINGS_DIR })
  assert.deepEqual(resolveLocalFileDirectories({ home, outputDirectory, env, exists, readDirectory }), { outputDirectory, settingsDirectory: env.STUDIO_SETTINGS_DIR })
})

test('actual directory spelling wins over case-folded existence and lowercase wins when both entries exist', () => {
  const home = path.resolve('/isolated/case-folded-home')
  const code = path.join(home, 'Documents', 'Code')
  const legacy = directories(home).legacyOutput
  for (const [entries, expected] of [[[], 'keytist'], [['Keytist'], 'Keytist'], [['keytist'], 'keytist'], [['Keytist', 'keytist'], 'keytist']]) {
    const probes = []
    const result = resolveLocalFileDirectories({ home, env: {}, exists: name => {
      // Simulate a filesystem where either casing of the preferred path exists.
      probes.push(name)
      return name.toLowerCase() === path.join(code, 'keytist', 'output').toLowerCase()
    }, readDirectory: directory => {
      assert.equal(directory, code)
      return entries
    } })
    assert.equal(result.outputDirectory, path.join(code, expected, 'output'))
    assert.ok(probes.includes(legacy))
    assert.ok(!probes.some(name => name === path.join(code, 'keytist', 'output') || name === path.join(code, 'Keytist', 'output')))
  }
  const inherited = resolveLocalFileDirectories({ home, env: {}, exists: name => name === legacy, readDirectory: () => {
    throw new Error('Legacy output must not enumerate Code')
  } })
  assert.equal(inherited.outputDirectory, legacy)
})

test('a missing Code directory uses lowercase while directory access errors are not concealed', () => {
  const home = path.resolve('/isolated/new-home')
  const fail = code => () => {
    throw Object.assign(new Error(code), { code })
  }
  assert.equal(resolveLocalFileDirectories({ home, env: {}, exists: () => false, readDirectory: fail('ENOENT') }).outputDirectory, directories(home).output)
  assert.throws(() => resolveLocalFileDirectories({ home, env: {}, exists: () => false, readDirectory: fail('EACCES') }), { code: 'EACCES' })
})

test('manual startup and an explicitly configured launcher preserve save keys for either actual directory casing', async t => {
  for (const folder of ['keytist', 'Keytist']) {
    const home = await isolatedHome(t)
    const outputDirectory = path.join(home, 'Documents', 'Code', folder, 'output')
    const settingsDirectory = directories(home).settings
    await fs.mkdir(outputDirectory, { recursive: true })
    const manual = await createLocalFileStore({ home, env: {} })
    assert.equal(manual.outputDirectory, outputDirectory)
    const initial = await manual.save('case.json', Buffer.from('before'))
    const launcher = await createLocalFileStore({ home, env: {}, outputDirectory, settingsDirectory })
    const updated = await launcher.save('case.json', Buffer.from('after'), initial)
    assert.equal(updated.fileKey, initial.fileKey)
    assert.equal(await fs.readFile(updated.path, 'utf8'), 'after')
  }
})

test('a fresh isolated store creates lowercase keytist output and Keytist settings', async t => {
  const home = await isolatedHome(t)
  const names = directories(home)
  const store = await createLocalFileStore({ home, env: {} })
  const saved = await store.save('fresh.json', Buffer.from('{"fresh":true}'))
  assert.equal(store.outputDirectory, await fs.realpath(names.output))
  assert.equal(saved.path, path.join(store.outputDirectory, 'fresh.json'))
  assert.equal((await fs.readFile(path.join(names.settings, 'save-key'))).length, 32)
  await assert.rejects(fs.access(names.legacyOutput), { code: 'ENOENT' })
  await assert.rejects(fs.access(names.legacySettings), { code: 'ENOENT' })
})

test('legacy directories preserve save-key and accept an existing v1 bound-file credential', async t => {
  const home = await isolatedHome(t)
  const names = directories(home)
  for (const directory of Object.values(names)) await fs.mkdir(directory, { recursive: true })
  const secret = Buffer.alloc(32, 7)
  await fs.writeFile(path.join(names.legacySettings, 'save-key'), secret, { mode: 0o600 })
  await fs.writeFile(path.join(names.settings, 'keep-settings'), 'new directory stays untouched')
  await fs.writeFile(path.join(names.output, 'keep.json'), 'new output stays untouched')
  const before = Buffer.from('{"legacy":true}')
  const name = 'existing.json'
  await fs.writeFile(path.join(names.legacyOutput, name), before)
  const output = await fs.realpath(names.legacyOutput)
  const binding = {
    fileKey: crypto.createHmac('sha256', secret).update(`SlideStudio:1\0${output}\0${name}`).digest('base64url'),
    revision: crypto.createHash('sha256').update(before).digest('hex'),
  }
  const store = await createLocalFileStore({ home, env: {} })
  const after = Buffer.from('{"legacy":"updated"}')
  const saved = await store.save(name, after, binding)
  assert.equal(store.outputDirectory, output)
  assert.equal(saved.fileKey, binding.fileKey)
  assert.deepEqual(await fs.readFile(saved.path), after)
  assert.deepEqual(await fs.readFile(path.join(names.legacySettings, 'save-key')), secret)
  assert.deepEqual(await fs.readdir(names.settings), ['keep-settings'])
  assert.deepEqual(await fs.readdir(names.output), ['keep.json'])
})

test('an invalid legacy save-key reports Keytist without replacing the original secret', async t => {
  const home = await isolatedHome(t)
  const names = directories(home)
  await fs.mkdir(names.legacySettings, { recursive: true })
  const filename = path.join(names.legacySettings, 'save-key')
  await fs.writeFile(filename, 'invalid')
  await assert.rejects(createLocalFileStore({ home, env: {} }), /Keytist 设置目录/)
  assert.equal(await fs.readFile(filename, 'utf8'), 'invalid')
})
