import Dexie, { type EntityTable } from 'dexie'
import { reactive } from 'vue'
import { nanoid } from 'nanoid'
import { saveAs } from 'file-saver'
import { useMainStore, useSlidesStore, useSnapshotStore } from '@/store'
import type { AutomaticPageNumberConfig, PPTElement, Slide, SlideTheme } from '@/types/slides'
import { getEmbeddedFonts, restoreEmbeddedFonts, type EmbeddedFont } from '@/utils/localFonts'
import { renderLatex } from '@/utils/latex'
import { normalizeInlineMathHTML } from '@/utils/inlineMath'
import { preloadOutputConfiguration, saveOutputFile, type OutputFileBinding } from '@/services/outputFiles'
import { assertNativeFileUnchanged, getNativeFileRevision } from '@/utils/nativeFileRevision'
import { normalizeImageShadow } from '@/utils/imageShadow'
import { normalizeHtmlSlide, parseHtmlDocumentAsync, type ImportHtmlOptions, type HtmlViewport } from '@/services/htmlDocument'
import { getPageNumberText, inheritAutoPageNumbers, normalizeAutomaticPageNumberConfig, synchronizeAutoPageNumbers } from '@/utils/pageNumbers'
import { flushPendingHistorySnapshots } from '@/utils/historySnapshots'

/** Native document data. The original PPTist fields remain directly editable. */
export interface LocalDocument {
  title: string
  width: number
  height: number
  theme: SlideTheme
  slides: Slide[]
  embeddedFonts: EmbeddedFont[]
  [key: string]: unknown
}

interface StarterDocument {
  title: string
  theme: SlideTheme
  slides: Slide[]
  viewportSize: number
  viewportRatio: number
  slideIndex?: number
}

interface WritableDocumentFile {
  name: string
  getFile(): Promise<File>
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
  createWritable(): Promise<{
    write(data: string): Promise<void>
    close(): Promise<void>
    abort(): Promise<void>
  }>
}

interface FilePickerWindow {
  showOpenFilePicker?: (options: unknown) => Promise<WritableDocumentFile[]>
  showSaveFilePicker?: (options: unknown) => Promise<WritableDocumentFile>
}

interface SelectedDocumentFile {
  handle: WritableDocumentFile
  revision: string
}

interface StoredDocument {
  id: string
  document: LocalDocument
  slideIndex: number
  updatedAt: number
  fileName: string
  filePath?: string
  fileSavedAt?: number
  outputBinding?: OutputFileBinding
  fileHandle?: WritableDocumentFile
  nativeFileBound?: boolean
  nativeFileRevision?: string
}

// Keep this database separate from the temporary per-session undo database.
const documentDatabase = new Dexie('KeynoteLocalDocuments') as Dexie & {
  documents: EntityTable<StoredDocument, 'id'>
}
documentDatabase.version(1).stores({ documents: 'id' })

export const localDocumentState = reactive({
  ready: false,
  saving: false,
  pending: false,
  restored: false,
  lastSavedAt: 0,
  fileSavedAt: 0,
  fileName: '',
  filePath: '',
  outputDirectory: '',
  nativeFileBound: false,
  needsSaveTarget: false,
  error: '',
})

let fileHandle: WritableDocumentFile | undefined
let nativeFileRevision: string | undefined
let outputBinding: OutputFileBinding | undefined
let extraDocumentFields: Record<string, unknown> = {}
let starterTheme: SlideTheme | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
let maxSaveTimer: ReturnType<typeof setTimeout> | undefined
let pendingWrite: Promise<void> = Promise.resolve()
let documentOperation: Promise<unknown> = Promise.resolve()
let queuedWrites = 0
let documentSession = 0
let revision = 0
let applyingDocument = false
let initialized = false
const subscribers = new Set<(document: LocalDocument) => void>()
const enqueueDocumentOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = documentOperation.catch(() => undefined).then(operation)
  documentOperation = next
  return next
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const positiveNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
const reservedFields = new Set(['title', 'width', 'height', 'theme', 'slides', 'embeddedFonts'])

