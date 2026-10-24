import { preparePptxImageSource } from '@/utils/pptxImage'

export class ExportImageReadinessError extends Error {
  constructor(kind: string) {
    super(`图片未载入，未导出：请检查${kind}。`)
    this.name = 'ExportImageReadinessError'
  }
}

const unescapeCssUrl = (value: string) => value.replace(
  /\\([0-9a-f]{1,6})(?:\r\n|[ \n\r\t\f])?|\\(\r\n|[\n\r\f])|\\([\s\S])/gi,
  (_, hex: string | undefined, newline: string | undefined, character: string | undefined) => {
    if (hex) {
      const point = parseInt(hex, 16)
      return String.fromCodePoint(point > 0 && point <= 0x10ffff ? point : 0xfffd)
    }
    return newline ? '' : character || ''
  },
)

const backgroundUrls = (value: string) => Array.from(value.matchAll(
  /url\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|([^)]*))\s*\)/gi,
), match => unescapeCssUrl((match[1] ?? match[2] ?? match[3]).trim()))

/** html-to-image can swallow failed CSS assets. Verify every slide image first. */
export const assertExportImagesReady = async (roots: Iterable<Element>): Promise<void> => {
  const sources = new Map<string, string>()
  const addSource = (source: string, kind: string, doc: Document) => {
    if (!source) throw new ExportImageReadinessError(kind)
    try {
      sources.set(new URL(source, doc.baseURI).href, kind)
    }
    catch {
      throw new ExportImageReadinessError(kind)
    }
  }

  for (const root of roots) {
    const doc = root.ownerDocument
    const view = doc.defaultView
    if (!view) throw new ExportImageReadinessError('文稿图片')
    for (const node of [root, ...Array.from(root.querySelectorAll('*'))]) {
      if (node.localName === 'img') {
        const image = node as HTMLImageElement
        addSource(image.currentSrc || image.src, '文稿图片', doc)
      }
      else if (node.localName === 'image' && node.namespaceURI === 'http://www.w3.org/2000/svg') {
        addSource(node.getAttribute('href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '', '形状填充图片', doc)
      }
      for (const source of backgroundUrls(view.getComputedStyle(node).backgroundImage)) {
        addSource(source, '背景图片', doc)
      }
    }
  }

  await Promise.all(Array.from(sources, async ([source, kind]) => {
    try {
      if (/^https?:/i.test(source)) {
        // A cross-origin img may decode while the screenshot library's fetch is
        // blocked by CORS. Check the same readable fetch before it can omit it.
        const response = await fetch(source, { signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error('图片无法读取')
        await response.blob()
      }
      // Keep the DOM and its rendered pixels untouched; only decoding is needed.
      await preparePptxImageSource(source)
    }
    catch {
      throw new ExportImageReadinessError(kind)
    }
  }))
}
