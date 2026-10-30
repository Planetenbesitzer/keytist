/* eslint-env node */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const repository = fileURLToPath(new URL('../..', import.meta.url))
const installer = fs.readFileSync(path.join(repository, 'scripts/install-macos-app.sh'), 'utf8')
const configurationModule = pathToFileURL(path.join(repository, 'scripts/macos/launcher-config.mjs')).href

// Exercise the real installation transaction against disposable bundles. Only
// native compilation/signing/registration commands are replaced; no system app,
// registration database, browser, service or user document is touched.
function fixture(run) {
  const verification = path.join(repository, 'verification/rename-tests')
  fs.mkdirSync(verification, { recursive: true })
  const directory = fs.mkdtempSync(path.join(verification, 'installer-'))
  const appDirectory = path.join(directory, 'apps')
  const tools = path.join(directory, 'tools')
  fs.mkdirSync(path.join(directory, 'scripts/macos'), { recursive: true })
  fs.mkdirSync(appDirectory)
  fs.mkdirSync(tools)
  fs.writeFileSync(path.join(directory, 'package.json'), '{"version":"2.5.0"}')
  const previous = { repositoryPath: path.join(directory, 'runtime'), nodePath: process.execPath, localURL: 'http://127.0.0.1:4178', defaultOutputDirectory: path.join(directory, 'existing-output') }
  const apps = { current: path.join(appDirectory, 'Keytist.app'), legacy: path.join(appDirectory, 'Slide Studio.app') }
  function addApp(location, identifier = 'local.slidestudio.launcher') {
    fs.mkdirSync(path.join(location, 'Contents/Resources'), { recursive: true })
    fs.writeFileSync(path.join(location, 'Contents/Info.plist'), JSON.stringify({ identifier }))
    fs.writeFileSync(path.join(location, 'Contents/Resources/launcher.json'), JSON.stringify(previous))
    fs.writeFileSync(path.join(location, 'original-marker'), location)
  }
  const toolSource = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const tool = path.basename(process.argv[1]), args = process.argv.slice(2), state = process.env.TEST_STATE;
function record(name, values) { fs.appendFileSync(path.join(state, 'events'), JSON.stringify([name, ...values]) + '\\n'); }
function failOnce(name) { const file = path.join(state, name); if (fs.existsSync(file)) return false; fs.writeFileSync(file, '1'); return true; }
if (tool === 'PlistBuddy') { console.log(JSON.parse(fs.readFileSync(args.at(-1))).identifier); }
else if (tool === 'xcrun') {
  const output = args[args.indexOf('-o') + 1];
  const body = path.basename(output) === 'render-icon'
    ? '#!/bin/bash\\nmkdir -p "$2"\\n'
    : '#!${process.execPath}\\nconst fs = require("node:fs"), path = require("node:path"); const p = path.join(process.env.TEST_STATE,"checks"); const count = Number(fs.existsSync(p) ? fs.readFileSync(p,"utf8") : 0) + 1; fs.writeFileSync(p,String(count)); if (process.argv[2] !== "--check") process.exit(99); if ((process.env.FAIL_STAGE === "precheck" && count === 1) || (process.env.FAIL_STAGE === "installed-check" && count === 2)) process.exit(42); console.log("ready");\\n';
  fs.writeFileSync(output, body, { mode: 0o755 });
}
else if (tool === 'iconutil') { fs.writeFileSync(args[args.indexOf('-o') + 1], 'test icon'); }
else if (tool === 'lsregister') {
  record(tool, args);
  if (process.env.FAIL_STAGE === 'register' && args[0] === '-f' && args[1].endsWith('/Keytist.app') && failOnce('registration-failed')) process.exit(42);
  if (process.env.FAIL_STAGE === 'legacy-unregister' && args[0] === '-u' && args[1].endsWith('/Slide Studio.app') && failOnce('legacy-unregistration-failed')) process.exit(42);
}
else if (tool === 'mv') {
  if (process.env.FAIL_STAGE === 'legacy-move' && args[0].endsWith('/Slide Studio.app') && args[1].endsWith('/Previous Slide Studio.app')) process.exit(42);
  const result = cp.spawnSync('/bin/mv', args, { stdio: 'inherit' }); process.exit(result.status);
}
else if (tool === 'codesign' && process.env.FAIL_STAGE === 'sign') { process.exit(42); }
`
  for (const name of ['PlistBuddy', 'xcrun', 'iconutil', 'lsregister', 'plutil', 'codesign', 'mv']) {
    fs.writeFileSync(path.join(tools, name), toolSource, { mode: 0o755 })
  }
  let source = installer
  for (const name of ['xcrun', 'iconutil', 'plutil', 'codesign']) source = source.replaceAll(`/usr/bin/${name}`, JSON.stringify(path.join(tools, name)))
  source = source.replaceAll('/usr/libexec/PlistBuddy', JSON.stringify(path.join(tools, 'PlistBuddy')))
  source = source.replace(/keytist_lsregister='[^']+'/u, `keytist_lsregister=${JSON.stringify(path.join(tools, 'lsregister'))}`)
  fs.writeFileSync(path.join(directory, 'scripts/install-macos-app.sh'), source)
  fs.writeFileSync(path.join(directory, 'scripts/macos/launcher-config.mjs'), `import fs from 'node:fs'; import { launcherConfiguration } from ${JSON.stringify(configurationModule)}; const [repositoryPath, nodePath, output, previous] = process.argv.slice(2); fs.writeFileSync(output, JSON.stringify(launcherConfiguration({ repositoryPath, nodePath, previous: JSON.parse(fs.readFileSync(previous, 'utf8')) })));`)
  function install(stage = '', options = []) {
    return spawnSync('/bin/bash', ['scripts/install-macos-app.sh', ...options], { cwd: directory, encoding: 'utf8', env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, APP_DIR: appDirectory, TEST_STATE: directory, FAIL_STAGE: stage } })
  }
  function events() {
    const file = path.join(directory, 'events')
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
  }
  try {
    run({ directory, apps, previous, addApp, install, events })
  }
  finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('installer refuses an unrelated destination without altering either app', () => fixture(({ apps, addApp, install, events }) => {
  addApp(apps.current, 'other.application')
  addApp(apps.legacy)
  const result = install()
  assert.equal(result.status, 1, result.stderr)
  assert.ok(fs.existsSync(path.join(apps.current, 'original-marker')))
  assert.ok(fs.existsSync(path.join(apps.legacy, 'original-marker')))
  assert.deepEqual(events(), [])
}))

for (const stage of ['sign', 'precheck', 'register', 'installed-check', 'legacy-unregister', 'legacy-move']) {
  test(`installer rolls back both apps after ${stage} failure`, () => fixture(({ directory, apps, addApp, install, events }) => {
    addApp(apps.current)
    addApp(apps.legacy)
    const before = fs.readFileSync(path.join(apps.current, 'Contents/Resources/launcher.json'), 'utf8')
    const result = install(stage)
    assert.notEqual(result.status, 0, result.stdout + result.stderr)
    for (const app of Object.values(apps)) {
      assert.equal(fs.readFileSync(path.join(app, 'original-marker'), 'utf8'), app)
      assert.equal(fs.readFileSync(path.join(app, 'Contents/Resources/launcher.json'), 'utf8'), before)
    }
    assert.deepEqual(fs.readdirSync(path.dirname(apps.current)).filter(name => name.startsWith('.Keytist-install.')), [])
    const changes = events()
    if (['register', 'installed-check', 'legacy-unregister', 'legacy-move'].includes(stage)) {
      assert.ok(changes.some(event => event[1] === '-u' && event[2] === apps.current), JSON.stringify(changes))
      assert.ok(changes.some(event => event[1] === '-f' && event[2] === apps.current), JSON.stringify(changes))
    }
    if (['legacy-unregister', 'legacy-move'].includes(stage)) {
      assert.ok(changes.some(event => event[1] === '-f' && event[2] === apps.legacy), JSON.stringify(changes))
    }
    assert.equal(fs.existsSync(path.join(directory, 'existing-output')), false)
  }))
}

test('staging preserves legacy entry and configuration without registering apps', () => fixture(({ apps, previous, addApp, install, events }) => {
  addApp(apps.legacy)
  const result = install('', ['--staging-only'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(fs.existsSync(path.join(apps.legacy, 'original-marker')))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(apps.current, 'Contents/Resources/launcher.json'), 'utf8')), previous)
  assert.deepEqual(events(), [])
}))

test('successful migration retires only the verified legacy entry', () => fixture(({ apps, previous, addApp, install, events }) => {
  addApp(apps.legacy)
  const result = install()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(fs.existsSync(apps.legacy), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(apps.current, 'Contents/Resources/launcher.json'), 'utf8')), previous)
  assert.deepEqual(events(), [['lsregister', '-f', apps.current], ['lsregister', '-u', apps.legacy]])
}))
