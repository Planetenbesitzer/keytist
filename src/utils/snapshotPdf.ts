/** Image-only PDF export. Each frame is already frozen; no page scripts or font
 * files are retained, and composing the PDF never opens the system print dialog. */
export interface SnapshotPdfPage {
  dataUrl: string
  width: number
  height: number
}

export interface SnapshotPdfOptions {
  /** Slide dimensions and margin in CSS pixels (96 px = 72 PDF points). */
  width: number
  height: number
  count: 1 | 2 | 3
  margin: number
  onProgress?: (completed: number, total: number) => void
}

export interface SnapshotPdfRgbPage {
  width: number
  height: number
  /** Opaque, row-major RGB samples, one byte per component. */
  rgb: Uint8Array
}

export const SNAPSHOT_PDF_MAX_PIXELS = 32 * 1024 * 1024
export const SNAPSHOT_PDF_MAX_DIMENSION = 8192
export const SNAPSHOT_PDF_MAX_FRAMES = 300
const MAX_DATA_URL_LENGTH = 64 * 1024 * 1024
const MAX_PDF_BYTES = 512 * 1024 * 1024
const PNG_PREFIX = 'data:image/png;base64,'
const POINTS_PER_PIXEL = 72 / 96
const encoder = new TextEncoder()

const validateDimensions = (width: number, height: number) => {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= SNAPSHOT_PDF_MAX_DIMENSION) || width * height > SNAPSHOT_PDF_MAX_PIXELS) {
    throw new Error('冻结画面的尺寸无效或过大，请降低清晰度后重试。')
  }
}

const validateOptions = (options: SnapshotPdfOptions, frames: number) => {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > SNAPSHOT_PDF_MAX_FRAMES) throw new Error('请先加入冻结画面，每次最多导出 300 帧。')
  if (![options.width, options.height].every(value => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(options.margin) || options.margin < 0 || ![1, 2, 3].includes(options.count)) {
    throw new Error('PDF 页面尺寸、每页数量或边缘留白无效。')
  }
  const width = (options.width + 2 * options.margin) * POINTS_PER_PIXEL
  const height = (options.height * options.count + 2 * options.margin) * POINTS_PER_PIXEL
  // PDF 1.4 supports media boxes up to 200 inches on either side.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width > 14400 || height > 14400) throw new Error('PDF 页面尺寸过大，请减少每页数量或留白。')
  return { width, height }
}

const pdfNumber = (value: number) => Number(value.toFixed(6)).toString()

class PdfWriter {
  readonly parts: Uint8Array[] = []
  readonly offsets: number[] = [0]
  length = 0

  append(data: string | Uint8Array) {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    if (this.length + bytes.byteLength > MAX_PDF_BYTES) throw new Error('PDF 文件超过 512 MiB，请分批导出冻结画面。')
    this.parts.push(bytes)
    this.length += bytes.byteLength
  }

  object(id: number, body: string | Uint8Array[]) {
    this.offsets[id] = this.length
    this.append(`${id} 0 obj\n`)
    if (typeof body === 'string') this.append(body)
    else for (const part of body) this.append(part)
    this.append('\nendobj\n')
  }
}

