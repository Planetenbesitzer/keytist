/** The payload is inert JSON. Importing it never runs the presentation's scripts. */
export const COMPACT_HTML_MARKER_ID = 'slide-studio-compact'
export const COMPACT_HTML_MAX_BYTES = 512 * 1024 * 1024

interface CompactManifest {
  version: 1
  encoding: 'gzip-base64'
  editable: boolean
  payload: string
}

const dataUrlPattern = /data:(?:[a-z0-9.+-]+\/[a-z0-9.+-]+)?(?:;[a-z0-9.+-]+=[a-z0-9.+%-]+)*;base64,[a-z0-9+/]+={0,2}/gi

const utf8Size = (value: string) => {
  let size = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x80) size++
    else if (code < 0x800) size += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      size += 4
      index++
    }
    else size += 3
  }
  return size
}

const readStream = async (stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) throw new Error('HTML 内容超过 512 MiB 安全上限，未生成文件')
      chunks.push(value)
    }
  }
  catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

const encodeBase64 = (bytes: Uint8Array) => {
  const chunks: string[] = []
  // The chunk size is divisible by three, so only the last chunk is padded.
  for (let index = 0; index < bytes.byteLength; index += 24576) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(index, index + 24576))))
  }
  return chunks.join('')
}

/** Keep this function self-contained: its compiled source also runs in the
 * exported file, without the editor, external libraries, or network access.
 * The smaller limit is a test seam; production callers use the fixed default. */