/** Validate before replacing a document so malformed files cannot erase the canvas. */
export const normalizeLocalDocument = (input: unknown): LocalDocument => {
  const data: unknown = typeof input === 'string' ? JSON.parse(input) : clone(input)
  if (!isObject(data) || !Array.isArray(data.slides) || !data.slides.length) {
    throw new Error('文稿需要至少一张幻灯片，以及完整的 slides 数据。')
  }
  if (!positiveNumber(data.width) || !positiveNumber(data.height)) {
    throw new Error('文稿的 width 和 height 必须为正数。')
  }
  if (!isObject(data.theme) || !Array.isArray(data.theme.themeColors) || !data.theme.themeColors.length || data.theme.themeColors.some(color => typeof color !== 'string')) {
    throw new Error('文稿缺少有效的 theme.themeColors。')
  }
  for (const field of ['backgroundColor', 'fontColor', 'fontName']) {
    if (typeof data.theme[field] !== 'string') throw new Error(`文稿缺少有效的 theme.${field}。`)
  }
  if (!isObject(data.theme.outline) || !isObject(data.theme.shadow)) throw new Error('文稿缺少主题边框或阴影设置。')

  const slideIds = new Set<string>()
  const elementTypes = new Set(['text', 'shape', 'image', 'line', 'chart', 'table', 'latex', 'video', 'audio'])
  for (const slide of data.slides) {
    if (!isObject(slide) || typeof slide.id !== 'string' || !slide.id || !Array.isArray(slide.elements) || slideIds.has(slide.id)) {
      throw new Error('每张幻灯片需要唯一 id 和 elements 数组。')
    }
    slideIds.add(slide.id)
    if (slide.html !== undefined) slide.html = normalizeHtmlSlide(slide.html)
    const elementIds = new Set<string>()
    for (const element of slide.elements) {
      if (!isObject(element) || typeof element.id !== 'string' || !element.id || elementIds.has(element.id) || !elementTypes.has(String(element.type))) {
        throw new Error(`幻灯片 ${slide.id} 包含无效类型或重复 id 的元素。`)
      }
      elementIds.add(element.id)
      for (const field of ['left', 'top', 'width']) {
        if (typeof element[field] !== 'number' || !Number.isFinite(element[field])) throw new Error(`元素 ${element.id} 的 ${field} 必须是有限数值。`)
      }
      if (element.type === 'line') {
        if ((element.width as number) < 0) throw new Error(`线条 ${element.id} 的 width 不能为负数。`)
        for (const field of ['start', 'end']) {
          const point = element[field]
          if (!Array.isArray(point) || point.length !== 2 || point.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`线条 ${element.id} 的 ${field} 必须是坐标对。`)
        }
      }
      else {
        if (!positiveNumber(element.width) || !positiveNumber(element.height)) throw new Error(`元素 ${element.id} 的 width 和 height 必须为正数。`)
        if (typeof element.rotate !== 'number' || !Number.isFinite(element.rotate)) throw new Error(`元素 ${element.id} 的 rotate 必须是有限数值。`)
      }
      if (element.type === 'text' && typeof element.content !== 'string') throw new Error(`文本框 ${element.id} 缺少 HTML content。`)
      if (element.type === 'text') element.content = normalizeInlineMathHTML(element.content as string)
      if (element.autoPageNumber !== undefined) {
        if (element.type !== 'text') throw new Error(`元素 ${element.id} 的自动页码只能用于文本框。`)
        normalizeAutomaticPageNumberConfig(element.autoPageNumber)
      }
      if (element.type === 'shape' && isObject(element.text) && typeof element.text.content === 'string') {
        element.text.content = normalizeInlineMathHTML(element.text.content)
      }
      if (element.type === 'image') {
        if (typeof element.src !== 'string') throw new Error(`图片 ${element.id} 缺少 src。`)
        if (element.shadow !== undefined) element.shadow = normalizeImageShadow(element.shadow)
      }
      if (element.type === 'latex') {
        if (typeof element.latex !== 'string' || !element.latex.trim()) throw new Error(`公式 ${element.id} 缺少非空 LaTeX 源码。`)
        // LaTeX is authoritative: agent JSON edits must never retain a stale or
        // untrusted SVG. Keep slide geometry while rebuilding local glyphs.
        const rendered = renderLatex(element.latex)
        element.latex = rendered.latex
        element.svg = rendered.svg
        element.path = ''
        element.viewBox = [rendered.w, rendered.h]
        element.color = typeof element.color === 'string' ? element.color : data.theme.fontColor
        element.strokeWidth = 0
        element.fixedRatio = typeof element.fixedRatio === 'boolean' ? element.fixedRatio : true
      }
    }
  }
  data.slides = synchronizeAutoPageNumbers(data.slides as Slide[])
  if (data.embeddedFonts !== undefined && !Array.isArray(data.embeddedFonts)) throw new Error('embeddedFonts 必须是数组。')
  for (const font of (data.embeddedFonts || []) as unknown[]) {
    if (!isObject(font) || ['id', 'family', 'name', 'mime', 'dataUrl'].some(field => typeof font[field] !== 'string') || !String(font.dataUrl).startsWith('data:')) {
      throw new Error('嵌入字体数据不完整。')
    }
  }
  return { ...data, title: typeof data.title === 'string' && data.title ? data.title : '未命名演示文稿', embeddedFonts: data.embeddedFonts || [] } as LocalDocument
}

