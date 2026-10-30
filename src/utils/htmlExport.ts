import { language, t } from '@/i18n'
import type { LocalDocument } from '@/services/localDocument'
import { htmlViewerScript, htmlViewerStyle } from './htmlViewer'
import { packHtmlPresentation } from './htmlCompact'
import { injectPortableFontStyles, PORTABLE_TEXT_SIZE_CSS, prepareHtmlExportFonts, type PreparedHtmlFonts } from './htmlFontCapture'
import { replacePortableFontFamilies } from './portableFonts'
import { assertPortableSvgImageFonts } from './svgFontPortability'

export interface HtmlExportOptions {
  /** Include the native document for reopening and editing in Keytist. */
  editable?: boolean
  /** Expanded output is useful for inspecting and comparing the viewer. */
  compact?: boolean
  /** Prepared against the same immutable snapshot by the export dialog. */
  preparedFonts?: PreparedHtmlFonts
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const cssString = (value: string) => JSON.stringify(value).replace(/</g, '\\3c ')
const urlPattern = /url\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|([^)]*))\s*\)/gi
const unescapeCss = (value: string) => value.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, character) => hex ? String.fromCodePoint(parseInt(hex, 16)) : character)
const blobDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error('无法读取导出素材'))
  reader.readAsDataURL(blob)
})

/** Native slides retain DOM/CSS and vector shapes. Only existing canvas objects
 * become individual PNGs. Untrusted imported HTML runs solely in opaque iframes. */
