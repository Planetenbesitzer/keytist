/* eslint-env node, es2021 */
import fs from 'node:fs/promises'
import { constants, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'

export const MAX_FILE_BYTES = 200 * 1024 * 1024
const extensions = new Set(['.json', '.pptx', '.png', '.jpeg', '.jpg', '.pptist', '.pdf'])

export class LocalFileError extends Error {
  constructor(status, message, code) {
    super(message); this.status = status; this.code = code
  }
}

const conflict = () => new LocalFileError(409, '文件已在外部修改或替换。请另存为新文件，避免覆盖。', 'REVISION_CONFLICT')
const equalSecret = (actual, expected) => {
  if (typeof actual !== 'string') return false
  const received = Buffer.from(actual), trusted = Buffer.from(expected)
  return received.length === trusted.length && crypto.timingSafeEqual(received, trusted)
}
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs

export function resolveLocalFileDirectories({ outputDirectory, settingsDirectory, home = os.homedir(), env = process.env, exists = existsSync, readDirectory = readdirSync } = {}) {
  const legacyOutput = path.join(home, 'Documents', 'Code', 'SlidesStudio', 'output')
  const legacySettings = path.join(home, 'Library', 'Application Support', 'Slide Studio')
  const defaultOutput = () => {
    if (exists(legacyOutput)) return legacyOutput
    const codeDirectory = path.join(home, 'Documents', 'Code')
    let entries
    try {
      entries = readDirectory(codeDirectory)
    }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      entries = []
    }
    // existsSync cannot distinguish these spellings on a case-insensitive disk.
    // Keep the spelling of an existing installation so its path-based save keys
    // agree with the launcher; genuinely fresh installations use lowercase.
    const folder = entries.includes('keytist') ? 'keytist' : entries.includes('Keytist') ? 'Keytist' : 'keytist'
    return path.join(codeDirectory, folder, 'output')
  }
  return {
    outputDirectory: path.resolve(outputDirectory || env.STUDIO_OUTPUT_DIR || defaultOutput()),
    settingsDirectory: path.resolve(settingsDirectory || env.STUDIO_SETTINGS_DIR || (exists(legacySettings) ? legacySettings : path.join(home, 'Library', 'Application Support', 'Keytist'))),
  }
}

export function validateFileName(value) {
  if (typeof value !== 'string' || !value.trim() || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || [...value].some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127) || Buffer.byteLength(value) > 240 || path.basename(value) !== value) {
    throw new LocalFileError(400, '文件名无效，请使用不含路径的文件名。', 'INVALID_NAME')
  }
  if (!extensions.has(path.extname(value).toLowerCase())) throw new LocalFileError(400, '不支持此文件类型。', 'INVALID_EXTENSION')
  return value
}

async function durableSecret(settingsDirectory) {
  await fs.mkdir(settingsDirectory, { recursive: true, mode: 0o700 })
  const filename = path.join(settingsDirectory, 'save-key')
  let handle
  try {
    handle = await fs.open(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    const secret = crypto.randomBytes(32)
    await handle.writeFile(secret)
    await handle.sync()
    return secret
  }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const existing = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await existing.stat()
      if (!stat.isFile() || stat.size !== 32) throw new Error('本地保存密钥无效，请检查 Keytist 设置目录。')
      await existing.chmod(0o600)
      return await existing.readFile()
    }
    finally {
      await existing.close()
    }
  }
  finally {
    if (handle) await handle.close()
  }
}