export const getLocalDocument = (): LocalDocument => {
  const store = useSlidesStore()
  return clone({
    ...extraDocumentFields,
    title: store.title,
    width: store.viewportSize,
    height: store.viewportSize * store.viewportRatio,
    theme: store.theme,
    slides: store.slides,
    embeddedFonts: getEmbeddedFonts(),
  })
}

/** Await this to know that the latest document is durably stored in IndexedDB. */
export const flushLocalDocument = (): Promise<void> => {
  if (saveTimer) clearTimeout(saveTimer)
  if (maxSaveTimer) clearTimeout(maxSaveTimer)
  saveTimer = undefined
  maxSaveTimer = undefined
  if (!localDocumentState.ready || applyingDocument) return pendingWrite
  const document = getLocalDocument()
  const store = useSlidesStore()
  const writeRevision = revision
  const record: StoredDocument = {
    id: 'current',
    document,
    slideIndex: store.slideIndex,
    updatedAt: Date.now(),
    fileName: localDocumentState.fileName,
    filePath: localDocumentState.filePath,
    fileSavedAt: localDocumentState.fileSavedAt,
    outputBinding: outputBinding ? { ...outputBinding } : undefined,
    fileHandle,
    nativeFileBound: localDocumentState.nativeFileBound || localDocumentState.needsSaveTarget,
    nativeFileRevision,
  }
  localDocumentState.saving = true
  queuedWrites++
  pendingWrite = pendingWrite.catch(() => undefined).then(async () => {
    try {
      try {
        await documentDatabase.documents.put(record)
      }
      catch (error) {
        // Native handles are serializable in supporting browsers. If a browser
        // cannot persist one, keep the document and require a target next time.
        if (!record.fileHandle || (error as Error).name !== 'DataCloneError') throw error
        await documentDatabase.documents.put({ ...record, fileHandle: undefined })
      }
      localDocumentState.lastSavedAt = record.updatedAt
      localDocumentState.error = ''
      if (writeRevision === revision) localDocumentState.pending = false
    }
    catch (error) {
      localDocumentState.error = `自动保存失败：${error instanceof Error ? error.message : '本地存储不可用'}。请保存或下载 JSON 备份。`
      throw error
    }
    finally {
      queuedWrites--
      localDocumentState.saving = queuedWrites > 0
    }
  })
  return pendingWrite
}

const scheduleLocalSave = () => {
  if (!localDocumentState.ready || applyingDocument) return
  revision++
  localDocumentState.pending = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void flushLocalDocument().catch(() => undefined) 
  }, 350)
  if (!maxSaveTimer) {
    maxSaveTimer = setTimeout(() => {
      void flushLocalDocument().catch(() => undefined) 
    }, 1800)
  }
  window.dispatchEvent(new CustomEvent('keynote-local:change', { detail: { revision } }))
  if (subscribers.size) {
    const document = getLocalDocument()
    for (const subscriber of subscribers) {
      try {
        subscriber(document) 
      }
      catch { /* A consumer must not interrupt the editor's save path. */ }
    }
  }
}

