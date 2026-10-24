/* eslint-env node */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import JSZip from 'jszip'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version in package.json.')
const archive = path.resolve(process.argv[2] || path.join(os.homedir(), `Documents/Code/SlidesStudio/Slide-Studio-${version}-share.zip`))
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-package-'))
const bundle = path.join(temporary, 'Slide-Studio')
const partial = `${archive}.partial.zip`
let ownsPartial = false
const exists = async file => {
  try {
    await fs.access(file); return true
  }
  catch (error) {
    if (error.code === 'ENOENT') return false; throw error
  }
}
const ignored = new Set(['.DS_Store', 'node_modules', '.git', '.vite', 'verification', 'verification.html', 'output', 'local-fonts'])
const assertNoLocalFonts = names => {
  if (names.some(name => name.split(/[\\/]/).includes('local-fonts'))) throw new Error('Private local-fonts files must not enter a share package.')
}

async function buildShareVariant() {
  // Only the staged distribution changes. The local editor keeps its font menu.
  // These two converted upstream font files lack a confirmed distribution chain.
  const omittedFonts = ['AlibabaPuHuiTi', 'MiSans']
  const cssFile = path.join(bundle, 'src/assets/styles/font.scss')
  const menuFile = path.join(bundle, 'src/configs/font.ts')
  let css = await fs.readFile(cssFile, 'utf8'), menu = await fs.readFile(menuFile, 'utf8')
  for (const name of omittedFonts) {
    await fs.rm(path.join(bundle, 'src/assets/fonts', `${name}.woff2`), { force: true })
    css = css.replaceAll(`'${name}', `, '')
    menu = menu.split('\n').filter(line => !line.includes(`value: '${name}'`)).join('\n')
  }
  await fs.writeFile(cssFile, css)
  await fs.writeFile(menuFile, menu)
  const metadataFile = path.join(bundle, 'src/configs/bundledFontMetadata.json')
  const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'))
  metadata.fonts = metadata.fonts.filter(font => !omittedFonts.includes(font.key))
  await fs.writeFile(metadataFile, JSON.stringify(metadata) + '\n')
  const schemaFile = path.join(bundle, 'doc/AI_PPT_SCHEMA.md')
  await fs.writeFile(schemaFile, (await fs.readFile(schemaFile, 'utf8')).split('\n').filter(line => !line.includes('`MiSans`')).join('\n'))
  await fs.writeFile(path.join(bundle, '分享包说明.md'), '# 分享包说明\n\n本包包含完整源码和根据随包源码重新构建的应用。为避免转分发来源不明的字体文件，分享包没有附带上游的阿里巴巴普惠体与 MiSans，两者的预置菜单项也已移除。Helvetica Neue、Times New Roman、Apple Chancery、Arial 等常用系统字体的选择方式不变，可继续导入接收者自己的字体文件。其余预置字体及依赖的许可材料见 doc/THIRD_PARTY_NOTICES.md 和 doc/third-party/。\n\n包内不含发送者的个人文稿、浏览器数据、本机系统字体、local-fonts 目录、Git 历史或 node_modules。启动时会仅为接收者本机字体生成小型目录与文件链接，不复制整套系统字体；发布 HTML 时自动携带所需的英文和公式字体，暂不额外打包中文字库。中文仍保留，使用播放设备字体，字形和换行可能不同；文稿和网页本来已内嵌的字体资源仍会保留。无法取得所需英文字体或数学字符时会提示处理。Node.js 运行环境需自行安装；有了 Node.js 即可直接启动，无需安装项目依赖。\n')
  const link = path.join(bundle, 'node_modules')
  await fs.symlink(path.join(root, 'node_modules'), link, 'dir')
  try {
    const checks = await Promise.allSettled([
      run(process.execPath, [path.join(root, 'node_modules/vue-tsc/bin/vue-tsc.js'), '--build', '--force'], { cwd: bundle, maxBuffer: 8 * 1024 * 1024 }),
      run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: bundle, maxBuffer: 8 * 1024 * 1024 }),
    ])
    for (const result of checks) if (result.status === 'rejected') throw result.reason
  }
  finally {
    await fs.rm(link, { force: true })
    for (const name of ['tsconfig.app.tsbuildinfo', 'tsconfig.node.tsbuildinfo']) await fs.rm(path.join(bundle, name), { force: true })
  }
}

