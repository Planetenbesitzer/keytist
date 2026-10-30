/* eslint-env node */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { launcherConfiguration } from '../macos/launcher-config.mjs'

const repository = fileURLToPath(new URL('../..', import.meta.url))

test('new launcher configuration uses Keytist paths', () => {
  const configuration = launcherConfiguration({ repositoryPath: '/source/keytist', nodePath: '/runtime/node', home: '/users/example', exists: () => false })
  assert.equal(configuration.repositoryPath, '/source/keytist')
  assert.equal(configuration.nodePath, '/runtime/node')
  assert.equal(configuration.localURL, 'http://127.0.0.1:4178')
  assert.equal(configuration.defaultOutputDirectory, '/users/example/Documents/Code/Keytist/output')
})

test('installing without previous config still retains an existing legacy output', () => {
  const legacy = '/users/example/Documents/Code/SlidesStudio/output'
  const configuration = launcherConfiguration({ repositoryPath: '/source/keytist', nodePath: '/runtime/node', home: '/users/example', exists: name => name === legacy })
  assert.equal(configuration.defaultOutputDirectory, legacy)
})

test('migration preserves all four existing launcher fields without moving output', () => {
  const previous = {
    repositoryPath: '/existing runtime/旧目录',
    nodePath: '/existing node/bin/node',
    localURL: 'http://127.0.0.1:4178',
    defaultOutputDirectory: '/user/Documents/Code/SlidesStudio/output',
  }
  assert.deepEqual(launcherConfiguration({ repositoryPath: '/new/source', nodePath: '/new/node', previous }), previous)
})

test('invalid migration configuration fails instead of silently using fresh defaults', () => {
  const previous = { repositoryPath: '/old/runtime', nodePath: '/old/node', localURL: 'http://127.0.0.1:4178', defaultOutputDirectory: '/old/output' }
  for (const key of ['repositoryPath', 'nodePath', 'defaultOutputDirectory']) {
    assert.throws(() => launcherConfiguration({ previous: { ...previous, [key]: 'relative/path' } }))
    assert.throws(() => launcherConfiguration({ previous: { ...previous, [key]: undefined } }))
  }
  assert.throws(() => launcherConfiguration({ previous: { ...previous, localURL: 'http://127.0.0.1:9999' } }))
})

test('staging-only mode requires an explicit destination', () => {
  const environment = { ...process.env }
  delete environment.APP_DIR
  const result = spawnSync('/bin/bash', ['scripts/install-macos-app.sh', '--staging-only'], { cwd: repository, env: environment, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /APP_DIR/)
})

test('Swift launcher accepts both brands and shares existing legacy state', { skip: process.platform !== 'darwin' }, () => {
  const verification = path.join(repository, 'verification', 'rename-tests')
  fs.mkdirSync(verification, { recursive: true })
  const directory = fs.mkdtempSync(path.join(verification, 'swift-launcher-'))
  try {
    fs.writeFileSync(path.join(directory, 'main.swift'), `
import Foundation
for html in ["<title>Keytist</title>", "<title>Slide Studio</title>", "<TITLE lang='en'> Keytist — Local </TITLE>", "<title>Slide Studio - Local</title>", "<title>Keytist · 本地演示</title>", "<title>Slide Studio · 本地演示</title>"] {
    precondition(isEditorPage(html), html)
}
for html in ["<title>Other app</title>", "<title>KeytistImposter</title>", "<p>Keytist</p>", "<title>Slide StudioOther</title>"] {
    precondition(!isEditorPage(html), html)
}
let home = URL(fileURLWithPath: "/users/test", isDirectory: true)
let legacy = "/users/test/Library/Application Support/Slide Studio"
let inherited = launcherDirectories(home: home, exists: { $0 == legacy })
precondition(inherited.support.path == legacy)
precondition(inherited.logs.path == "/users/test/Library/Logs/Slide Studio")
let fresh = launcherDirectories(home: home, exists: { _ in false })
precondition(fresh.support.path == "/users/test/Library/Application Support/Keytist")
precondition(fresh.logs.path == "/users/test/Library/Logs/Keytist")
print("launcher compatibility checks passed")
`)
    const executable = path.join(directory, 'check-launcher')
    const compile = spawnSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', path.join(directory, 'ModuleCache'), path.join(repository, 'scripts/macos/LauncherSupport.swift'), path.join(directory, 'main.swift'), '-o', executable], { encoding: 'utf8' })
    assert.equal(compile.status, 0, compile.stderr)
    const result = spawnSync(executable, [], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /compatibility checks passed/)
  }
  finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