export async function createLocalFileStore(options = {}) {
  const { outputDirectory: configuredDirectory, settingsDirectory } = resolveLocalFileDirectories(options)
  const maxBytes = options.maxBytes || MAX_FILE_BYTES
  await fs.mkdir(configuredDirectory, { recursive: true, mode: 0o700 })
  const outputDirectory = await fs.realpath(configuredDirectory)
  const directoryStat = await fs.lstat(configuredDirectory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('输出目录不能通过符号链接指向其他位置。')
  const secret = await durableSecret(settingsDirectory)
  const token = crypto.randomBytes(32).toString('hex')
  const locks = new Map()
  const fileKey = name => crypto.createHmac('sha256', secret).update(`SlideStudio:1\0${outputDirectory}\0${name}`).digest('base64url')
  const assertDirectory = async () => {
    const stat = await fs.lstat(outputDirectory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(outputDirectory) !== outputDirectory || stat.dev !== directoryStat.dev || stat.ino !== directoryStat.ino) throw new LocalFileError(409, '输出目录已被替换，请重新启动后重试。', 'DIRECTORY_CHANGED')
  }
  const withFileLock = async (name, operation) => {
    const previous = locks.get(name) || Promise.resolve()
    let release
    const current = new Promise(resolve => {
      release = resolve
    })
    locks.set(name, current)
    await previous
    try {
      return await operation()
    }
    finally {
      release(); if (locks.get(name) === current) locks.delete(name)
    }
  }
  const currentFile = async filename => {
    let handle
    try {
      handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
      const before = await handle.stat({ bigint: true })
      if (!before.isFile() || before.size > BigInt(maxBytes)) throw conflict()
      const hash = crypto.createHash('sha256')
      const chunk = Buffer.alloc(256 * 1024)
      let position = 0
      for (;;) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
        if (!bytesRead) break
        hash.update(chunk.subarray(0, bytesRead)); position += bytesRead
      }
      const after = await handle.stat({ bigint: true })
      if (!sameFile(before, after)) throw conflict()
      return { stat: after, revision: hash.digest('hex') }
    }
    catch (error) {
      if (['ENOENT', 'ELOOP', 'EISDIR'].includes(error.code)) throw conflict()
      throw error
    }
    finally {
      if (handle) await handle.close()
    }
  }
  const save = (name, body, binding = {}) => {
    validateFileName(name)
    if (!Buffer.isBuffer(body) || !body.length || body.length > maxBytes) throw new LocalFileError(body?.length > maxBytes ? 413 : 400, '文件内容为空或超过 200 MB 限制。', 'INVALID_BODY')
    const bound = binding.fileKey !== undefined || binding.revision !== undefined
    if (bound && (!equalSecret(binding.fileKey, fileKey(name)) || !/^[a-f0-9]{64}$/.test(binding.revision || ''))) throw conflict()
    return withFileLock(name, async () => {
      await assertDirectory()
      const temporary = path.join(outputDirectory, `.slidestudio-${crypto.randomBytes(18).toString('hex')}.tmp`)
      let pending = true
      try {
        const handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
        try {
          await handle.writeFile(body); await handle.sync()
        }
        finally {
          await handle.close()
        }
        let savedName = name
        if (bound) {
          const destination = path.join(outputDirectory, name)
          const existing = await currentFile(destination)
          if (!equalSecret(binding.revision, existing.revision)) throw conflict()
          await assertDirectory()
          let latest
          try {
            latest = await fs.lstat(destination, { bigint: true })
          }
          catch {
            throw conflict()
          }
          if (latest.isSymbolicLink() || !sameFile(existing.stat, latest)) throw conflict()
          await fs.rename(temporary, destination)
        }
        else {
          const extension = path.extname(name)
          const stem = name.slice(0, -extension.length)
          for (let index = 1; ; index++) {
            if (index > 10000) throw new LocalFileError(409, '同名文件过多，请更换文件名。', 'NAME_COLLISION')
            const suffix = index === 1 ? '' : ` (${index})`
            const stemBudget = 240 - Buffer.byteLength(extension) - Buffer.byteLength(suffix)
            let shortenedStem = '', stemBytes = 0
            for (const char of stem) {
              const bytes = Buffer.byteLength(char)
              if (stemBytes + bytes > stemBudget) break
              shortenedStem += char
              stemBytes += bytes
            }
            savedName = `${shortenedStem}${suffix}${extension}`
            await assertDirectory()
            try {
              await fs.link(temporary, path.join(outputDirectory, savedName)); break
            }
            catch (error) {
              if (error.code !== 'EEXIST') throw error
            }
          }
          await fs.unlink(temporary)
        }
        pending = false
        try {
          const directory = await fs.open(outputDirectory, constants.O_RDONLY); try {
            await directory.sync()
          }
          finally {
            await directory.close()
          }
        }
        catch { /* Some filesystems do not support directory fsync. The file itself is already synced. */ }
        return { fileName: savedName, path: path.join(outputDirectory, savedName), fileKey: fileKey(savedName), revision: crypto.createHash('sha256').update(body).digest('hex') }
      }
      finally {
        if (pending) await fs.unlink(temporary).catch(() => {})
      }
    })
  }
  return { outputDirectory, token, maxBytes, save, authenticate: value => equalSecret(value, token) }
}

export function validateLocalRequest(req, port) {
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new LocalFileError(403, '此请求不是本机应用地址。', 'INVALID_HOST')
  const origin = req.headers.origin
  if (origin !== undefined && origin !== `http://${host}`) throw new LocalFileError(403, '不允许来自其他网页的保存请求。', 'INVALID_ORIGIN')
}

export function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}

export function readBody(req, maxBytes) {
  if (Number(req.headers['content-length']) > maxBytes) {
    req.resume(); throw new LocalFileError(413, '文件超过 200 MB 限制。', 'BODY_TOO_LARGE')
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let length = 0
    const cleanup = () => {
      req.off('data', data); req.off('end', end); req.off('aborted', aborted); req.off('error', error)
    }
    const error = reason => {
      cleanup(); reject(reason)
    }
    const aborted = () => error(new LocalFileError(400, '文件上传已中断，请重试。', 'UPLOAD_ABORTED'))
    const data = chunk => {
      length += chunk.length
      if (length > maxBytes) {
        cleanup(); req.resume(); reject(new LocalFileError(413, '文件超过 200 MB 限制。', 'BODY_TOO_LARGE')); return
      }
      chunks.push(chunk)
    }
    const end = () => {
      cleanup(); resolve(Buffer.concat(chunks, length))
    }
    req.on('data', data); req.on('end', end); req.on('aborted', aborted); req.on('error', error)
  })
}

export function createLocalFilesHandler(store, getPort) {
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/local/')) return false
    // A disconnected upload may emit another stream error after its promise
    // has rejected. It must not terminate the local server while draining.
    req.on('error', () => {})
    validateLocalRequest(req, getPort())
    if (url.pathname === '/api/local/config' && req.method === 'GET') {
      sendJson(res, 200, { version: 1, outputDirectory: store.outputDirectory, token: store.token, pdfSupported: false })
      return true
    }
    if (url.pathname === '/api/local/files' && req.method === 'POST') {
      if (!store.authenticate(req.headers['x-slidestudio-token'])) throw new LocalFileError(403, '本地保存凭证已失效，请刷新后重试。', 'INVALID_TOKEN')
      const name = validateFileName(url.searchParams.get('name'))
      const binding = { fileKey: req.headers['x-slidestudio-file-key'], revision: req.headers['x-slidestudio-revision'] }
      const body = await readBody(req, store.maxBytes)
      sendJson(res, 200, await store.save(name, body, binding))
      return true
    }
    throw new LocalFileError(404, '本地接口不存在。', 'NOT_FOUND')
  }
}
