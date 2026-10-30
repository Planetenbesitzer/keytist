interface NativeRevisionFileHandle {
  getFile(): Promise<File>
}

const unknownRevision = '无法确认原文件是否已在外部修改，请重新选择文件或另存为，避免覆盖。'
const unreadableFile = '无法读取原文件，请重新选择文件或另存为，避免覆盖。'
const changedFile = '文件已在外部修改或替换。请另存为新文件，避免覆盖。'

/** Hash the original bytes, including BOM and whitespace. File size and mtime
 * alone cannot detect replacements with identical metadata or JSON formatting.
 */
export const getNativeFileRevision = async (input: Blob | string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('此浏览器不支持原文件修改检查，请使用本机地址或升级浏览器后重试。')

  let bytes: ArrayBuffer | Uint8Array
  try {
    bytes = typeof input === 'string' ? new TextEncoder().encode(input) : await input.arrayBuffer()
  }
  catch {
    throw new Error(unreadableFile)
  }
  let digest: ArrayBuffer
  try {
    digest = await subtle.digest('SHA-256', bytes)
  }
  catch {
    throw new Error('无法校验原文件是否已被修改，未执行保存。请重新选择文件或另存为。')
  }
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** A missing baseline must not become implicit permission to overwrite the
 * current disk file. The caller keeps its document and binding on every error.
 */
export const assertNativeFileUnchanged = async (handle: NativeRevisionFileHandle, expected: string | undefined): Promise<void> => {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error(unknownRevision)
  let file: File
  try {
    file = await handle.getFile()
  }
  catch {
    throw new Error(unreadableFile)
  }
  if (await getNativeFileRevision(file) !== expected.toLowerCase()) throw new Error(changedFile)
}
