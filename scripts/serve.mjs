/* eslint-env node */
/* eslint-disable no-console */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { createLocalFileStore, createLocalFilesHandler, validateLocalRequest, sendJson } from './local-files.mjs'
import { generateLocalFontCatalog } from './font-catalog.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const port = Number(process.env.STUDIO_PORT || 4178)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ttc': 'font/collection', '.ico': 'image/x-icon' }
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('请先运行 npm run build。'); process.exit(1)
}
try {
  const catalog = await generateLocalFontCatalog({ distDirectory: root })
  if (catalog.warnings.length) console.warn(`有 ${catalog.warnings.length} 项本机字体无法读取；发布 HTML 时会检查并提示。`)
}
catch {
  console.warn('本机字体目录暂不可用；文稿保存不受影响，发布 HTML 时请根据提示导入所需字体。')
}
const fileStore = await createLocalFileStore()
const server = http.createServer(async (req, res) => {
  let requestUrl
  try {
    validateLocalRequest(req, server.address()?.port || port)
    requestUrl = new URL(req.url, `http://127.0.0.1:${server.address()?.port || port}`)
    if (await localFiles(req, res, requestUrl)) return
  }
  catch (error) {
    req.resume()
    sendJson(res, error.status || 500, { error: error.status ? error.message : '本地保存失败，请检查输出目录权限后重试。', ...(error.code && error.status ? { code: error.code } : {}) })
    return
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405);res.end();return
  }
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  }
  catch {
    res.writeHead(400);res.end();return
  }
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    res.writeHead(403);res.end();return
  }
  fs.stat(filename, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);res.end('Not found');return
    }
    res.writeHead(200, {'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'})
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(filename).pipe(res)
  })
})
const localFiles = createLocalFilesHandler(fileStore, () => server.address()?.port || port)
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.log(`Keytist 已在 http://127.0.0.1:${port} 运行。`);if (process.argv.includes('--open')) execFile('open', [`http://127.0.0.1:${port}`]);process.exit(0)
  }
  console.error(error);process.exit(1)
})
server.listen(port, '127.0.0.1', () => {
  const actualPort = server.address()?.port || port
  console.log(`Keytist · http://127.0.0.1:${actualPort}\n文稿保存在本机。保持此窗口开启；按 Control-C 退出。`)
  if (process.argv.includes('--open')) execFile('open', [`http://127.0.0.1:${actualPort}`])
})