const applyDocument = async (document: LocalDocument, slideIndex = 0, resetHistory = true) => {
  const previousFonts = getEmbeddedFonts()
  applyingDocument = true
  try {
    await restoreEmbeddedFonts(document.embeddedFonts)
    const nextIndex = Math.min(Math.max(0, slideIndex), document.slides.length - 1)
    // The undo reset is transactional; failed writes leave the old undo history intact.
    // Do this before touching the canvas so a storage failure cannot half-load a file.
    if (resetHistory) await useSnapshotStore().initSnapshotDatabase(document.slides, nextIndex)
    extraDocumentFields = Object.fromEntries(Object.entries(document).filter(([key]) => !reservedFields.has(key)))
    const store = useSlidesStore()
    useMainStore().setActiveElementIdList([])
    store.$patch({
      title: document.title,
      theme: clone(document.theme),
      slides: clone(document.slides),
      viewportSize: document.width,
      viewportRatio: document.height / document.width,
      slideIndex: nextIndex,
    })
  }
  catch (error) {
    await restoreEmbeddedFonts(previousFonts)
    throw error
  }
  finally {
    applyingDocument = false
    // A debounce timer may have fired while a file/font was being prepared.
    // Resume any pending save even when that import ultimately failed.
    if (localDocumentState.ready && localDocumentState.pending) scheduleLocalSave()
  }
}

const replaceLocalDocument = async (document: LocalDocument, openedFile?: { file: File; handle?: WritableDocumentFile; revision?: string }) => {
  await applyDocument(document)
  documentSession++
  fileHandle = openedFile?.handle
  nativeFileRevision = openedFile?.revision
  localDocumentState.nativeFileBound = !!fileHandle
  localDocumentState.needsSaveTarget = false
  outputBinding = undefined
  localDocumentState.fileName = openedFile?.file.name || ''
  localDocumentState.filePath = ''
  localDocumentState.fileSavedAt = 0
  scheduleLocalSave()
  await flushLocalDocument().catch(() => undefined)
  return getLocalDocument()
}

export const loadLocalDocument = (input: LocalDocument | string | unknown) => {
  const document = normalizeLocalDocument(input)
  return enqueueDocumentOperation(() => replaceLocalDocument(document))
}

export const openLocalDocumentFile = (file: File | Promise<File>, handle?: WritableDocumentFile) => {
  const selectedFile = Promise.resolve(file)
  void selectedFile.catch(() => undefined)
  return enqueueDocumentOperation(async () => {
    const source = await selectedFile
    const [contents, revision] = await Promise.all([source.text(), handle ? getNativeFileRevision(source) : undefined])
    const document = normalizeLocalDocument(contents)
    // A renamed/copied JSON can still carry another presentation's old title.
    // File-open identity follows the selected file; API loads retain their title.
    document.title = source.name.replace(/\.json$/i, '') || document.title
    return replaceLocalDocument(document, { file: source, handle, revision })
  })
}

const pickerWindow = window as Window & FilePickerWindow
export const supportsLocalFilePicker = () => !!pickerWindow.showOpenFilePicker
export const openLocalDocumentPicker = async () => {
  if (!pickerWindow.showOpenFilePicker) return false
  // Some macOS file associations classify .json as text or an unknown type.
  // Avoid native filtering; openLocalDocumentFile validates JSON and its schema
  // before replacing the current document or binding the selected file.
  const [handle] = await pickerWindow.showOpenFilePicker({
    multiple: false,
  })
  await openLocalDocumentFile(handle.getFile(), handle)
  return true
}

