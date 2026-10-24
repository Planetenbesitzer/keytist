/** WOFF2 decoding is needed to inspect cmap/embedding flags, never to reshape or
 * rebuild glyphs. The decoder is a lazy, self-contained build of Google WOFF2. */
export const MAX_DECODED_FONT_BYTES = 30 * 1024 * 1024

const WOFF2_SIGNATURE = 0x774f4632
const TTC_SIGNATURE = 0x74746366
const sfntSignatures = new Set([0x00010000, 0x4f54544f, 0x74727565, 0x74797031])
const bytesOf = (input: ArrayBuffer | Uint8Array) => input instanceof Uint8Array ? input : new Uint8Array(input)
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const validateWoff2Directory = (bytes: Uint8Array, count: number) => {
  if (count > 4095) throw new Error('WOFF2 字体包含过多字体表。')
  let cursor = 48, originalTotal = 0, transformedTotal = 0
  const readBase128 = () => {
    let result = 0
    for (let index = 0; index < 5; index++) {
      if (cursor >= bytes.length) throw new Error('WOFF2 字体表目录不完整。')
      const byte = bytes[cursor++]
      if ((!index && byte === 0x80) || result > 0x1ffffff) throw new Error('WOFF2 字体表长度无效。')
      result = result * 128 + (byte & 0x7f)
      if (!(byte & 0x80)) return result
    }
    throw new Error('WOFF2 字体表长度无效。')
  }
  for (let index = 0; index < count; index++) {
    if (cursor >= bytes.length) throw new Error('WOFF2 字体表目录不完整。')
    const flags = bytes[cursor++], tag = flags & 0x3f, transform = flags >>> 6
    let glyphTable = tag === 10 || tag === 11
    if (tag === 63) {
      if (cursor + 4 > bytes.length) throw new Error('WOFF2 字体表名称不完整。')
      const customTag = String.fromCharCode(...bytes.subarray(cursor, cursor + 4))
      glyphTable = customTag === 'glyf' || customTag === 'loca'
      cursor += 4
    }
    const length = readBase128()
    const transformedLength = (glyphTable ? transform !== 3 : transform !== 0) ? readBase128() : length
    originalTotal += length
    transformedTotal += transformedLength
    if (originalTotal > MAX_DECODED_FONT_BYTES || transformedTotal > MAX_DECODED_FONT_BYTES) {
      throw new Error('WOFF2 字体超过 30 MiB 解码限制，请导入单独的字体文件。')
    }
  }
  if (cursor + viewOf(bytes).getUint32(20) > bytes.length) throw new Error('WOFF2 字体压缩数据不完整。')
}

export const isWoff2Font = (input: ArrayBuffer | Uint8Array): boolean => {
  const bytes = bytesOf(input)
  return bytes.byteLength >= 4 && viewOf(bytes).getUint32(0) === WOFF2_SIGNATURE
}

const validateDecodedFont = (bytes: Uint8Array) => {
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_DECODED_FONT_BYTES) throw new Error('WOFF2 字体解压后的大小无效或超过 30 MiB 限制。')
  const view = viewOf(bytes)
  const validateFace = (offset: number) => {
    if (offset > bytes.byteLength - 12 || !sfntSignatures.has(view.getUint32(offset))) throw new Error('WOFF2 字体解压后缺少有效的字体目录。')
    const tables = view.getUint16(offset + 4)
    if (!tables || tables > 4095 || offset + 12 + tables * 16 > bytes.byteLength) throw new Error('WOFF2 字体表目录损坏。')
    for (let index = 0; index < tables; index++) {
      const table = offset + 12 + index * 16
      const start = view.getUint32(table + 8), length = view.getUint32(table + 12)
      if (start > bytes.byteLength || length > bytes.byteLength - start) throw new Error('WOFF2 字体表数据不完整。')
    }
  }
  if (view.getUint32(0) !== TTC_SIGNATURE) return validateFace(0)
  const faces = view.getUint32(8)
  if (!faces || faces > 256 || 12 + faces * 4 > bytes.byteLength) throw new Error('WOFF2 字体集合目录无效。')
  for (let index = 0; index < faces; index++) validateFace(view.getUint32(12 + index * 4))
}

/** Decode a webfont for metadata/character coverage checks. Original WOFF2
 * bytes can still be embedded; no subset or font-table rewrite is performed. */
export const decodeWoff2Font = async (input: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> => {
  const bytes = bytesOf(input)
  if (!isWoff2Font(bytes) || bytes.byteLength < 48) throw new Error('WOFF2 字体文件头无效。')
  const view = viewOf(bytes)
  if (view.getUint32(8) !== bytes.byteLength || !view.getUint16(12) || !view.getUint32(20) || view.getUint32(20) > bytes.byteLength - 48) {
    throw new Error('WOFF2 字体文件不完整。')
  }
  // totalSfntSize is advisory: transformed glyf/loca tables may change length
  // during reconstruction. Never require decoded length to equal this field.
  if (view.getUint32(16) > MAX_DECODED_FONT_BYTES || bytes.byteLength > MAX_DECODED_FONT_BYTES) {
    throw new Error('WOFF2 字体超过 30 MiB 解码限制，请导入单独的字体文件。')
  }
  validateWoff2Directory(bytes, view.getUint16(12))
  try {
    const { default: decompress } = await import('woff2-encoder/decompress')
    // Copy exactly the view's range: imported Buffer/Uint8Array instances may
    // share a larger allocation with unrelated bytes.
    const decoded = await decompress(bytes.slice())
    validateDecodedFont(decoded)
    return decoded.slice().buffer
  }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('WOFF2 ')) throw error
    throw new Error('WOFF2 字体无法解码，请重新导入有效的字体文件。')
  }
}