export const exportHtmlPresentation = async (input: LocalDocument, roots: HTMLElement[], options: HtmlExportOptions = {}): Promise<string> => {
  if (!input.slides.length || roots.length !== input.slides.length) throw new Error('HTML 导出页面尚未准备完成')
  const snapshot: LocalDocument = JSON.parse(JSON.stringify(input))
  const base = document.baseURI
  const cache = new Map<string, Promise<string>>()
  const portableFonts = options.preparedFonts || await prepareHtmlExportFonts(snapshot, roots, { editable: !!options.editable })
  const pseudoRules: string[] = []
  let nodeId = 0
  const localReference = (source: string) => {
    if (source.startsWith('#')) return source
    const url = new URL(source, base)
    const current = new URL(base)
    return url.hash && url.origin === current.origin && url.pathname === current.pathname && url.search === current.search ? url.hash : ''
  }
  const bundle = (source: string, kind = '图片', assetBase = base, ancestors: string[] = []): Promise<string> => {
    if (!source) return Promise.reject(new Error(`${kind}缺少素材，无法导出`))
    const key = new URL(source, assetBase).href
    if (!/^(data:|blob:|https?:)/i.test(key)) return Promise.reject(new Error(`${kind}地址不受支持，请先导入本地素材`))
    if (ancestors.includes(key)) return Promise.reject(new Error(`${kind}包含循环引用，无法打包`))
    const previous = cache.get(key)
    if (previous) return previous
    const operation = (async () => {
      let response: Response
      try {
        response = await fetch(key, { signal: AbortSignal.timeout(20000) })
      }
      catch {
        throw new Error(`${kind}无法打包，请检查素材或跨域读取权限`)
      }
      if (!response.ok) throw new Error(`${kind}载入失败（${response.status}），未生成 HTML`)
      let blob = await response.blob()
      if (/svg/i.test(blob.type) || /\.svg(?:[?#]|$)/i.test(key)) {
        const parsed = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml')
        if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('SVG 图片无效，未生成 HTML')
        assertPortableSvgImageFonts(parsed)
        for (const element of Array.from(parsed.querySelectorAll('*'))) {
          for (const attribute of ['href', 'xlink:href']) {
            const href = element.getAttribute(attribute)
            if (href && !href.startsWith('#')) element.setAttribute(attribute, await bundle(href, 'SVG 内嵌素材', key.startsWith('data:') ? assetBase : key, [...ancestors, key]))
          }
          for (const attribute of Array.from(element.attributes)) {
            if (attribute.value.includes('url(')) element.setAttribute(attribute.name, await bundleCss(attribute.value, key.startsWith('data:') ? assetBase : key, [...ancestors, key]))
          }
        }
        for (const style of Array.from(parsed.querySelectorAll('style'))) style.textContent = await bundleCss(style.textContent || '', key.startsWith('data:') ? assetBase : key, [...ancestors, key])
        blob = new Blob([new XMLSerializer().serializeToString(parsed)], { type: 'image/svg+xml' })
      }
      const result = await blobDataUrl(blob)
      if (/图片|背景|填充|SVG/.test(kind)) {
        const image = new Image()
        image.src = result
        try {
          await image.decode()
        }
        catch {
          throw new Error(`${kind}损坏，未生成 HTML`)
        }
        if (!image.naturalWidth) throw new Error(`${kind}尺寸无效，未生成 HTML`)
      }
      return result
    })()
    cache.set(key, operation)
    return operation
  }
  const bundleCss = async (css: string, assetBase = base, ancestors: string[] = [], kind = 'CSS 图片') => {
    let result = css
    for (const match of Array.from(css.matchAll(urlPattern))) {
      const source = unescapeCss((match[1] ?? match[2] ?? match[3]).trim())
      const local = localReference(source)
      const portable = local || await bundle(source, kind, assetBase, ancestors)
      result = result.replace(match[0], `url(${cssString(portable)})`)
    }
    return result
  }
  const styleText = async (style: CSSStyleDeclaration) => {
    const rules: string[] = []
    for (const property of Array.from(style)) {
      // Pointer behavior is restored by the standalone viewer, not thumbnail CSS.
      if (property === 'pointer-events') continue
      const originalValue = style.getPropertyValue(property)
      const value = property === 'font-family' ? replacePortableFontFamilies(originalValue, portableFonts.familyAliases) : originalValue
      rules.push(`${property}:${value.includes('url(') ? await bundleCss(value) : value};`)
    }
    return rules.join('')
  }
  const cloneNative = async (source: Element): Promise<Element> => {
    const clone = source.cloneNode(false) as Element
    for (const attribute of Array.from(clone.attributes)) {
      if (/^on/i.test(attribute.name) || ['srcdoc', 'srcset', 'contenteditable'].includes(attribute.name)) clone.removeAttribute(attribute.name)
    }
    const style = getComputedStyle(source)
    clone.setAttribute('style', await styleText(style))
    // Preserve the text frame, while allowing paragraphs to contain the lines
    // produced by the embedded font instead of freezing one machine's height.
    if (source.matches('.ProseMirror-static,.text p,.text li,.text ul,.text ol,.text blockquote')) {
      (clone as HTMLElement).style.height = 'auto'
      ;(clone as HTMLElement).style.minHeight = '0'
      ;(clone as HTMLElement).style.maxHeight = 'none'
    }
    for (const pseudo of ['::before', '::after']) {
      const computed = getComputedStyle(source, pseudo)
      if (computed.content && !['none', 'normal'].includes(computed.content)) {
        const id = clone.getAttribute('data-html-node') || `n${++nodeId}`
        clone.setAttribute('data-html-node', id)
        pseudoRules.push(`[data-html-node="${id}"]${pseudo}{${await styleText(computed)}}`)
      }
    }
    if (source instanceof HTMLCanvasElement) {
      const image = document.createElement('img')
      image.setAttribute('style', clone.getAttribute('style') || '')
      try {
        image.src = source.toDataURL('image/png')
      }
      catch {
        throw new Error('图表画布无法读取，未生成 HTML')
      }
      return image
    }
    if (source instanceof HTMLImageElement) clone.setAttribute('src', await bundle(source.currentSrc || source.src))
    if (source.localName === 'image' && source.namespaceURI === 'http://www.w3.org/2000/svg') {
      const original = source.getAttribute('href') || source.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || ''
      clone.removeAttribute('xlink:href')
      clone.setAttribute('href', await bundle(original, '形状填充图片'))
    }
    if (source.localName === 'a') {
      const href = source.getAttribute('href') || ''
      if (!/^(https?:|mailto:|tel:|#)/i.test(href)) clone.removeAttribute('href')
      clone.setAttribute('target', '_blank')
      clone.setAttribute('rel', 'noopener noreferrer')
    }
    for (const child of Array.from(source.childNodes)) {
      if (child instanceof Element) {
        if (child.hasAttribute('data-auto-page-number-hidden') || child.classList.contains('html-slide') || ['script', 'iframe', 'object', 'embed', 'base', 'link', 'meta', 'style'].includes(child.localName)) continue
        clone.appendChild(await cloneNative(child))
      }
      else clone.appendChild(child.cloneNode(true))
    }
    return clone
  }
  await document.fonts.ready
  const nativeMarkup: string[] = []
  for (const [index, slide] of snapshot.slides.entries()) {
    const root = roots[index]
    if (!root.clientWidth || !root.clientHeight) throw new Error(`第 ${index + 1} 页尚未渲染，无法导出`)
    const clone = await cloneNative(root)
    if (slide.html) {
      const styledClone = clone as HTMLElement
      styledClone.style.background = 'transparent'
      clone.querySelectorAll('.background, .html-slide').forEach(element => element.remove())
    }
    for (const element of slide.elements) {
      const wrapper = Array.from(clone.querySelectorAll('.base-element')).find(node => node.classList.contains(`base-element-${element.id}`))
      if (element.type === 'text' && element.autoPageNumber?.hidden) {
        wrapper?.remove()
        continue
      }
      if (element.link && wrapper) {
        if (element.link.type === 'slide') wrapper.setAttribute('data-slide-link', element.link.target)
        else if (/^https?:\/\//i.test(element.link.target)) wrapper.setAttribute('data-web-link', element.link.target)
      }
      if (element.type === 'image') element.src = await bundle(element.src)
      if (element.type === 'shape' && element.pattern) element.pattern = await bundle(element.pattern, '形状填充图片')
      if ((element.type === 'video' || element.type === 'audio') && wrapper) {
        element.src = await bundle(element.src, element.type === 'video' ? '视频' : '音频')
        const media = document.createElement(element.type)
        media.src = element.src
        media.controls = true
        media.preload = 'metadata'
        media.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:auto;'
        media.dataset.autoplay = String(element.autoplay)
        if (element.type === 'video' && element.poster) {
          element.poster = await bundle(element.poster, '视频封面图片')
          ;(media as HTMLVideoElement).poster = element.poster
        }
        if (element.type === 'audio') media.loop = element.loop
        const content = wrapper.querySelector('.element-content')
        if (content) content.replaceChildren(media)
      }
    }
    if (slide.background?.image) slide.background.image.src = await bundle(slide.background.image.src, '背景图片')
    nativeMarkup.push(`<div class="native-content${slide.html ? ' native-overlay' : ''}" style="width:${root.clientWidth}px;height:${root.clientHeight}px;transform:scale(${snapshot.width / root.clientWidth})">${clone.outerHTML}</div>`)
  }
  const pages = snapshot.slides.map((slide, index) => {
    const scope = `第 ${index + 1} 页网页`
    return {
      id: slide.id,
      source: slide.html ? injectPortableFontStyles(portableFonts.sourcesByScope[scope] || slide.html.source, portableFonts.cssByScope[scope] || '', portableFonts.familyAliasesByScope[scope]) : undefined,
      fontCss: slide.html ? portableFonts.cssByScope[scope] || '' : undefined,
      width: slide.html?.width, height: slide.html?.height,
      left: slide.html?.left, top: slide.html?.top, scale: slide.html?.scale, markup: nativeMarkup[index],
    }
  })
  const nativeCss = `${portableFonts.css}\n${PORTABLE_TEXT_SIZE_CSS}\n${pseudoRules.join('\n')}`.replace(/</g, '\\3c ')
  const documentMetadata = options.editable ? `<script type="application/json" id="slide-studio-document">${safeJson(snapshot)}</script>` : ''
  const html = `<!DOCTYPE html><html lang="${language.value}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Keytist"><title>${escapeHtml(snapshot.title)}</title><style>${htmlViewerStyle}\n${nativeCss}\n@page{size:${snapshot.width}px ${snapshot.height}px;margin:0}</style></head><body><main id="stage" aria-label="${escapeHtml(t('演示文稿'))}"></main><nav id="controls" aria-label="${escapeHtml(t('演示控制'))}"><button id="previous" aria-label="${escapeHtml(t('上一页'))}">←</button><output id="page-number"></output><button id="next" aria-label="${escapeHtml(t('下一页'))}">→</button><span class="spacer"></span><button id="fullscreen">${escapeHtml(t('全屏'))}</button><button id="print">${escapeHtml(t('打印'))}</button></nav>${documentMetadata}<script type="application/json" id="slide-studio-font-package">${safeJson({ version: 1, ...portableFonts.report })}</script><script type="application/json" id="slide-studio-viewer">${safeJson({ width: snapshot.width, height: snapshot.height, pages, fontCss: portableFonts.css, labels: { slide: t('幻灯片'), htmlSlide: t('HTML 幻灯片') } })}</script><script>${htmlViewerScript}</script></body></html>`
  return options.compact === false ? html : packHtmlPresentation(html, { editable: !!options.editable, title: snapshot.title, language: language.value })
}
