/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Execute the complete production service. Only the browser, stores and I/O are
// seams; open/save queues, validation, identity and persistence run unchanged.
const source = await readFile(new URL('../../src/services/localDocument.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const nativeRevisionSource = await readFile(new URL('../../src/utils/nativeFileRevision.ts', import.meta.url), 'utf8')
const nativeRevisionCompiled = ts.transpileModule(nativeRevisionSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const nativeRevision = {}
new Function('exports', nativeRevisionCompiled)(nativeRevision)
const clone = value => JSON.parse(JSON.stringify(value))
const theme = { themeColors: ['#123456'], backgroundColor: '#fff', fontColor: '#000', fontName: 'Arial', outline: {}, shadow: {} }
const documentFor = (title = 'tevworkshop_v2', slideId = title) => ({
  title, width: 1000, height: 562.5, theme: clone(theme),
  slides: [{ id: slideId, elements: [] }], embeddedFonts: [],
})
const deferred = () => {
  let resolve
  const promise = new Promise(done => resolve = done)
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const handleFor = (name, document, { permission = 'granted', onWritable } = {}) => {
  const writes = [], permissions = [], temporaryWrites = []
  let contents = JSON.stringify(document), lastModified = 123, readError
  let writableCount = 0, abortCount = 0
  const handle = {
    name, writes, permissions, temporaryWrites,
    get contents() {
      return contents
    },
    get writableCount() {
      return writableCount
    },
    get abortCount() {
      return abortCount
    },
    externalWrite: (value, options = {}) => {
      contents = typeof value === 'string' ? value : JSON.stringify(value)
      lastModified = options.lastModified ?? lastModified
    },
    failReads: error => readError = error,
    getFile: () => readError ? Promise.reject(readError) : Promise.resolve(new File([contents], name, { type: 'application/json', lastModified })),
    requestPermission: options => {
      permissions.push(options); return Promise.resolve(permission)
    },
    createWritable: async () => {
      writableCount++
      if (onWritable) await onWritable()
      let pending
      return {
        write: value => {
          temporaryWrites.push(value); pending = value; return Promise.resolve()
        },
        close: () => {
          contents = pending; lastModified++
          writes.push(JSON.parse(pending)); return Promise.resolve()
        },
        abort: () => {
          abortCount++; return Promise.resolve()
        },
      }
    },
  }
  return handle
}
const storageFor = record => ({ record, puts: [], rejectHandles: false, failWith: undefined })
const createHarness = async ({ storage = storageFor(), native = true, serverUnavailable = false } = {}) => {
  const subscribers = new Set()
  let fonts = []
  let nextOpen, nextSave
  const calls = { open: [], pickSave: [], server: [], downloads: [] }
  const store = {
    title: 'Starter', viewportSize: 1000, viewportRatio: 0.5625,
    theme: clone(theme), slides: [{ id: 'starter', elements: [] }], slideIndex: 0,
    get currentSlide() {
      return this.slides[this.slideIndex]
    },
    $patch(value) {
      Object.assign(this, value); for (const subscriber of subscribers) subscriber()
    },
    $subscribe(callback) {
      subscribers.add(callback)
    },
    setTitle(value) {
      this.title = value; for (const subscriber of subscribers) subscriber()
    },
  }
  class MemoryDatabase {
    documents = {
      get: () => Promise.resolve(storage.record),
      put: record => {
        storage.puts.push(record)
        if (storage.failWith) throw storage.failWith
        if (storage.rejectHandles && record.fileHandle) throw new DOMException('Handle cannot be cloned', 'DataCloneError')
        storage.record = { ...record, document: clone(record.document) }
        return Promise.resolve()
      },
    }
    version() {
      return { stores() {} }
    }
  }
  const window = new EventTarget()
  if (native) {
    window.showOpenFilePicker = options => {
      calls.open.push(options)
      if (nextOpen instanceof Error) return Promise.reject(nextOpen)
      return Promise.resolve([nextOpen])
    }
    window.showSaveFilePicker = options => {
      calls.pickSave.push(options)
      if (nextSave instanceof Error) return Promise.reject(nextSave)
      return Promise.resolve(typeof nextSave === 'function' ? nextSave() : nextSave)
    }
  }
  const dom = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const dependencies = {
    dexie: { default: MemoryDatabase },
    vue: { reactive: value => value },
    nanoid: { nanoid: () => 'new-id' },
    'file-saver': { saveAs: (blob, name) => calls.downloads.push({ blob, name }) },
    '@/store': {
      useSlidesStore: () => store,
      useMainStore: () => ({ setActiveElementIdList() {} }),
      useSnapshotStore: () => ({ initSnapshotDatabase: async () => {}, addSnapshot: async () => {} }),
    },
    '@/utils/localFonts': { getEmbeddedFonts: () => fonts, restoreEmbeddedFonts: value => Promise.resolve(fonts = value) },
    '@/utils/latex': { renderLatex: () => assert.fail('No formula fixture') },
    '@/utils/inlineMath': { normalizeInlineMathHTML: value => value },
    '@/services/outputFiles': {
      preloadOutputConfiguration: () => Promise.resolve({ outputDirectory: '/isolated' }),
      saveOutputFile: (contents, name, binding) => {
        calls.server.push({ document: JSON.parse(contents), name, binding })
        if (serverUnavailable) return Promise.resolve(null)
        return Promise.resolve({ method: 'server', fileName: name, path: `/isolated/${name}`, fileKey: `test-key-${name}`, revision: 'test-revision' })
      },
    },
    '@/utils/imageShadow': { normalizeImageShadow: value => value },
    '@/services/htmlDocument': { normalizeHtmlSlide: value => value },
    '@/utils/pageNumbers': { synchronizeAutoPageNumbers: value => value },
    '@/utils/historySnapshots': { flushPendingHistorySnapshots: async () => {} },
    '@/utils/nativeFileRevision': nativeRevision,
  }
  const exports = {}
  new Function('require', 'exports', 'window', 'document', compiled)(id => {
    assert.ok(id in dependencies, `Unexpected production dependency ${id}`)
    return dependencies[id]
  }, exports, window, dom)
  await exports.initializeLocalDocument(() => Promise.resolve({
    title: 'Starter', theme: clone(theme), slides: [{ id: 'starter', elements: [] }], viewportSize: 1000, viewportRatio: 0.5625,
  }))
  return { api: exports, store, storage, calls, window,
    chooseOpen: value => nextOpen = value, chooseSave: value => nextSave = value,
    close: () => exports.flushLocalDocument().catch(() => undefined) }
}

test('opening a renamed JSON uses its filename as title and writes back to that exact native handle', async () => {
  const h = await createHarness()
  try {
    const handle = handleFor('DiFF4Yukawa.json', documentFor('tevworkshop_v2', 'DiFF-content'))
    h.chooseOpen(handle)
    await h.api.openLocalDocumentPicker()
    assert.equal(h.api.getLocalDocument().title, 'DiFF4Yukawa')
    assert.equal(h.api.localDocumentState.fileName, 'DiFF4Yukawa.json')
    assert.equal(h.api.localDocumentState.nativeFileBound, true)
    assert.equal(h.storage.record.nativeFileRevision, await nativeRevision.getNativeFileRevision(await handle.getFile()))
    assert.equal(Object.hasOwn(h.api.getLocalDocument(), 'nativeFileRevision'), false)
    const result = await h.api.saveLocalDocumentFile()
    assert.equal(result.fileName, 'DiFF4Yukawa.json')
    assert.equal(handle.writes.length, 1)
    assert.equal(handle.writes[0].title, 'DiFF4Yukawa')
    assert.equal(handle.writes[0].slides[0].id, 'DiFF-content')
    assert.deepEqual(handle.permissions, [{ mode: 'readwrite' }])
    assert.equal(h.calls.server.length, 0)
  }
  finally {
    await h.close()
  }
})

test('native file identity survives a fresh service instance instead of falling back to the old title', async () => {
  const storage = storageFor()
  const first = await createHarness({ storage })
  const handle = handleFor('DiFF4Yukawa.JSON', documentFor('tevworkshop_v2', 'DiFF-content'))
  first.chooseOpen(handle)
  await first.api.openLocalDocumentPicker()
  await first.close()
  const restored = await createHarness({ storage })
  try {
    assert.equal(restored.api.localDocumentState.nativeFileBound, true)
    assert.equal(restored.api.localDocumentState.needsSaveTarget, false)
    assert.equal(restored.api.getLocalDocument().title, 'DiFF4Yukawa')
    await restored.api.saveLocalDocumentFile()
    assert.equal(handle.writes.length, 1)
    assert.equal(handle.writes[0].slides[0].id, 'DiFF-content')
    assert.equal(restored.calls.server.length, 0)
    assert.equal(restored.calls.pickSave.length, 0)
  }
  finally {
    await restored.close()
  }
})

test('file-input open saves under the selected basename while API document loads retain their explicit title', async () => {
  const h = await createHarness({ native: false })
  try {
    await h.api.openLocalDocumentFile(new File([JSON.stringify(documentFor('tevworkshop_v2'))], 'DiFF4Yukawa.json'))
    assert.equal(h.api.getLocalDocument().title, 'DiFF4Yukawa')
    h.store.setTitle('Another presentation title')
    await h.api.saveLocalDocumentFile()
    assert.equal(h.calls.server[0].name, 'DiFF4Yukawa.json', 'Title changes must not change the bound filename')
    await h.api.loadLocalDocument(documentFor('Explicit API title'))
    assert.equal(h.api.getLocalDocument().title, 'Explicit API title')
    assert.equal(h.api.localDocumentState.fileName, '')
  }
  finally {
    await h.close()
  }
})

const legacyRecord = () => ({ id: 'current', document: documentFor('tevworkshop_v2', 'DiFF-content'), slideIndex: 0, updatedAt: 1, fileName: 'DiFF4Yukawa.json' })

test('static download keeps an opened filename even when the document carries a different title', async () => {
  const record = { ...legacyRecord(), nativeFileBound: false }
  const h = await createHarness({ storage: storageFor(record), native: false, serverUnavailable: true })
  try {
    const result = await h.api.saveLocalDocumentFile()
    assert.equal(result.method, 'download')
    assert.equal(h.calls.downloads[0].name, 'DiFF4Yukawa.json')
    assert.equal(JSON.parse(await h.calls.downloads[0].blob.text()).slides[0].id, 'DiFF-content')
  }
  finally {
    await h.close()
  }
})

test('legacy opened-file titles migrate once while later deliberate title edits survive reload', async () => {
  const storage = storageFor(legacyRecord())
  const first = await createHarness({ storage })
  assert.equal(first.api.getLocalDocument().title, 'DiFF4Yukawa')
  first.store.setTitle('Deliberate title edit')
  await first.close()
  const restored = await createHarness({ storage })
  try {
    assert.equal(restored.api.getLocalDocument().title, 'Deliberate title edit')
    assert.equal(restored.api.localDocumentState.fileName, 'DiFF4Yukawa.json')
  }
  finally {
    await restored.close()
  }
})

test('a static browser save picker also suggests the opened basename instead of the old title', async () => {
  const record = { ...legacyRecord(), nativeFileBound: false }
  const h = await createHarness({ storage: storageFor(record), serverUnavailable: true })
  try {
    const selected = handleFor('DiFF4Yukawa.json', documentFor())
    h.chooseSave(selected)
    await h.api.saveLocalDocumentFile()
    assert.equal(h.calls.pickSave[0].suggestedName, 'DiFF4Yukawa.json')
    assert.equal(selected.writes.length, 1)
    assert.equal(selected.writes[0].slides[0].id, 'DiFF-content')
    assert.equal(h.calls.downloads.length, 0)
  }
  finally {
    await h.close()
  }
})

test('legacy records without a native handle require a confirmed target and cancellation writes nothing', async () => {
  const h = await createHarness({ storage: storageFor(legacyRecord()) })
  try {
    assert.equal(h.api.localDocumentState.needsSaveTarget, true)
    h.chooseSave(new DOMException('Cancelled', 'AbortError'))
    await assert.rejects(h.api.saveLocalDocumentFile(), { name: 'AbortError' })
    assert.equal(h.calls.pickSave[0].suggestedName, 'DiFF4Yukawa.json')
    assert.equal(h.calls.server.length, 0)
    assert.equal(h.api.localDocumentState.needsSaveTarget, true)
    assert.equal(h.api.localDocumentState.fileName, 'DiFF4Yukawa.json')
    const confirmed = handleFor('DiFF4Yukawa.json', documentFor())
    h.chooseSave(confirmed)
    await h.api.saveLocalDocumentFile()
    assert.equal(confirmed.writes.length, 1)
    assert.equal(confirmed.writes[0].slides[0].id, 'DiFF-content')
    assert.equal(h.calls.server.length, 0)
    assert.equal(h.api.localDocumentState.needsSaveTarget, false)
  }
  finally {
    await h.close()
  }
})

test('a browser that cannot clone handles still preserves the document and requests a target after reload', async () => {
  const storage = storageFor()
  storage.rejectHandles = true
  const first = await createHarness({ storage })
  const handle = handleFor('DiFF4Yukawa.json', documentFor('tevworkshop_v2', 'DiFF-content'))
  first.chooseOpen(handle)
  await first.api.openLocalDocumentPicker()
  await first.close()
  assert.equal(storage.record.document.title, 'DiFF4Yukawa')
  assert.equal(storage.record.fileHandle, undefined)
  assert.equal(storage.record.nativeFileBound, true)
  assert.equal(first.api.localDocumentState.error, '')
  const restored = await createHarness({ storage })
  try {
    assert.equal(restored.api.localDocumentState.needsSaveTarget, true)
    restored.chooseSave(new DOMException('Cancelled', 'AbortError'))
    await assert.rejects(restored.api.saveLocalDocumentFile(), { name: 'AbortError' })
    assert.equal(restored.calls.server.length, 0)
  }
  finally {
    await restored.close()
  }
})

test('permission denial keeps the existing target and never writes to an unrelated server file', async () => {
  const h = await createHarness()
  try {
    const handle = handleFor('DiFF4Yukawa.json', documentFor(), { permission: 'denied' })
    h.chooseOpen(handle)
    await h.api.openLocalDocumentPicker()
    await assert.rejects(h.api.saveLocalDocumentFile(), /写入权限/)
    assert.equal(handle.writes.length, 0)
    assert.equal(h.calls.server.length, 0)
    assert.equal(h.api.localDocumentState.fileName, 'DiFF4Yukawa.json')
    assert.equal(h.api.localDocumentState.nativeFileBound, true)
  }
  finally {
    await h.close()
  }
})

test('external native JSON changes with unchanged size and time block Save without losing local edits or the binding', async () => {
  const h = await createHarness()
  try {
    const handle = handleFor('DiFF4Yukawa.json', documentFor('Old title', 'DiFF-content'))
    h.chooseOpen(handle)
    await h.api.openLocalDocumentPicker()
    const before = await handle.getFile()
    const baseline = h.storage.record.nativeFileRevision
    h.store.setTitle('Unsaved local edits')
    const external = handle.contents.replace('Old title', 'New title')
    handle.externalWrite(external)
    const changed = await handle.getFile()
    assert.equal(changed.size, before.size)
    assert.equal(changed.lastModified, before.lastModified)
    await assert.rejects(h.api.saveLocalDocumentFile(), /文件已在外部修改或替换/)
    assert.equal(handle.writableCount, 0)
    assert.equal(handle.contents, external)
    assert.equal(h.api.getLocalDocument().title, 'Unsaved local edits')
    assert.equal(h.api.localDocumentState.fileName, 'DiFF4Yukawa.json')
    assert.equal(h.api.localDocumentState.nativeFileBound, true)
    assert.equal(h.storage.record.nativeFileRevision, baseline)
    assert.equal(h.storage.record.fileHandle, handle)
    assert.equal(h.calls.server.length + h.calls.downloads.length, 0)
  }
  finally {
    await h.close()
  }
})

test('a native revision restored from browser storage still detects later external changes', async () => {
  const storage = storageFor()
  const first = await createHarness({ storage })
  const handle = handleFor('DiFF4Yukawa.json', documentFor('Old title', 'DiFF-content'))
  first.chooseOpen(handle)
  await first.api.openLocalDocumentPicker()
  await first.close()
  const baseline = storage.record.nativeFileRevision
  handle.externalWrite(documentFor('External title', 'external-content'))
  const restored = await createHarness({ storage })
  try {
    assert.equal(restored.api.localDocumentState.needsSaveTarget, false)
    await assert.rejects(restored.api.saveLocalDocumentFile(), /文件已在外部修改或替换/)
    assert.equal(handle.writes.length, 0)
    assert.equal(restored.api.getLocalDocument().slides[0].id, 'DiFF-content')
    assert.equal(restored.api.localDocumentState.fileName, 'DiFF4Yukawa.json')
    assert.equal(storage.record.nativeFileRevision, baseline)
    assert.equal(storage.record.fileHandle, handle)
    assert.equal(restored.calls.server.length + restored.calls.downloads.length, 0)
  }
  finally {
    await restored.close()
  }
})

test('successful native saves advance the stored revision for subsequent saves', async () => {
  const h = await createHarness()
  try {
    const handle = handleFor('DiFF4Yukawa.json', documentFor('Old title', 'DiFF-content'))
    h.chooseOpen(handle)
    await h.api.openLocalDocumentPicker()
    let baseline = h.storage.record.nativeFileRevision
    for (const title of ['First local edit', 'Second local edit']) {
      h.store.setTitle(title)
      await h.api.saveLocalDocumentFile()
      const savedRevision = h.storage.record.nativeFileRevision
      assert.notEqual(savedRevision, baseline)
      assert.equal(savedRevision, await nativeRevision.getNativeFileRevision(await handle.getFile()))
      baseline = savedRevision
    }
    assert.equal(handle.writes.length, 2)
    assert.equal(JSON.parse(handle.contents).title, 'Second local edit')
    assert.equal(h.calls.server.length + h.calls.downloads.length, 0)
  }
  finally {
    await h.close()
  }
})

test('a change after opening the native writable stream aborts before close and keeps the external file', async () => {
  const h = await createHarness()
  const external = documentFor('External during write', 'external-content')
  const handle = handleFor('DiFF4Yukawa.json', documentFor('Old title', 'DiFF-content'), { onWritable: () => handle.externalWrite(external) })
  try {
    h.chooseOpen(handle)
    await h.api.openLocalDocumentPicker()
    const baseline = h.storage.record.nativeFileRevision
    await assert.rejects(h.api.saveLocalDocumentFile(), /文件已在外部修改或替换/)
    assert.equal(handle.temporaryWrites.length, 1)
    assert.equal(handle.abortCount, 1)
    assert.equal(handle.writes.length, 0)
    assert.deepEqual(JSON.parse(handle.contents), external)
    assert.equal(h.storage.record.nativeFileRevision, baseline)
    assert.equal(h.storage.record.fileHandle, handle)
    assert.equal(h.calls.server.length + h.calls.downloads.length, 0)
  }
  finally {
    await h.close()
  }
})

test('Save As resolves an external conflict only after a new target succeeds', async () => {
  const h = await createHarness()
  try {
    const original = handleFor('DiFF4Yukawa.json', documentFor('Old title', 'DiFF-content'))
    h.chooseOpen(original)
    await h.api.openLocalDocumentPicker()
    const baseline = h.storage.record.nativeFileRevision
    h.store.setTitle('Unsaved local edits')
    const external = documentFor('External title', 'external-content')
    original.externalWrite(external)
    await assert.rejects(h.api.saveLocalDocumentFile(), /文件已在外部修改或替换/)

    const denied = handleFor('Denied.json', documentFor(), { permission: 'denied' })
    h.chooseSave(denied)
    await assert.rejects(h.api.saveLocalDocumentFile({ saveAs: true }), /写入权限/)
    h.chooseSave(new DOMException('Cancelled', 'AbortError'))
    await assert.rejects(h.api.saveLocalDocumentFile({ saveAs: true }), { name: 'AbortError' })
    assert.equal(denied.writes.length, 0)
    assert.equal(h.api.localDocumentState.fileName, original.name)
    assert.equal(h.storage.record.fileHandle, original)
    assert.equal(h.storage.record.nativeFileRevision, baseline)

    const copy = handleFor('DiFF4Yukawa-copy.json', documentFor('Chosen existing target'))
    h.chooseSave(copy)
    await h.api.saveLocalDocumentFile({ saveAs: true })
    assert.equal(copy.writes.length, 1)
    assert.equal(copy.writes[0].title, 'Unsaved local edits')
    assert.equal(h.api.localDocumentState.fileName, copy.name)
    assert.equal(h.storage.record.fileHandle, copy)
    assert.equal(h.storage.record.nativeFileRevision, await nativeRevision.getNativeFileRevision(await copy.getFile()))
    assert.deepEqual(JSON.parse(original.contents), external)
    await h.api.saveLocalDocumentFile()
    assert.equal(copy.writes.length, 2)
    assert.equal(original.writes.length, 0)
    assert.equal(h.calls.server.length + h.calls.downloads.length, 0)
  }
  finally {
    await h.close()
  }
})

test('an older stored native handle without a revision requires target confirmation and cancellation changes nothing', async () => {
  const original = handleFor('DiFF4Yukawa.json', documentFor('Old title', 'DiFF-content'))
  const record = { ...legacyRecord(), fileHandle: original, nativeFileBound: true }
  const h = await createHarness({ storage: storageFor(record) })
  try {
    assert.equal(h.api.localDocumentState.needsSaveTarget, true)
    h.chooseSave(new DOMException('Cancelled', 'AbortError'))
    await assert.rejects(h.api.saveLocalDocumentFile(), { name: 'AbortError' })
    assert.equal(original.writes.length, 0)
    assert.equal(h.api.localDocumentState.fileName, original.name)
    assert.equal(h.storage.record.fileHandle, original)
    assert.equal(h.storage.record.nativeFileRevision, undefined)
    h.chooseSave(original)
    await h.api.saveLocalDocumentFile()
    assert.equal(original.writes.length, 1)
    assert.equal(h.api.localDocumentState.needsSaveTarget, false)
    assert.equal(h.storage.record.nativeFileRevision, await nativeRevision.getNativeFileRevision(await original.getFile()))
    assert.equal(h.calls.server.length + h.calls.downloads.length, 0)
  }
  finally {
    await h.close()
  }
})

test('a native read failure preserves the old target and revision rather than saving elsewhere', async () => {
  const h = await createHarness()
  try {
    const handle = handleFor('DiFF4Yukawa.json', documentFor('Old title', 'DiFF-content'))
    h.chooseOpen(handle)
    await h.api.openLocalDocumentPicker()
    const baseline = h.storage.record.nativeFileRevision
    handle.failReads(new DOMException('Denied', 'NotAllowedError'))
    await assert.rejects(h.api.saveLocalDocumentFile(), /无法读取原文件/)
    assert.equal(handle.writableCount, 0)
    assert.equal(h.storage.record.fileHandle, handle)
    assert.equal(h.storage.record.nativeFileRevision, baseline)
    assert.equal(h.api.localDocumentState.fileName, handle.name)
    assert.equal(h.calls.server.length + h.calls.downloads.length, 0)
    handle.failReads(undefined)
    await h.api.saveLocalDocumentFile()
    assert.equal(handle.writes.length, 1)
  }
  finally {
    await h.close()
  }
})

test('a Save As target changed after picker selection is rejected without replacing the old binding', async () => {
  const h = await createHarness()
  try {
    const original = handleFor('DiFF4Yukawa.json', documentFor('Old title', 'DiFF-content'))
    h.chooseOpen(original)
    await h.api.openLocalDocumentPicker()
    const baseline = h.storage.record.nativeFileRevision
    const chosen = handleFor('Copy.json', documentFor('Existing copy'))
    const external = documentFor('Changed after selection', 'external-copy')
    chosen.requestPermission = () => {
      chosen.externalWrite(external); return Promise.resolve('granted')
    }
    h.chooseSave(chosen)
    await assert.rejects(h.api.saveLocalDocumentFile({ saveAs: true }), /文件已在外部修改或替换/)
    assert.equal(chosen.writableCount, 0)
    assert.deepEqual(JSON.parse(chosen.contents), external)
    assert.equal(h.api.localDocumentState.fileName, original.name)
    assert.equal(h.storage.record.fileHandle, original)
    assert.equal(h.storage.record.nativeFileRevision, baseline)
    assert.equal(h.calls.server.length + h.calls.downloads.length, 0)
  }
  finally {
    await h.close()
  }
})

test('open A, open B and Save are serialized so B content can never reach A handle', async () => {
  const h = await createHarness()
  const gate = deferred()
  try {
    const a = handleFor('A.json', documentFor('Old A title', 'A-content'))
    const b = handleFor('B.json', documentFor('Old B title', 'B-content'))
    const aFile = new File([JSON.stringify(documentFor('Old A title', 'A-content'))], 'A.json')
    aFile.text = () => gate.promise
    const openA = h.api.openLocalDocumentFile(aFile, a)
    const openB = h.api.openLocalDocumentFile(await b.getFile(), b)
    const save = h.api.saveLocalDocumentFile()
    await tick()
    assert.equal(a.writes.length + b.writes.length, 0)
    gate.resolve(JSON.stringify(documentFor('Old A title', 'A-content')))
    await Promise.all([openA, openB, save])
    assert.equal(a.writes.length, 0)
    assert.equal(b.writes.length, 1)
    assert.equal(b.writes[0].title, 'B')
    assert.equal(b.writes[0].slides[0].id, 'B-content')
    assert.equal(h.api.localDocumentState.fileName, 'B.json')
  }
  finally {
    gate.resolve('{}'); await h.close()
  }
})

test('an ongoing save finishes against its original snapshot before a new document and target are applied', async () => {
  const h = await createHarness()
  const gate = deferred()
  const started = deferred()
  try {
    const a = handleFor('A.json', documentFor('Old A title', 'A-content'), { onWritable: () => {
      started.resolve(); return gate.promise
    } })
    const b = handleFor('B.json', documentFor('Old B title', 'B-content'))
    h.chooseOpen(a)
    await h.api.openLocalDocumentPicker()
    const saveA = h.api.saveLocalDocumentFile()
    await started.promise
    const openB = h.api.openLocalDocumentFile(await b.getFile(), b)
    await tick()
    assert.equal(h.api.getLocalDocument().title, 'A')
    gate.resolve()
    await Promise.all([saveA, openB])
    assert.equal(a.writes[0].slides[0].id, 'A-content')
    await h.api.saveLocalDocumentFile()
    assert.equal(b.writes[0].slides[0].id, 'B-content')
    assert.equal(a.writes.length, 1)
    assert.equal(b.writes.length, 1)
  }
  finally {
    gate.resolve(); await h.close()
  }
})

test('failed opens preserve the previous document, title, native handle and subsequent Save target', async () => {
  const h = await createHarness()
  try {
    const original = handleFor('DiFF4Yukawa.json', documentFor('Old title', 'DiFF-content'))
    h.chooseOpen(original)
    await h.api.openLocalDocumentPicker()
    for (const contents of ['not JSON', JSON.stringify({ title: 'Broken', slides: [] })]) {
      await assert.rejects(h.api.openLocalDocumentFile(new File([contents], 'tevworkshop.json')))
      assert.equal(h.api.getLocalDocument().title, 'DiFF4Yukawa')
      assert.equal(h.api.localDocumentState.fileName, 'DiFF4Yukawa.json')
      assert.equal(h.api.localDocumentState.nativeFileBound, true)
    }
    const contents = JSON.stringify(documentFor('Bad read'))
    const unreadable = new File([contents], 'Bad-read.json')
    // Node 20 implements Blob.text() through arrayBuffer(), while Node 25
    // reads its backing bytes directly. Isolate the revision-read
    // failure from text decoding so both runtimes exercise the intended path.
    unreadable.text = () => Promise.resolve(contents)
    unreadable.arrayBuffer = () => Promise.reject(new Error('Cannot read bytes'))
    await assert.rejects(h.api.openLocalDocumentFile(unreadable, handleFor(unreadable.name, documentFor('Bad read'))), /无法读取原文件/)
    assert.equal(h.api.getLocalDocument().title, 'DiFF4Yukawa')
    assert.equal(h.api.localDocumentState.fileName, original.name)
    await h.api.saveLocalDocumentFile()
    assert.equal(original.writes.length, 1)
    assert.equal(original.writes[0].slides[0].id, 'DiFF-content')
    assert.equal(h.calls.server.length, 0)
  }
  finally {
    await h.close()
  }
})

test('a failed text read preserves the previous document and subsequent native Save target', async () => {
  const h = await createHarness()
  try {
    const original = handleFor('DiFF4Yukawa.json', documentFor('Old title', 'DiFF-content'))
    h.chooseOpen(original)
    await h.api.openLocalDocumentPicker()
    const before = h.api.getLocalDocument()
    const contents = JSON.stringify(documentFor('Bad text read'))
    const unreadable = new File([contents], 'Bad-text-read.json')
    const readError = new Error('Cannot read document text')
    unreadable.text = () => Promise.reject(readError)
    unreadable.arrayBuffer = () => Promise.resolve(new TextEncoder().encode(contents).buffer)
    await assert.rejects(h.api.openLocalDocumentFile(unreadable, handleFor(unreadable.name, documentFor('Bad text read'))), error => error === readError)
    assert.deepEqual(h.api.getLocalDocument(), before)
    assert.equal(h.api.localDocumentState.fileName, original.name)
    assert.equal(h.api.localDocumentState.nativeFileBound, true)
    await h.api.saveLocalDocumentFile()
    assert.equal(original.writes.length, 1)
    assert.equal(original.writes[0].slides[0].id, 'DiFF-content')
    assert.equal(h.calls.server.length, 0)
  }
  finally {
    await h.close()
  }
})