const documentFilename = () => {
  const encoder = new TextEncoder()
  const cleanTitle = [...useSlidesStore().title].map(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '-' : character).join('')
  const title = cleanTitle.replace(/[\\/:*?"<>|]/g, '-').trim() || '未命名演示文稿'
  // Keep the server's 240-byte basename limit without splitting UTF-8 or emoji.
  // Roundtrip also replaces isolated surrogate code units with valid Unicode.
  const stem = new TextDecoder().decode(encoder.encode(title))
  let name = ''
  let bytes = 0
  for (const character of stem) {
    const length = encoder.encode(character).length
    if (bytes + length > 235) break
    name += character
    bytes += length
  }
  return `${name}.json`
}

export const downloadLocalDocument = () => {
  const blob = new Blob([JSON.stringify(getLocalDocument(), null, 2)], { type: 'application/json;charset=utf-8' })
  saveAs(blob, documentFilename())
}

const writeLocalDocumentFile = async (options: { saveAs?: boolean }, nativeSelection?: Promise<SelectedDocumentFile>) => {
  const session = documentSession
  const contents = JSON.stringify(getLocalDocument(), null, 2)
  const suggestedName = options.saveAs ? documentFilename() : localDocumentState.fileName || documentFilename()
  const selected = options.saveAs || localDocumentState.needsSaveTarget ? await nativeSelection : undefined
  let target = options.saveAs || localDocumentState.needsSaveTarget ? selected?.handle : fileHandle
  let expectedRevision = selected?.revision ?? nativeFileRevision
  if (localDocumentState.needsSaveTarget && !target) throw new Error('请重新选择此文稿的保存位置。')
  await flushLocalDocument().catch(() => undefined)
  if (!target && !options.saveAs) {
    const result = await saveOutputFile(contents, outputBinding?.fileName || localDocumentState.fileName || suggestedName, outputBinding)
    if (result) {
      if (session !== documentSession) return result
      outputBinding = { fileName: result.fileName, fileKey: result.fileKey, revision: result.revision }
      localDocumentState.fileName = result.fileName
      localDocumentState.filePath = result.path
      localDocumentState.fileSavedAt = Date.now()
      localDocumentState.needsSaveTarget = false
      await flushLocalDocument().catch(() => undefined)
      return result
    }
    // The standalone/static build retains its ordinary browser save behavior.
    if (pickerWindow.showSaveFilePicker) {
      target = await pickerWindow.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Keynote Local 文稿', accept: { 'application/json': ['.json'] } }],
      })
      expectedRevision = await getNativeFileRevision(await target.getFile())
    }
  }
  if (!target) {
    saveAs(new Blob([contents], { type: 'application/json;charset=utf-8' }), suggestedName)
    return { method: 'download' as const, fileName: suggestedName }
  }
  if (target.requestPermission && await target.requestPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('未获得此文件的写入权限，请重新点击保存并允许访问，或选择另存为。')
  }
  if (session !== documentSession) throw new Error('文稿已切换，请保存当前文稿。')
  const nextNativeRevision = await getNativeFileRevision(contents)
  await assertNativeFileUnchanged(target, expectedRevision)
  const writable = await target.createWritable()
  try {
    await writable.write(contents)
    // The native stream writes a temporary file until close. Recheck the live
    // destination before committing, including edits made while writing.
    await assertNativeFileUnchanged(target, expectedRevision)
    await writable.close()
  }
  catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
  if (session !== documentSession) return { method: 'file' as const, fileName: target.name }
  fileHandle = target
  nativeFileRevision = nextNativeRevision
  localDocumentState.nativeFileBound = true
  localDocumentState.needsSaveTarget = false
  outputBinding = undefined
  localDocumentState.fileName = target.name
  localDocumentState.filePath = ''
  localDocumentState.fileSavedAt = Date.now()
  await flushLocalDocument().catch(() => undefined)
  return { method: 'file' as const, fileName: target.name }
}

export const saveLocalDocumentFile = (options: { saveAs?: boolean } = {}) => {
  const session = documentSession
  // Save As must start its picker inside the click gesture, before queueing.
  const nativeSelection = (options.saveAs || localDocumentState.needsSaveTarget) && pickerWindow.showSaveFilePicker ? pickerWindow.showSaveFilePicker({
    suggestedName: options.saveAs ? documentFilename() : localDocumentState.fileName || documentFilename(),
    types: [{ description: 'Keynote Local 文稿', accept: { 'application/json': ['.json'] } }],
  }).then(async handle => ({ handle, revision: await getNativeFileRevision(await handle.getFile()) })) : undefined
  void nativeSelection?.catch(() => undefined)
  return enqueueDocumentOperation(() => {
    if (nativeSelection && session !== documentSession) throw new Error('文稿已切换，请保存当前文稿。')
    return writeLocalDocumentFile(options, nativeSelection)
  })
}

