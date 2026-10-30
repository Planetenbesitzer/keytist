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
  output: path.join(home, 'Documents', 'Code', 'Keytist', 'output'),
  settings: path.join(home, 'Library', 'Application Support', 'Keytist'),
})

const isolatedHome = async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'keytist-directory-test-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  return home
}

test('fresh defaults use Keytist and legacy output/settings are retained independently', () => {
  const home = path.resolve('/isolated/keytist-home')
  const names = directories(home)
  for (const oldOutput of [false, true]) {
    for (const oldSettings of [false, true]) {
      const found = new Set([names.output, names.settings])
      if (oldOutput) found.add(names.legacyOutput)
      if (oldSettings) found.add(names.legacySettings)
      assert.deepEqual(resolveLocalFileDirectories({ home, env: {}, exists: name => found.has(name) }), {
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
  assert.deepEqual(resolveLocalFileDirectories({ home, outputDirectory, settingsDirectory, env, exists }), { outputDirectory, settingsDirectory })
  assert.deepEqual(resolveLocalFileDirectories({ home, env, exists }), { outputDirectory: env.STUDIO_OUTPUT_DIR, settingsDirectory: env.STUDIO_SETTINGS_DIR })
  assert.deepEqual(resolveLocalFileDirectories({ home, outputDirectory, env, exists }), { outputDirectory, settingsDirectory: env.STUDIO_SETTINGS_DIR })
})

test('a fresh isolated store creates only Keytist output and settings', async t => {
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
