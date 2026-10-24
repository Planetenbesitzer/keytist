/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createLocalFileStore, createLocalFilesHandler, sendJson } from '../local-files.mjs'

const fixture = async (t, options = {}) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-files-test-'))
  const outputDirectory = path.join(directory, 'output')
  const settingsDirectory = path.join(directory, 'settings')
  let server
  const start = async () => {
    const store = await createLocalFileStore({ outputDirectory, settingsDirectory, ...options })
    server = http.createServer(async (req, res) => {
      try {
        if (!await handler(req, res, new URL(req.url, 'http://localhost'))) sendJson(res, 404, { error: 'Not found' })
      }
      catch (error) {
        req.resume(); sendJson(res, error.status || 500, { error: error.message, code: error.code })
      }
    })
    const handler = createLocalFilesHandler(store, () => server.address().port)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const request = async (pathname, options = {}) => {
      const response = await fetch(origin + pathname, options)
      return { status: response.status, headers: response.headers, body: await response.json() }
    }
    const config = (await request('/api/local/config')).body
    const save = (name, body, binding, headers = {}) => request(`/api/local/files?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'X-SlideStudio-Token': config.token, ...(binding ? { 'X-SlideStudio-File-Key': binding.fileKey, 'X-SlideStudio-Revision': binding.revision } : {}), ...headers }, body })
    return { store, config, request, save, origin }
  }
  const stop = async () => {
    if (server) {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = undefined
    }
  }
  t.after(async () => {
    await stop(); await fs.rm(directory, { recursive: true, force: true })
  })
  return { ...(await start()), directory, outputDirectory, settingsDirectory, restart: async () => {
    await stop(); return start()
  } }
}

test('real HTTP config, new save, collision, bound update and durable restart', async t => {
  const f = await fixture(t)
  assert.equal(f.config.version, 1)
  assert.equal(f.config.outputDirectory, await fs.realpath(f.outputDirectory))
  const config = await f.request('/api/local/config')
  assert.match(config.headers.get('cache-control'), /no-store/)
  assert.equal(config.headers.get('access-control-allow-origin'), null)
  const first = await f.save('研究文稿.json', '{"slides":[]}')
  assert.equal(first.status, 200)
  assert.equal(first.body.fileName, '研究文稿.json')
  assert.equal(await fs.readFile(first.body.path, 'utf8'), '{"slides":[]}')
  const duplicate = await f.save('研究文稿.json', 'second')
  assert.equal(duplicate.body.fileName, '研究文稿 (2).json')
  assert.equal(await fs.readFile(first.body.path, 'utf8'), '{"slides":[]}')
  const updated = await f.save(first.body.fileName, 'updated', first.body)
  assert.equal(updated.status, 200)
  assert.equal(updated.body.path, first.body.path)
  assert.equal(updated.body.fileKey, first.body.fileKey)
  assert.notEqual(updated.body.revision, first.body.revision)
  const secret = path.join(f.settingsDirectory, 'save-key')
  assert.equal((await fs.stat(secret)).mode & 0o777, 0o600)
  const secretBefore = await fs.readFile(secret)
  const restarted = await f.restart()
  assert.notEqual(restarted.config.token, f.config.token)
  assert.deepEqual(await fs.readFile(secret), secretBefore)
  const persisted = await restarted.save(updated.body.fileName, 'after restart', updated.body)
  assert.equal(persisted.status, 200)
  assert.equal(await fs.readFile(persisted.body.path, 'utf8'), 'after restart')
})

test('external revisions, concurrent same-revision writes and invalid bindings never overwrite', async t => {
  const f = await fixture(t)
  const created = (await f.save('sample.json', 'one')).body
  await fs.writeFile(created.path, 'external')
  const conflict = await f.save('sample.json', 'must not win', created)
  assert.equal(conflict.status, 409)
  assert.equal(await fs.readFile(created.path, 'utf8'), 'external')
  const fresh = (await f.save('race.json', 'initial')).body
  const raced = await Promise.all([f.save('race.json', 'left', fresh), f.save('race.json', 'right', fresh)])
  assert.deepEqual(raced.map(item => item.status).sort(), [200, 409])
  assert.equal((await f.save('other.json', 'forged', fresh)).status, 409)
  assert.equal((await f.save('race.json', 'forged', { fileKey: 'x'.repeat(43), revision: fresh.revision })).status, 409)
})

test('240-byte Chinese and emoji collisions remain valid for later bound saves', async t => {
  const f = await fixture(t)
  for (const stem of ['研'.repeat(78) + 'a', '😀'.repeat(58) + 'abc']) {
    const name = `${stem}.json`
    assert.equal(Buffer.byteLength(stem), 235)
    assert.equal(Buffer.byteLength(name), 240)
    const first = await f.save(name, 'original')
    assert.equal(first.status, 200)
    assert.equal(first.body.fileName, name)
    const duplicate = await f.save(name, 'duplicate')
    assert.equal(duplicate.status, 200)
    assert.match(duplicate.body.fileName, / \(2\)\.json$/)
    assert.ok(Buffer.byteLength(duplicate.body.fileName) <= 240)
    assert.equal(Buffer.from(duplicate.body.fileName).toString('utf8'), duplicate.body.fileName)
    const expectedStem = stem.startsWith('研') ? '研'.repeat(77) : '😀'.repeat(57)
    assert.equal(duplicate.body.fileName, `${expectedStem} (2).json`)
    const updated = await f.save(duplicate.body.fileName, 'updated duplicate', duplicate.body)
    assert.equal(updated.status, 200)
    assert.equal(updated.body.path, duplicate.body.path)
    assert.equal(await fs.readFile(updated.body.path, 'utf8'), 'updated duplicate')
    assert.equal(await fs.readFile(first.body.path, 'utf8'), 'original')
  }
})

test('request boundary rejects bad origin, null origin, host, token, names, extensions and oversized body', async t => {
  const f = await fixture(t, { maxBytes: 1024 })
  const valid = { 'X-SlideStudio-Token': f.config.token }
  for (const origin of ['https://evil.example', 'null']) {
    assert.equal((await f.save('x.json', '{}', undefined, { Origin: origin })).status, 403)
    assert.equal((await f.request('/api/local/config', { headers: { Origin: origin } })).status, 403)
  }
  const wrongHost = await new Promise((resolve, reject) => {
    const req = http.request(`${f.origin}/api/local/config`, { headers: { Host: 'evil.example' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject); req.end()
  })
  assert.equal(wrongHost, 403)
  assert.equal((await f.request('/api/local/files?name=x.json', { method: 'POST', body: '{}' })).status, 403)
  assert.equal((await f.save('x.json', '{}', undefined, { 'X-SlideStudio-Token': 'bad' })).status, 403)
  for (const name of ['../escape.json', '..\\escape.json', '/absolute.json', 'nested/a.json', 'script.js', 'bad\u0000.json']) assert.equal((await f.save(name, '{}')).status, 400)
  assert.equal((await f.save('x.json', Buffer.alloc(1025))).status, 413)
  assert.equal((await f.save('x.json', '')).status, 400)
  assert.equal((await f.save('x.json', '{}', undefined, { Origin: f.origin })).status, 200)
  const chunked = await new Promise((resolve, reject) => {
    const req = http.request(`${f.origin}/api/local/files?name=chunked.json`, { method: 'POST', headers: valid }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject); req.write(Buffer.alloc(700)); req.end(Buffer.alloc(700))
  })
  assert.equal(chunked, 413)
  assert.deepEqual((await fs.readdir(f.outputDirectory)).filter(name => name.endsWith('.tmp')), [])
})

test('symlink targets and replaced output directories cannot escape the output folder', async t => {
  const f = await fixture(t)
  const outside = path.join(f.directory, 'outside.json')
  await fs.writeFile(outside, 'keep me')
  await fs.symlink(outside, path.join(f.outputDirectory, 'linked.json'))
  const collision = await f.save('linked.json', 'new')
  assert.equal(collision.status, 200)
  assert.equal(collision.body.fileName, 'linked (2).json')
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep me')
  const bound = (await f.save('bound.json', 'original')).body
  await fs.unlink(bound.path); await fs.symlink(outside, bound.path)
  assert.equal((await f.save('bound.json', 'overwrite attempt', bound)).status, 409)
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep me')
  const moved = path.join(f.directory, 'moved')
  await fs.rename(f.outputDirectory, moved); await fs.symlink(f.directory, f.outputDirectory)
  assert.equal((await f.save('escape.json', 'no')).status, 409)
  await assert.rejects(fs.stat(path.join(f.directory, 'escape.json')), { code: 'ENOENT' })
})

test('actual serve entry preserves static pages and harmless duplicate startup', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-entry-test-'))
  const project = path.join(directory, 'project')
  await fs.mkdir(path.join(project, 'scripts'), { recursive: true })
  await fs.mkdir(path.join(project, 'dist'))
  for (const name of ['serve.mjs', 'local-files.mjs', 'font-catalog.mjs']) await fs.copyFile(new URL(`../${name}`, import.meta.url), path.join(project, 'scripts', name))
  await fs.writeFile(path.join(project, 'dist/index.html'), '<!doctype html><title>Slide Studio isolated server entry</title>')
  const probe = http.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const env = { ...process.env, STUDIO_PORT: String(port), STUDIO_OUTPUT_DIR: path.join(directory, 'output'), STUDIO_SETTINGS_DIR: path.join(directory, 'settings') }
  const children = []
  const start = () => {
    const child = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    return child
  }
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await Promise.all(children.filter(child => child.exitCode === null && child.signalCode === null).map(child => new Promise(resolve => child.once('exit', resolve))))
    await fs.rm(directory, { recursive: true, force: true })
  })
  const first = start()
  let log = ''
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated server startup timed out')), 5000)
    first.stdout.on('data', chunk => {
      log += chunk; if (log.includes(`127.0.0.1:${port}`)) {
        clearTimeout(timer); resolve()
      }
    })
    first.once('error', reject)
    first.once('exit', code => {
      if (!log.includes(`127.0.0.1:${port}`)) {
        clearTimeout(timer); reject(new Error(`Server exited ${code}`))
      }
    })
  })
  const origin = `http://127.0.0.1:${port}`
  const config = await (await fetch(`${origin}/api/local/config`)).json()
  assert.equal(config.version, 1)
  const index = await fetch(origin)
  assert.equal(index.status, 200)
  assert.match(await index.text(), /<title>Slide Studio/)
  assert.equal((await fetch(`${origin}/not-an-api`, { method: 'POST', body: '{}' })).status, 405)
  const saved = await fetch(`${origin}/api/local/files?name=entry.json`, { method: 'POST', headers: { 'X-SlideStudio-Token': config.token }, body: '{"entry":true}' })
  assert.equal(saved.status, 200)
  const second = start()
  const duplicateCode = await new Promise((resolve, reject) => {
    second.once('exit', resolve); second.once('error', reject)
  })
  assert.equal(duplicateCode, 0)
  assert.equal((await fetch(origin)).status, 200)
})