export const newLocalDocument = () => {
  const store = useSlidesStore()
  const theme = clone(starterTheme || store.theme)
  return loadLocalDocument({
    title: '未命名演示文稿', width: 1000, height: 562.5,
    theme,
    slides: [{ id: nanoid(10), elements: [], background: { type: 'solid', color: theme.backgroundColor } }],
    embeddedFonts: [],
  })
}

export const importHtmlDocument = async (source: string, options: ImportHtmlOptions = { mode: 'append' }) => {
  if (options.mode !== 'append' && options.mode !== 'replace') throw new Error('HTML 导入方式必须为 append 或 replace。')
  // Decompression must not hold the document queue or execute the exported JS.
  // Capture its target now, and check again inside the mutation queue: a file
  // opened while decoding must never receive an import intended for the old one.
  const session = documentSession
  const mode = options.mode
  const viewport = options.viewport ? { ...options.viewport } : undefined
  const parsed = await parseHtmlDocumentAsync(source)
  if (session !== documentSession) throw new Error('文稿已切换，未导入任何 HTML 页面，请在当前文稿中重新导入。')
  if (parsed.kind === 'html' && viewport) parsed.slides[0].html = normalizeHtmlSlide({ ...parsed.slides[0].html, ...viewport })
  const imported = parsed.kind === 'document' ? normalizeLocalDocument(parsed.document) : undefined
  return enqueueDocumentOperation(async () => {
    if (session !== documentSession) throw new Error('文稿已切换，未导入任何 HTML 页面，请在当前文稿中重新导入。')
    if (mode === 'replace') {
      const document = imported || normalizeLocalDocument({ ...getLocalDocument(), title: parsed.kind === 'html' ? parsed.title : 'HTML 页面', slides: parsed.kind === 'html' ? parsed.slides : [], embeddedFonts: [] })
      return replaceLocalDocument(document)
    }
    const document = getLocalDocument()
    if (imported && (imported.width !== document.width || imported.height !== document.height)) throw new Error('HTML 文稿的页面尺寸与当前文稿不同，请选择替换导入以保留原始版式。')
    const additions = clone(imported?.slides || (parsed.kind === 'html' ? parsed.slides : []))
    const ids = new Set(document.slides.map(slide => slide.id))
    const remapped = new Map<string, string>()
    for (const slide of additions) {
      const previous = slide.id
      while (ids.has(slide.id)) slide.id = nanoid(10)
      ids.add(slide.id)
      remapped.set(previous, slide.id)
    }
    for (const slide of additions) {
      for (const element of slide.elements) {
        if (element.link?.type === 'slide' && remapped.has(element.link.target)) element.link.target = remapped.get(element.link.target)!
      }
    }
    for (const font of imported?.embeddedFonts || []) {
      const existing = document.embeddedFonts.find(current => current.id === font.id || current.family === font.family)
      if (existing && (existing.family !== font.family || existing.dataUrl !== font.dataUrl)) throw new Error(`嵌入字体“${font.family}”与当前文稿冲突，请选择替换导入。`)
      if (!existing) document.embeddedFonts.push(font)
    }
    const firstAddedIndex = document.slides.length
    document.slides.push(...inheritAutoPageNumbers(additions, [...document.slides].reverse()))
    const checked = normalizeLocalDocument(document)
    await applyDocument(checked, firstAddedIndex, false)
    await useSnapshotStore().addSnapshot()
    await flushLocalDocument()
    return getLocalDocument()
  })
}