const deflate = async (rgb: Uint8Array) => {
  if (typeof CompressionStream === 'undefined') throw new Error('此浏览器不支持 PDF 图像压缩，请升级浏览器后重试。')
  const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const composeSnapshotPdf = async (frames: number, options: SnapshotPdfOptions, imageAt: (index: number) => Promise<SnapshotPdfRgbPage>): Promise<Blob> => {
  const size = validateOptions(options, frames)
  const pageCount = Math.ceil(frames / options.count)
  const contentId = (page: number) => 3 + frames + page
  const pageId = (page: number) => 3 + frames + pageCount + page
  const objectCount = 2 + frames + 2 * pageCount
  const writer = new PdfWriter()
  writer.append(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]))
  writer.object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  writer.object(2, `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, index) => `${pageId(index)} 0 R`).join(' ')}] >>`)
  const placements: string[] = []
  options.onProgress?.(0, frames)
  for (let index = 0; index < frames; index++) {
    const image = await imageAt(index)
    validateDimensions(image.width, image.height)
    if (!(image.rgb instanceof Uint8Array) || image.rgb.byteLength !== image.width * image.height * 3) throw new Error('冻结画面的 RGB 图像数据无效。')
    const compressed = await deflate(image.rgb)
    writer.object(3 + index, [
      encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate false /Filter /FlateDecode /Length ${compressed.byteLength} >>\nstream\n`),
      compressed,
      encoder.encode('\nendstream'),
    ])
    const scale = Math.min(options.width / image.width, options.height / image.height)
    const width = image.width * scale, height = image.height * scale
    const x = (options.margin + (options.width - width) / 2) * POINTS_PER_PIXEL
    const y = (options.margin + (options.count - index % options.count - 1) * options.height + (options.height - height) / 2) * POINTS_PER_PIXEL
    placements.push(`q\n${pdfNumber(width * POINTS_PER_PIXEL)} 0 0 ${pdfNumber(height * POINTS_PER_PIXEL)} ${pdfNumber(x)} ${pdfNumber(y)} cm\n/Im${index + 1} Do\nQ\n`)
    options.onProgress?.(index + 1, frames)
  }
  for (let page = 0; page < pageCount; page++) {
    const first = page * options.count, last = Math.min(frames, first + options.count)
    const content = encoder.encode(`1 1 1 rg\n0 0 ${pdfNumber(size.width)} ${pdfNumber(size.height)} re f\n${placements.slice(first, last).join('')}`)
    writer.object(contentId(page), [encoder.encode(`<< /Length ${content.byteLength} >>\nstream\n`), content, encoder.encode('endstream')])
    const resources = Array.from({ length: last - first }, (_, offset) => `/Im${first + offset + 1} ${3 + first + offset} 0 R`).join(' ')
    writer.object(pageId(page), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(size.width)} ${pdfNumber(size.height)}] /Resources << /XObject << ${resources} >> >> /Contents ${contentId(page)} 0 R >>`)
  }
  const xref = writer.length
  writer.append(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`)
  for (let id = 1; id <= objectCount; id++) writer.append(`${String(writer.offsets[id]).padStart(10, '0')} 00000 n \n`)
  writer.append(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(writer.parts, { type: 'application/pdf' })
}

/** Low-level RGB input keeps PDF byte structure and lossless compression testable
 * without decoding browser images or installing an external PDF library. */
export const buildSnapshotPdf = (pages: SnapshotPdfRgbPage[], options: SnapshotPdfOptions): Promise<Blob> =>
  composeSnapshotPdf(pages.length, options, index => Promise.resolve(pages[index]))

const validatePng = (page: SnapshotPdfPage) => {
  validateDimensions(page.width, page.height)
  if (typeof page.dataUrl !== 'string' || page.dataUrl.length > MAX_DATA_URL_LENGTH || !page.dataUrl.startsWith(PNG_PREFIX)) throw new Error('冻结画面必须是有效的 PNG 图片。')
  const payload = page.dataUrl.slice(PNG_PREFIX.length)
  if (payload.length < 44 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) throw new Error('冻结画面的 PNG 数据损坏。')
  let header: Uint8Array
  try {
    header = Uint8Array.from(atob(payload.slice(0, 44)), char => char.charCodeAt(0))
  }
  catch {
    throw new Error('冻结画面的 PNG 数据损坏。')
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  if (signature.some((byte, index) => header[index] !== byte) || view.getUint32(8) !== 13 || String.fromCharCode(...header.subarray(12, 16)) !== 'IHDR') throw new Error('冻结画面的 PNG 文件头无效。')
  if (view.getUint32(16) !== page.width || view.getUint32(20) !== page.height) throw new Error('冻结画面的实际尺寸与记录不一致，请重新冻结。')
}

const pngToRgb = async (page: SnapshotPdfPage): Promise<SnapshotPdfRgbPage> => {
  const image = document.createElement('img')
  const canvas = document.createElement('canvas')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    image.src = page.dataUrl
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('冻结画面载入超时，请重试。')), 30000)
      }),
    ])
    if (image.naturalWidth !== page.width || image.naturalHeight !== page.height) throw new Error('冻结画面的实际尺寸与记录不一致，请重新冻结。')
    canvas.width = page.width; canvas.height = page.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法准备 PDF 图像，请重试。')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, page.width, page.height)
    context.drawImage(image, 0, 0)
    const rgba = context.getImageData(0, 0, page.width, page.height).data
    const rgb = new Uint8Array(page.width * page.height * 3)
    for (let source = 0, target = 0; source < rgba.length; source += 4) {
      rgb[target++] = rgba[source]; rgb[target++] = rgba[source + 1]; rgb[target++] = rgba[source + 2]
    }
    return { width: page.width, height: page.height, rgb }
  }
  catch (error) {
    throw error instanceof Error && /冻结|PDF/.test(error.message) ? error : new Error('冻结画面载入失败，请重新冻结后导出。')
  }
  finally {
    clearTimeout(timer)
    image.src = ''
    canvas.width = 1; canvas.height = 1
  }
}

export const createSnapshotPdf = async (pages: SnapshotPdfPage[], options: SnapshotPdfOptions): Promise<Blob> => {
  validateOptions(options, pages.length)
  pages.forEach(validatePng)
  return await composeSnapshotPdf(pages.length, options, index => pngToRgb(pages[index]))
}