export async function decodeCompactHtmlManifest(input: unknown, maxBytes = 512 * 1024 * 1024): Promise<string> {
  const fail = (message: string): never => {
    throw new Error(`紧凑 HTML：${message}`)
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 512 * 1024 * 1024) fail('无效的读取上限')
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
  if (!record(input) || !exactKeys(input, ['version', 'encoding', 'editable', 'payload'])) fail('文件头格式无效')
  const manifest = input as Record<string, unknown>
  if (manifest.version !== 1) fail('不支持此文件版本，请使用新版 Keytist')
  if (manifest.encoding !== 'gzip-base64') fail('不支持此压缩编码')
  if (typeof manifest.editable !== 'boolean' || typeof manifest.payload !== 'string') fail('文件头字段无效')
  const encoded = manifest.payload as string
  // Avoid a repeated capture/group here: multi-megabyte base64 must not exhaust
  // the JavaScript regular-expression stack before decompression even starts.
  if (!encoded || encoded.length % 4 !== 0 || encoded.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('压缩数据无效或超过读取上限')
  if (typeof DecompressionStream === 'undefined') fail('此浏览器不支持本地解压，请使用新版 Safari、Chrome、Edge 或 Firefox')
  let decoded: unknown
  try {
    const length = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
    const compressed = new Uint8Array(length)
    let offset = 0
    for (let index = 0; index < encoded.length; index += 32768) {
      const binary = atob(encoded.slice(index, index + 32768))
      for (let byte = 0; byte < binary.length; byte++) compressed[offset++] = binary.charCodeAt(byte)
    }
    const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) fail('解压后内容超过读取上限')
        chunks.push(value)
      }
    }
    catch (error) {
      await reader.cancel().catch(() => undefined)
      throw error
    }
    const bytes = new Uint8Array(total)
    offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('紧凑 HTML：')) throw error
    fail('压缩数据损坏或不完整，无法还原文稿')
  }
  if (!record(decoded) || !exactKeys(decoded, ['html', 'token', 'resources'])) fail('解压后的文稿格式无效')
  const { html, token, resources } = decoded as { html: unknown; token: unknown; resources: unknown }
  if (typeof html !== 'string' || typeof token !== 'string' || !token.startsWith('\u0000') || !/^SS_RESOURCE_[0-9]{1,9}_$/.test(token.slice(1)) || !Array.isArray(resources) || resources.length > 100000) fail('资源索引格式无效')
  const htmlText = html as string
  const prefix = token as string
  const dictionary = resources as unknown[]
  for (const resource of dictionary) {
    if (typeof resource !== 'string' || !/^data:(?:[a-z0-9.+-]+\/[a-z0-9.+-]+)?(?:;[a-z0-9.+-]+=[a-z0-9.+%-]+)*;base64,[a-z0-9+/]+={0,2}$/i.test(resource)) fail('资源字典包含无效内容')
  }
  const byteSize = (value: string) => {
    let total = 0
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      if (code < 0x80) total++
      else if (code < 0x800) total += 2
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
        total += 4
        index++
      }
      else total += 3
    }
    return total
  }
  const parts: string[] = []
  let offset = 0
  let expandedBytes = 0
  let references = 0
  for (;;) {
    const start = htmlText.indexOf(prefix, offset)
    if (start < 0) break
    if (++references > 1000000) fail('资源引用数量超过读取上限')
    const end = htmlText.indexOf('\u0000', start + prefix.length)
    const index = htmlText.slice(start + prefix.length, end)
    if (end < 0 || !/^(?:0|[1-9][0-9]{0,5})$/.test(index) || Number(index) >= dictionary.length) fail('资源引用缺失或损坏')
    const before = htmlText.slice(offset, start)
    const resource = dictionary[Number(index)] as string
    expandedBytes += byteSize(before) + resource.length
    if (expandedBytes > maxBytes) fail('资源还原后内容超过读取上限')
    parts.push(before, resource)
    offset = end + 1
  }
  const tail = htmlText.slice(offset)
  expandedBytes += byteSize(tail)
  if (expandedBytes > maxBytes) fail('资源还原后内容超过读取上限')
  parts.push(tail)
  return parts.join('')
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export async function packHtmlPresentation(html: string, options: { editable: boolean; title: string; language?: 'zh-CN' | 'en' }): Promise<string> {
  if (typeof CompressionStream === 'undefined') throw new Error('此浏览器不支持紧凑 HTML 导出，请使用新版 Safari、Chrome、Edge 或 Firefox')
  if (utf8Size(html) > COMPACT_HTML_MAX_BYTES) throw new Error('HTML 内容超过 512 MiB 安全上限，未生成文件')
  const counts = new Map<string, number>()
  for (const match of html.matchAll(dataUrlPattern)) counts.set(match[0], (counts.get(match[0]) || 0) + 1)
  const resources: string[] = []
  const indexes = new Map<string, number>()
  for (const [resource, count] of counts) {
    if (count > 1) {
      indexes.set(resource, resources.length)
      resources.push(resource)
    }
  }
  if (resources.length > 100000) throw new Error('HTML 资源数量超过安全上限，未生成文件')
  let attempt = 0
  let token = '\u0000SS_RESOURCE_0_'
  while (html.includes(token)) token = `\u0000SS_RESOURCE_${++attempt}_`
  let references = 0
  const compact = html.replace(dataUrlPattern, resource => {
    const index = indexes.get(resource)
    if (index === undefined) return resource
    if (++references > 1000000) throw new Error('HTML 资源引用数量超过安全上限，未生成文件')
    return `${token}${index}\u0000`
  })
  const json = JSON.stringify({ html: compact, token, resources })
  if (utf8Size(json) > COMPACT_HTML_MAX_BYTES) throw new Error('HTML 内容超过 512 MiB 安全上限，未生成文件')
  const compressed = await readStream(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')), COMPACT_HTML_MAX_BYTES)
  const manifest: CompactManifest = { version: 1, encoding: 'gzip-base64', editable: options.editable, payload: encodeBase64(compressed) }
  const english = options.language === 'en'
  const loader = `Promise.resolve().then(()=>(${decodeCompactHtmlManifest.toString()})(JSON.parse(document.getElementById('${COMPACT_HTML_MARKER_ID}').textContent))).then(html=>{document.open();document.write(html);document.close()}).catch(error=>{document.getElementById('compact-status').textContent=${JSON.stringify(english ? 'Unable to open presentation: ' : '无法打开此文稿：')}+(error instanceof Error?error.message:${JSON.stringify(english ? 'Damaged file' : '文件损坏')});document.title=${JSON.stringify(english ? 'Unable to open presentation' : '文稿打开失败')}})`
  const output = `<!doctype html><html lang="${english ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Keytist compact HTML"><title>${escapeHtml(options.title.slice(0, 512))}</title><style>html,body{height:100%;margin:0;background:#17181c;color:#f5f5f7;font-family:system-ui,sans-serif}body{display:grid;place-items:center}p{max-width:34em;padding:24px;line-height:1.6}</style></head><body><p id="compact-status" role="status">${english ? 'Opening presentation…' : '正在打开演示文稿…'}</p><noscript>${english ? 'Enable JavaScript to open this presentation.' : '此演示文稿需要启用 JavaScript 才能打开。'}</noscript><script id="${COMPACT_HTML_MARKER_ID}" type="application/json">${JSON.stringify(manifest)}</script><script>${loader}</script></body></html>`
  if (utf8Size(output) > COMPACT_HTML_MAX_BYTES) throw new Error('HTML 文件超过 512 MiB 安全上限，未生成文件')
  return output
}

/** Read only the inert manifest, without parsing or executing the presentation. */
export async function unpackCompactHtml(source: string): Promise<string | undefined> {
  if (!source.includes(COMPACT_HTML_MARKER_ID)) return undefined
  if (source.length > COMPACT_HTML_MAX_BYTES || utf8Size(source) > COMPACT_HTML_MAX_BYTES) throw new Error('紧凑 HTML：文件超过 512 MiB 读取上限')
  const scriptPattern = /<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi
  const attribute = (attributes: string, name: string) => {
    const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
    return match ? match[1] ?? match[2] ?? match[3] : undefined
  }
  const matches: string[] = []
  for (const match of source.matchAll(scriptPattern)) {
    if (attribute(match[1], 'id') !== COMPACT_HTML_MARKER_ID) continue
    if (attribute(match[1], 'type')?.toLowerCase() !== 'application/json') throw new Error('紧凑 HTML：文件头类型无效')
    matches.push(match[2])
  }
  if (!matches.length) {
    if (/<script\b[^>]*\bid\s*=\s*["']?slide-studio-compact(?:["'\s>]|$)/i.test(source)) throw new Error('紧凑 HTML：文件头缺失或不完整')
    return undefined
  }
  if (matches.length !== 1) throw new Error('紧凑 HTML：存在重复的文件头')
  let manifest: unknown
  try {
    manifest = JSON.parse(matches[0])
  }
  catch {
    throw new Error('紧凑 HTML：文件头 JSON 损坏')
  }
  return await decodeCompactHtmlManifest(manifest)
}