export const updateHtmlSlideSource = (slideId: string, source: string, viewport?: HtmlViewport) => {
  return enqueueDocumentOperation(async () => {
    const document = getLocalDocument()
    const slide = document.slides.find(slide => slide.id === slideId)
    if (!slide) throw new Error('指定 HTML 幻灯片不存在。')
    // Source/viewport edits must not reset the position chosen on the canvas.
    const html = normalizeHtmlSlide({ ...slide.html, source, width: viewport?.width, height: viewport?.height })
    slide.html = html
    normalizeLocalDocument(document)
    useSlidesStore().updateSlide({ html }, slideId)
    await useSnapshotStore().addSnapshot()
    await flushLocalDocument()
    return getLocalDocument()
  })
}

const selectSlide = (idOrIndex: string | number) => {
  const store = useSlidesStore()
  const index = typeof idOrIndex === 'number' ? idOrIndex : store.slides.findIndex(slide => slide.id === idOrIndex)
  if (!Number.isInteger(index) || index < 0 || index >= store.slides.length) throw new Error('幻灯片不存在。')
  useMainStore().setActiveElementIdList([])
  store.updateSlideIndex(index)
}

const updateElement = (slideId: string, elementId: string, props: Partial<PPTElement>) => {
  return enqueueDocumentOperation(async () => {
    const document = getLocalDocument()
    const slide = document.slides.find(slide => slide.id === slideId)
    const index = slide?.elements.findIndex(element => element.id === elementId) ?? -1
    if (!slide || index < 0) throw new Error('指定元素不存在。')
    const previous = slide.elements[index]
    const updated = { ...previous, ...clone(props), id: elementId } as PPTElement
    const detachNumber = previous.type === 'text' && previous.autoPageNumber && updated.type === 'text' && 'content' in props && !('autoPageNumber' in props) && getPageNumberText(updated.content) !== getPageNumberText(previous.content)
    if (detachNumber && updated.type === 'text') delete updated.autoPageNumber
    slide.elements[index] = updated
    const checked = normalizeLocalDocument(document)
    const normalizedElement = checked.slides.find(item => item.id === slideId)!.elements[index]
    const normalizedProps = { ...clone(props), id: elementId }
    if (detachNumber) Object.assign(normalizedProps, { autoPageNumber: undefined })
    if (normalizedElement.type === 'text' && 'content' in props) Object.assign(normalizedProps, { content: normalizedElement.content })
    if (normalizedElement.type === 'shape' && 'text' in props) Object.assign(normalizedProps, { text: normalizedElement.text })
    useSlidesStore().updateElement({ id: elementId, props: normalizedProps, slideId })
    await useSnapshotStore().addSnapshot()
    await flushLocalDocument()
    return getLocalDocument()
  })
}

export const setAutomaticPageNumbers = (config: AutomaticPageNumberConfig, replaceExisting = false) => {
  const checked = normalizeAutomaticPageNumberConfig(config)
  const session = documentSession
  return enqueueDocumentOperation(async () => {
    if (session !== documentSession) throw new Error('文稿已切换，未修改自动页码，请在当前文稿中重新设置。')
    await flushPendingHistorySnapshots()
    useSlidesStore().setAutomaticPageNumbers(checked, replaceExisting)
    await useSnapshotStore().addSnapshot()
    await flushLocalDocument()
    return getLocalDocument()
  })
}

export const removeAutomaticPageNumbers = () => {
  const session = documentSession
  return enqueueDocumentOperation(async () => {
    if (session !== documentSession) throw new Error('文稿已切换，未移除自动页码，请在当前文稿中重新设置。')
    await flushPendingHistorySnapshots()
    useSlidesStore().removeAutomaticPageNumbers()
    await useSnapshotStore().addSnapshot()
    await flushLocalDocument()
    return getLocalDocument()
  })
}

const createAgentApi = () => Object.freeze({
  version: '1.0',
  getDocument: getLocalDocument,
  loadDocument: loadLocalDocument,
  setDocument: loadLocalDocument,
  save: saveLocalDocumentFile,
  flush: flushLocalDocument,
  download: downloadLocalDocument,
  newDocument: newLocalDocument,
  getStatus: () => clone(localDocumentState),
  getSelection: () => ({ slideIndex: useSlidesStore().slideIndex, slideId: useSlidesStore().currentSlide?.id, elementIds: [...useMainStore().activeElementIdList] }),
  selectSlide,
  updateElement,
  setAutomaticPageNumbers,
  removeAutomaticPageNumbers,
  importHtmlDocument,
  updateHtmlSlideSource,
  subscribe: (listener: (document: LocalDocument) => void) => {
    subscribers.add(listener)
    return () => {
      subscribers.delete(listener) 
    }
  },
})

