import htmlToImageLibrary from 'html-to-image/dist/html-to-image.js?raw'

export interface HtmlPdfSnapshotOptions {
  token: string
  width: number
  height: number
  pixelRatio?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export interface HtmlPdfSnapshot {
  dataUrl: string
  /** PNG pixels, rather than the source document's CSS pixels. */
  width: number
  height: number
}

const REQUEST = 'keytist:html-pdf-snapshot:request'
const RESPONSE = 'keytist:html-pdf-snapshot:response'
const MAX_EDGE = 8192
const MAX_PIXELS = 32 * 1024 * 1024
const MAX_DATA_LENGTH = 64 * 1024 * 1024

const snapshotSize = (width: number, height: number, pixelRatio: number) => {
  const pixels = { width: Math.floor(width * pixelRatio), height: Math.floor(height * pixelRatio) }
  if (![width, height, pixelRatio].every(Number.isFinite) || width <= 0 || height <= 0 || pixelRatio <= 0 || pixelRatio > 4 ||
      !pixels.width || !pixels.height || pixels.width > MAX_EDGE || pixels.height > MAX_EDGE || pixels.width * pixels.height > MAX_PIXELS) {
    throw new Error('网页快照尺寸过大或无效，请降低导出清晰度后重试。')
  }
  return pixels
}

// This function is serialized into the PDF preview. Keep its constants and
// helpers local: it executes in an opaque-origin sandbox, without editor access.
function installSnapshotBridge(token: string, library: {
  toSvg: (node: HTMLElement, options: Record<string, unknown>) => Promise<string>
  getFontEmbedCSS: (node: HTMLElement, options: Record<string, unknown>) => Promise<string>
}) {
  const requestType = 'keytist:html-pdf-snapshot:request'
  const responseType = 'keytist:html-pdf-snapshot:response'
  const missingImage = 'data:image/x-keytist-pdf-missing,failed'
  let busy = false
  const visible = (element: Element) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      if (getComputedStyle(current).display === 'none') return false
    }
    return true
  }
  const cssUrls = (value: string) => [...value.matchAll(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/gi)].map(match =>
    (match[1] ?? match[2] ?? match[3]).trim().replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, char) => hex ? String.fromCodePoint(parseInt(hex, 16)) : char))
  const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('网页图片无法冻结，请检查图片或跨域访问限制后重试。'))
    image.src = source
  })
  const prepareImages = async (root: HTMLElement) => {
    const urls = new Set<string>()
    for (const element of [root, ...root.querySelectorAll('*')]) {
      if (!visible(element)) continue
      if (element instanceof HTMLIFrameElement || element instanceof HTMLObjectElement || element instanceof HTMLEmbedElement) {
        throw new Error('此网页包含嵌套网页或插件，无法完整冻结；请先将这部分内容转换为图片。')
      }
      if (element instanceof HTMLCanvasElement) {
        try {
          element.toDataURL()
        }
        catch {
          throw new Error('网页画布包含不允许读取的跨域图片，无法冻结；请改用本地素材后重试。')
        }
      }
      if (element instanceof HTMLImageElement) {
        try {
          await element.decode()
        }
        catch {
          throw new Error('网页图片尚未载入，无法冻结。')
        }
        if (!element.naturalWidth || !element.naturalHeight) throw new Error('网页图片尚未载入，无法冻结。')
        urls.add(element.currentSrc || element.src)
      }
      if (element instanceof SVGImageElement) urls.add(element.href.baseVal)
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(element, pseudo)
        for (const property of ['background-image', 'mask-image', '-webkit-mask-image', 'border-image-source', 'list-style-image', 'content']) {
          cssUrls(style.getPropertyValue(property)).forEach(url => urls.add(url))
        }
      }
    }
    // html-to-image otherwise replaces failed CSS image requests with empty
    // placeholders. Verify every captured image URL before its own embedding.
    await Promise.all([...urls].filter(url => url && !url.startsWith('#')).map(async url => {
      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error('Image request failed')
        const objectUrl = URL.createObjectURL(await response.blob())
        try {
          await loadImage(objectUrl)
        }
        finally {
          URL.revokeObjectURL(objectUrl)
        }
      }
      catch {
        throw new Error('网页图片无法完整读取，可能受到跨域限制；未生成不完整的快照。')
      }
    }))
  }
  window.addEventListener('message', async event => {
    const data = event.data
    if (event.source !== parent || data?.type !== requestType || data.token !== token || typeof data.requestId !== 'string' || data.requestId.length > 128) return
    const respond = (result: Record<string, unknown>) => parent.postMessage({ type: responseType, token, requestId: data.requestId, ...result }, '*')
    if (busy) {
      respond({ error: '此网页正在冻结，请稍后重试。' }); return
    }
    busy = true
    let outputCanvas: HTMLCanvasElement | undefined
    try {
      const { width, height, pixelRatio } = data
      const pixelWidth = Math.floor(width * pixelRatio), pixelHeight = Math.floor(height * pixelRatio)
      if (![width, height, pixelRatio].every(Number.isFinite) || width <= 0 || height <= 0 || pixelRatio <= 0 || pixelRatio > 4 ||
          pixelWidth <= 0 || pixelHeight <= 0 || pixelWidth > 8192 || pixelHeight > 8192 || pixelWidth * pixelHeight > 32 * 1024 * 1024) {
        throw new Error('网页快照尺寸过大或无效，请降低导出清晰度后重试。')
      }
      if (Math.abs(innerWidth - width) > 1 || Math.abs(innerHeight - height) > 1) throw new Error('网页预览尺寸尚未稳定，请稍后重试。')
      await document.fonts.ready
      await prepareImages(document.documentElement)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      // Reuse CSS-declared webfonts only for this temporary SVG redraw. There
      // is no system-font lookup or portable-font coverage requirement: an
      // unavailable family such as Cambria Math simply keeps browser fallback.
      const fontEmbedCSS = await library.getFontEmbedCSS(document.documentElement, {
        imagePlaceholder: missingImage, includeQueryParams: true,
      })
      if (fontEmbedCSS.includes(missingImage)) throw new Error('网页已加载的字体无法完整读取，未生成字体被替换的快照。')
      const controls = [...document.querySelectorAll('input,textarea,select')].filter(visible).map(element => {
        if (element instanceof HTMLInputElement) return { tag: 'input', value: element.value, checked: element.checked }
        if (element instanceof HTMLTextAreaElement) return { tag: 'textarea', value: element.value }
        return { tag: 'select', selected: [...(element as HTMLSelectElement).options].map(option => option.selected) }
      })
      const svg = await library.toSvg(document.documentElement, {
        width, height, pixelRatio, canvasWidth: width, canvasHeight: height,
        skipFonts: true, fontEmbedCSS, skipAutoScale: true,
        imagePlaceholder: missingImage, includeQueryParams: true,
        filter: (element: Node) => !(element instanceof Element) || (!['SCRIPT', 'STYLE', 'LINK', 'META'].includes(element.tagName) && visible(element)),
        onImageErrorHandler: () => {
          throw new Error('网页图片无法冻结，未生成不完整的快照。')
        },
      })
      const markup = decodeURIComponent(svg.slice(svg.indexOf(',') + 1))
      if (markup.includes(missingImage)) throw new Error('网页素材未能完整载入，未生成不完整的快照。')
      const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
      if (parsed.querySelector('parsererror')) throw new Error('无法生成网页快照。')
      const clones = [...parsed.querySelectorAll('input,textarea,select')]
      if (clones.length !== controls.length) throw new Error('网页表单结构无法完整冻结，请使用普通 HTML 控件。')
      clones.forEach((element, index) => {
        const state = controls[index]
        if (state.tag === 'input') {
          element.setAttribute('value', state.value || '')
          if (state.checked) element.setAttribute('checked', '')
          else element.removeAttribute('checked')
        }
        else if (state.tag === 'textarea') element.textContent = state.value || ''
        else {
          [...element.querySelectorAll('option')].forEach((option, optionIndex) => {
            if (state.selected?.[optionIndex]) option.setAttribute('selected', '')
            else option.removeAttribute('selected')
          })
        }
      })
      // Fail rather than silently leave non-embedded SVG/CSS image references.
      for (const element of parsed.querySelectorAll('*')) {
        const urls = cssUrls(element.getAttribute('style') || '')
        if (['img', 'image', 'use'].includes(element.localName)) {
          const source = element.getAttribute('src') || element.getAttribute('href') || element.getAttribute('xlink:href')
          if (source) urls.push(source)
        }
        if (urls.some(url => url && !url.startsWith('#') && !url.startsWith('data:'))) throw new Error('网页包含未能嵌入的图片，未生成不完整的快照。')
      }
      const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(parsed))}`)
      const canvas = document.createElement('canvas')
      outputCanvas = canvas
      canvas.width = pixelWidth; canvas.height = pixelHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器无法创建高清画面。')
      context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
      const dataUrl = canvas.toDataURL('image/png')
      if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 64 * 1024 * 1024) throw new Error('网页快照过大，请降低导出清晰度后重试。')
      respond({ dataUrl, width: pixelWidth, height: pixelHeight })
    }
    catch (error) {
      respond({ error: error instanceof Error ? error.message.slice(0, 2000) : '无法冻结网页，请检查网页素材和截图权限。' })
    }
    finally {
      if (outputCanvas) {
        outputCanvas.width = 0; outputCanvas.height = 0
      }
      busy = false
    }
  })
}

/** Only use this source in the separate PDF preview, with the usual opaque
 * sandbox. The user's editor/live presentation source is never changed. */
export const buildHtmlPdfSnapshotSource = (source: string, token: string): string => {
  if (!source.trim() || !token || token.length > 256) throw new Error('网页快照预览参数无效。')
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const script = parsed.createElement('script')
  const escapedToken = JSON.stringify(token).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  script.textContent = `(()=>{const previous=window.htmlToImage;const module=undefined,exports=undefined,define=undefined;\n${htmlToImageLibrary}\nconst library=window.htmlToImage;if(previous===undefined)delete window.htmlToImage;else window.htmlToImage=previous;(${installSnapshotBridge.toString()})(${escapedToken},library);})()`
    .replace(/<\/script/gi, '<\\/script')
  parsed.head.appendChild(script)
  return `<!DOCTYPE html>\n${parsed.documentElement.outerHTML}`
}

/** PNG signature/IHDR checks are followed by the browser's actual image decoder. */
const readPngSize = (value: unknown): { width: number; height: number } => {
  if (typeof value !== 'string' || value.length > MAX_DATA_LENGTH || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('网页返回了无效的 PNG 快照。')
  let bytes: string
  try {
    bytes = atob(value.slice(value.indexOf(',') + 1))
  }
  catch {
    throw new Error('网页返回了无效的 PNG 快照。')
  }
  if (bytes.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes.charCodeAt(index) === byte) ||
      bytes.slice(12, 16) !== 'IHDR' || bytes.charCodeAt(11) !== 13 || [8, 9, 10].some(index => bytes.charCodeAt(index) !== 0)) throw new Error('网页返回了无效的 PNG 快照。')
  const uint32 = (offset: number) => ((bytes.charCodeAt(offset) * 0x1000000) + (bytes.charCodeAt(offset + 1) << 16) + (bytes.charCodeAt(offset + 2) << 8) + bytes.charCodeAt(offset + 3)) >>> 0
  return { width: uint32(16), height: uint32(20) }
}

export const captureHtmlPdfSnapshot = (frame: HTMLIFrameElement, options: HtmlPdfSnapshotOptions): Promise<HtmlPdfSnapshot> => {
  const { token, width, height, pixelRatio = 2, timeoutMs = 30000, signal } = options
  let expected: { width: number; height: number }
  try {
    expected = snapshotSize(width, height, pixelRatio)
    if (!token || token.length > 256 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000 ||
        !frame.isConnected || !frame.contentWindow || !frame.ownerDocument.defaultView || !frame.hasAttribute('sandbox') ||
        !frame.sandbox.contains('allow-scripts') || frame.sandbox.contains('allow-same-origin')) throw new Error('网页快照预览参数无效。')
    if (signal?.aborted) throw new Error('已取消网页快照。')
  }
  catch (error) {
    return Promise.reject(error)
  }
  const target = frame.contentWindow!
  const host = frame.ownerDocument.defaultView!
  const source = frame.srcdoc
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    let settled = false
    let validating = false
    const cleanup = () => {
      clearTimeout(timer)
      host.removeEventListener('message', receive)
      signal?.removeEventListener('abort', abort)
    }
    const finish = (error?: Error, value?: HtmlPdfSnapshot) => {
      if (settled) return
      settled = true; cleanup()
      if (error) reject(error)
      else resolve(value!)
    }
    const abort = () => finish(new Error('已取消网页快照。'))
    const receive = async (event: MessageEvent) => {
      const data = event.data
      if (settled || validating || event.source !== target || data?.type !== RESPONSE || data.token !== token || data.requestId !== requestId) return
      validating = true
      try {
        if (!frame.isConnected || frame.srcdoc !== source) throw new Error('网页预览已切换，请重新冻结当前状态。')
        if (typeof data.error === 'string') throw new Error(data.error.slice(0, 2000) || '无法冻结网页。')
        const actual = readPngSize(data.dataUrl)
        if (actual.width !== expected.width || actual.height !== expected.height || data.width !== expected.width || data.height !== expected.height) throw new Error('网页快照尺寸与预览不一致，请重新冻结。')
        const image = frame.ownerDocument.createElement('img')
        image.src = data.dataUrl
        try {
          await image.decode()
        }
        catch {
          throw new Error('网页快照图片无法完整解码。')
        }
        if (image.naturalWidth !== expected.width || image.naturalHeight !== expected.height) throw new Error('网页快照图片无法完整解码。')
        finish(undefined, { dataUrl: data.dataUrl, ...expected })
      }
      catch (error) {
        finish(error instanceof Error ? error : new Error('网页快照图片无法完整解码。'))
      }
    }
    const timer = setTimeout(() => finish(new Error('网页快照超时；页面可能限制了截图脚本或素材尚未载入，请检查预览后重试。')), timeoutMs)
    host.addEventListener('message', receive)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      target.postMessage({ type: REQUEST, token, requestId, width, height, pixelRatio }, '*')
    }
    catch {
      finish(new Error('无法向网页预览请求快照。'))
    }
  })
}
