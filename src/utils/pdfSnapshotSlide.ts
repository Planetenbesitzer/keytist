import type { PPTImageElement, Slide } from '@/types/slides'
import { HTML_MIN_SCALE, HTML_MAX_SCALE } from './htmlPlacement'

export interface PdfSnapshotBitmap {
  dataUrl: string
  /** Actual PNG pixels, rather than the logical webpage viewport. */
  width: number
  height: number
}

export interface PdfSnapshotSize { width: number; height: number }

const MAX_EDGE = 8192
const MAX_PIXELS = 32 * 1024 * 1024
const MAX_DATA_URL_LENGTH = 64 * 1024 * 1024
const positive = (value: number) => Number.isFinite(value) && value > 0
const validPixels = (width: number, height: number) =>
  Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
  width <= MAX_EDGE && height <= MAX_EDGE && width * height <= MAX_PIXELS

/** Match HtmlSlide's inner contain fit, then its outer translate/scale. The
 * transparent canvas represents the outer viewport and therefore clips before
 * placement, preserving both its letterbox and native overlays above the page.
 */
export const getPdfSnapshotPlacement = (slide: Slide, size: PdfSnapshotSize, snapshot: Pick<PdfSnapshotBitmap, 'width' | 'height'>) => {
  if (!slide.html) throw new Error('此页没有可冻结的交互网页。')
  const { width, height } = size
  const sourceWidth = slide.html.width ?? width
  const sourceHeight = slide.html.height ?? height
  const left = slide.html.left ?? 0, top = slide.html.top ?? 0, scale = slide.html.scale ?? 1
  if (![width, height, sourceWidth, sourceHeight].every(positive) || !Number.isFinite(width * height) ||
      !Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(scale) || scale < HTML_MIN_SCALE || scale > HTML_MAX_SCALE ||
      !Number.isFinite(width * scale) || !Number.isFinite(height * scale)) throw new Error('网页冻结画面的页面尺寸无效。')
  if (!validPixels(snapshot.width, snapshot.height)) throw new Error('网页冻结画面的像素尺寸过大或无效。')

  const fit = Math.min(width / sourceWidth, height / sourceHeight)
  if (!positive(fit)) throw new Error('网页冻结画面的页面尺寸无效。')
  const density = Math.min(
    Math.min(snapshot.width / sourceWidth, snapshot.height / sourceHeight) / fit,
    MAX_EDGE / width, MAX_EDGE / height, Math.sqrt(MAX_PIXELS / (width * height)),
  )
  const canvasWidth = Math.max(1, Math.floor(width * density))
  const canvasHeight = Math.max(1, Math.floor(height * density))
  if (!positive(density) || !validPixels(canvasWidth, canvasHeight)) throw new Error('网页冻结画面的像素尺寸过大或无效。')
  return {
    sourceWidth, sourceHeight, fit, canvasWidth, canvasHeight,
    draw: { left: (width - sourceWidth * fit) / 2, top: (height - sourceHeight * fit) / 2, width: sourceWidth * fit, height: sourceHeight * fit },
    image: { left, top, width: width * scale, height: height * scale },
  }
}

const assertPng = (snapshot: PdfSnapshotBitmap) => {
  if (typeof snapshot.dataUrl !== 'string' || snapshot.dataUrl.length > MAX_DATA_URL_LENGTH || !snapshot.dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('网页冻结画面需要有效的 PNG 图片。')
  }
  let header: Uint8Array
  try {
    header = Uint8Array.from(atob(snapshot.dataUrl.slice('data:image/png;base64,'.length, 'data:image/png;base64,'.length + 44)), char => char.charCodeAt(0))
  }
  catch {
    throw new Error('网页冻结画面的 PNG 数据无效。')
  }
  if (header.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte) ||
      String.fromCharCode(...header.subarray(12, 16)) !== 'IHDR') throw new Error('网页冻结画面的 PNG 数据无效。')
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const width = view.getUint32(16), height = view.getUint32(20)
  if (!validPixels(width, height) || width !== snapshot.width || height !== snapshot.height) throw new Error('网页冻结画面的 PNG 尺寸与预览不一致。')
}

/** Create a detached static slide. This never updates a slide store or replaces
 * the original HTML; its native text/shapes still render above the frozen page.
 */
export const createPdfSnapshotSlide = async (slide: Slide, snapshot: PdfSnapshotBitmap, size: PdfSnapshotSize): Promise<Slide> => {
  const placement = getPdfSnapshotPlacement(slide, size, snapshot)
  assertPng(snapshot)
  const image = document.createElement('img')
  const canvas = document.createElement('canvas')
  image.src = snapshot.dataUrl
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('网页冻结画面载入超时，请重试。')), 30000)
      }),
    ])
    if (image.naturalWidth !== snapshot.width || image.naturalHeight !== snapshot.height) throw new Error('网页冻结画面的图片尺寸无效。')
    canvas.width = placement.canvasWidth; canvas.height = placement.canvasHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法准备网页冻结画面，请重试。')
    context.imageSmoothingQuality = 'high'
    context.scale(canvas.width / size.width, canvas.height / size.height)
    const { left, top, width, height } = placement.draw
    context.drawImage(image, left, top, width, height)
    const bitmap = canvas.toDataURL('image/png')
    if (!bitmap.startsWith('data:image/png;base64,')) throw new Error('无法生成网页冻结画面，请重试。')
    // Drop the potentially large HTML source before making the detached copy.
    const copy: Slide = JSON.parse(JSON.stringify({ ...slide, html: undefined }))
    const usedIds = new Set(copy.elements.map(element => element.id))
    let id: string
    do {
      id = `pdf-snapshot-${crypto.randomUUID()}`
    } while (usedIds.has(id))
    const frozen: PPTImageElement = { id, type: 'image', ...placement.image, rotate: 0, fixedRatio: true, src: bitmap }
    // Match static printing: do not start audio/video in the detached renderer.
    copy.elements = [frozen, ...copy.elements.filter(element => element.type !== 'video' && element.type !== 'audio')]
    return copy
  }
  catch (error) {
    throw error instanceof Error ? error : new Error('无法生成网页冻结画面，请重试。')
  }
  finally {
    clearTimeout(timer)
    image.src = ''
    canvas.width = 0; canvas.height = 0
  }
}