async function dependencyLicenses() {
  const target = path.join(bundle, 'doc/third-party/dependencies')
  await fs.mkdir(target, { recursive: true })
  const records = []
  async function collect(directory) {
    if (!await exists(directory)) return
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const location = path.join(directory, entry.name)
      if (entry.name.startsWith('@')) {
        await collect(location); continue
      }
      const metadata = path.join(location, 'package.json')
      if (!await exists(metadata)) continue
      const information = JSON.parse(await fs.readFile(metadata, 'utf8'))
      const key = `${information.name.replaceAll('/', '__')}@${information.version}`
      if (!records.some(record => record.key === key)) {
        const files = (await fs.readdir(location, { withFileTypes: true })).filter(file => file.isFile() && /^(license|licence|copying|notice|ofl|authors)(?:[._-].*)?$/i.test(file.name)).map(file => file.name)
        if (typeof information.license === 'string' && information.license.startsWith('SEE LICENSE IN ')) {
          const named = information.license.slice('SEE LICENSE IN '.length)
          if (path.basename(named) === named && await exists(path.join(location, named)) && !files.includes(named)) files.push(named)
        }
        if (files.length) await fs.mkdir(path.join(target, key), { recursive: true })
        for (const name of files) await fs.copyFile(path.join(location, name), path.join(target, key, name))
        records.push({ key, name: information.name, version: information.version, license: information.license || information.licenses || 'See package source', files })
      }
      await collect(path.join(location, 'node_modules'))
    }
  }
  await collect(path.join(root, 'node_modules'))
  if (!records.length) throw new Error('Install the development dependencies before packaging, so their notices can be included.')
  records.sort((a, b) => a.key.localeCompare(b.key))
  await fs.writeFile(path.join(target, 'INDEX.json'), JSON.stringify(records, null, 2) + '\n')
  await fs.writeFile(path.join(target, 'README.md'), '# Dependency license files\n\nOriginal license and notice files from the installed dependency versions are preserved in this directory. The index also includes development tools; runtime dependencies are already bundled in dist. Package metadata is recorded as supplied by its authors. Full dependency resolution and registry integrity values are in package-lock.json.\n')
  return records.length
}

async function manifest(directory, relative = '') {
  const lines = []
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name), name = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) lines.push(...await manifest(file, name))
    else {
      if (!entry.isFile()) throw new Error(`Unexpected non-file in bundle: ${name}`)
      const hash = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')
      lines.push(`${hash}  ${name}`)
    }
  }
  return lines
}

async function zipBundle() {
  const zip = new JSZip()
  async function add(directory, relative = 'Slide-Studio') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), name = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) await add(file, name)
      else {
        const stat = await fs.stat(file)
        zip.file(name, await fs.readFile(file), { unixPermissions: stat.mode, date: stat.mtime })
      }
    }
  }
  await add(bundle)
  assertNoLocalFonts(Object.keys(zip.files))
  const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 9 } })
  await fs.writeFile(partial, bytes, { flag: 'wx' })
  ownsPartial = true
}

try {
  if (await exists(archive) || await exists(partial)) throw new Error('The output already exists. Choose a new archive filename.')
  await fs.mkdir(bundle)
  for (const name of ['src', 'public', 'dist', 'doc', 'scripts']) {
    await fs.cp(path.join(root, name), path.join(bundle, name), { recursive: true, filter: file => !ignored.has(path.basename(file)) && !file.endsWith('.tsbuildinfo') })
  }
  const files = ['LICENSE', 'README.md', 'README_zh.md', '开始使用.md', 'package.json', 'package-lock.json', 'index.html', 'env.d.ts', 'vite.config.ts', 'tsconfig.app.json', 'tsconfig.json', 'tsconfig.node.json', 'components.d.ts', '.gitignore', '.eslintrc.cjs', 'commitlint.config.cjs', '启动 Slide Studio.command', '安装到应用程序.command', 'Start Slide Studio.bat', 'start-slides-studio.sh']
  for (const name of files) await fs.copyFile(path.join(root, name), path.join(bundle, name))
  await fs.mkdir(path.join(bundle, 'examples'))
  for (const name of ['我的第一份演示.json', 'HTML演示示例.html']) await fs.copyFile(path.join(root, 'examples', name), path.join(bundle, 'examples', name))
  for (const name of ['启动 Slide Studio.command', '安装到应用程序.command', 'start-slides-studio.sh', 'scripts/install-macos-app.sh']) await fs.chmod(path.join(bundle, name), 0o755)
  await buildShareVariant()
  const dependencyCount = await dependencyLicenses()
  const entries = await manifest(bundle)
  assertNoLocalFonts(entries.map(entry => entry.slice(entry.indexOf('  ') + 2)))
  await fs.writeFile(path.join(bundle, 'SHA256SUMS.txt'), entries.join('\n') + '\n')
  await fs.mkdir(path.dirname(archive), { recursive: true })
  await zipBundle()
  await run('unzip', ['-tq', partial])
  const names = (await run('unzip', ['-Z1', partial], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim().split('\n')
  assertNoLocalFonts(names)
  await fs.rename(partial, archive)
  const bytes = (await fs.stat(archive)).size
  const sha256 = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex')
  process.stdout.write(JSON.stringify({ archive, files: entries.length + 1, dependencyCount, bytes, sha256 }, null, 2) + '\n')
}
finally {
  await fs.rm(temporary, { recursive: true, force: true })
  if (ownsPartial) await fs.rm(partial, { force: true })
}