const installAgentApi = () => {
  const api = createAgentApi()
  window.keynoteLocal = api
  window.dispatchEvent(new Event('keynote-local:ready'))
}

export type KeynoteLocalApi = ReturnType<typeof createAgentApi>

declare global {
  interface Window { keynoteLocal: KeynoteLocalApi }
}

export const initializeLocalDocument = async (createStarter: () => Promise<StarterDocument>) => {
  if (initialized) return
  // Discover the loopback server before a later Save click needs a native picker.
  void preloadOutputConfiguration().then(config => {
    localDocumentState.outputDirectory = config?.outputDirectory || ''
  }).catch(() => undefined)
  const starter = await createStarter()
  starterTheme = clone(starter.theme)
  let stored: StoredDocument | undefined
  let restoreError = ''
  try {
    stored = await documentDatabase.documents.get('current')
    if (stored) {
      const restored = normalizeLocalDocument(stored.document)
      // Migrate pre-binding records that retained a copied JSON's old title.
      // New records keep deliberate title edits independently of the filename.
      if (stored.nativeFileBound === undefined && stored.fileName && !stored.outputBinding && !stored.filePath) {
        restored.title = stored.fileName.replace(/\.json$/i, '') || restored.title
      }
      await applyDocument(restored, stored.slideIndex, false)
      localDocumentState.restored = true
      localDocumentState.lastSavedAt = stored.updatedAt
      localDocumentState.fileName = stored.fileName || ''
      localDocumentState.filePath = stored.filePath || ''
      localDocumentState.fileSavedAt = stored.fileSavedAt || 0
      outputBinding = stored.outputBinding ? { ...stored.outputBinding } : undefined
      fileHandle = stored.fileHandle
      nativeFileRevision = typeof stored.nativeFileRevision === 'string' && /^[a-f0-9]{64}$/.test(stored.nativeFileRevision) ? stored.nativeFileRevision : undefined
      localDocumentState.nativeFileBound = !!fileHandle
      localDocumentState.needsSaveTarget = (!!fileHandle && !nativeFileRevision) || (!fileHandle && !!stored.fileName && !outputBinding &&
        stored.nativeFileBound !== false && !!pickerWindow.showSaveFilePicker)
    }
  }
  catch (error) {
    restoreError = `未能恢复上次文稿：${error instanceof Error ? error.message : '本地存储不可用'}。请打开已保存的 JSON 文件。`
    stored = undefined
  }
  if (!stored) {
    const document = normalizeLocalDocument({
      title: starter.title,
      width: starter.viewportSize,
      height: starter.viewportSize * starter.viewportRatio,
      theme: starter.theme,
      slides: starter.slides,
      embeddedFonts: [],
    })
    await applyDocument(document, starter.slideIndex, false)
  }
  initialized = true
  localDocumentState.ready = true
  localDocumentState.error = restoreError
  useSlidesStore().$subscribe(scheduleLocalSave, { detached: true, flush: 'sync' })
  window.addEventListener('keynote-local:assets-changed', scheduleLocalSave)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushLocalDocument().catch(() => undefined)
  })
  window.addEventListener('pagehide', () => {
    void flushLocalDocument().catch(() => undefined) 
  })
  window.addEventListener('beforeunload', () => {
    void flushLocalDocument().catch(() => undefined) 
  })
  window.addEventListener('keydown', event => {
    if (!event.metaKey && !event.ctrlKey) return
    const key = event.key.toLowerCase()
    if (key !== 's' && key !== 'o') return
    event.preventDefault()
    event.stopPropagation()
    if (key === 'o') window.dispatchEvent(new Event('keynote-local:open'))
    else window.dispatchEvent(new CustomEvent('keynote-local:save', { detail: { saveAs: event.shiftKey } }))
  }, true)
  installAgentApi()
  if (!restoreError) await flushLocalDocument().catch(() => undefined)
}
