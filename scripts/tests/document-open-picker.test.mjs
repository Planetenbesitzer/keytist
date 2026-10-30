/* eslint-env node, es2020 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const service = await readFile(new URL('../../src/services/localDocument.ts', import.meta.url), 'utf8')
const controls = await readFile(new URL('../../src/components/LocalDocumentControls.vue', import.meta.url), 'utf8')
const revisionApi = {}
new Function('exports', ts.transpileModule(await readFile(new URL('../../src/utils/nativeFileRevision.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(revisionApi)
const declaration = (source, name) => {
  const ast = ts.createSourceFile('production.ts', source, ts.ScriptTarget.Latest, true)
  let found
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `Missing production declaration ${name}`)
  return `const ${found.getText(ast)};`
}
const evaluate = (source, dependencies) => new Function('dependencies', ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(dependencies)
const document = {
  title: 'Opened', width: 1000, height: 562.5,
  theme: { themeColors: ['#123456'], backgroundColor: '#fff', fontColor: '#000', fontName: 'Arial', outline: {}, shadow: {} },
  slides: [{ id: 'opened-slide', elements: [] }],
}
const declarations = ['clone', 'isObject', 'positiveNumber', 'normalizeLocalDocument', 'replaceLocalDocument',
  'loadLocalDocument', 'openLocalDocumentFile', 'supportsLocalFilePicker', 'openLocalDocumentPicker'].map(name => declaration(service, name)).join('\n')

// Only document application/storage are seams. The production picker, file read,
// schema validator and successful-load binding changes execute unchanged.
const fixture = ({ name = '文稿.json', mime = '', contents = JSON.stringify(document), cancel, apply } = {}) => {
  const calls = []
  const originalHandle = { name: 'previous.json' }
  const originalOutputBinding = { fileName: 'previous.json' }
  const state = { fileName: 'previous.json', nativeFileBound: true, filePath: '/previous.json', fileSavedAt: 1 }
  let current = { title: 'Previous' }
  const handle = { name, getFile: () => {
    calls.push('getFile')
    return Promise.resolve(new File([contents], name, { type: mime }))
  } }
  const pickerWindow = { showOpenFilePicker: options => {
    calls.push({ picker: options })
    if (cancel) return Promise.reject(cancel)
    return Promise.resolve([handle])
  } }
  const api = evaluate(`
    const { pickerWindow, localDocumentState, enqueueDocumentOperation, applyDocument,
      scheduleLocalSave, flushLocalDocument, getLocalDocument, synchronizeAutoPageNumbers, getNativeFileRevision } = dependencies;
    let fileHandle = dependencies.originalHandle, outputBinding = dependencies.originalOutputBinding, documentSession = 0, nativeFileRevision;
    ${declarations}
    return { openLocalDocumentPicker, openLocalDocumentFile, supportsLocalFilePicker,
      binding: () => ({ fileHandle, outputBinding, documentSession, nativeFileRevision }) };
  `, {
    pickerWindow, localDocumentState: state, originalHandle, originalOutputBinding,
    enqueueDocumentOperation: operation => operation(),
    applyDocument: async value => {
      calls.push('apply')
      assert.equal(api.binding().fileHandle, originalHandle, 'Do not bind a file before applying its validated document')
      if (apply) await apply()
      current = value
    },
    scheduleLocalSave: () => calls.push('schedule'), flushLocalDocument: () => Promise.resolve(calls.push('flush')),
    getLocalDocument: () => current, synchronizeAutoPageNumbers: slides => slides,
    getNativeFileRevision: revisionApi.getNativeFileRevision,
  })
  return { api, state, calls, handle, originalHandle, originalOutputBinding, pickerWindow, current: () => current }
}

for (const [name, mime] of [['文稿.json', 'application/json'], ['文稿.json', ''], ['文稿.JSON', 'text/plain'], ['文稿.json', 'application/octet-stream']]) {
  test(`open accepts ${name} with ${mime || 'no MIME'} and binds only after validation succeeds`, async () => {
    const item = fixture({ name, mime })
    assert.equal(await item.api.openLocalDocumentPicker(), true)
    assert.deepEqual(item.calls, [{ picker: { multiple: false } }, 'getFile', 'apply', 'schedule', 'flush'])
    assert.equal(item.current().title, name.replace(/\.json$/i, ''))
    assert.equal(item.state.fileName, name)
    assert.equal(item.state.nativeFileBound, true)
    assert.equal(item.api.binding().fileHandle, item.handle)
    assert.equal(item.api.binding().outputBinding, undefined)
    assert.match(item.api.binding().nativeFileRevision, /^[a-f0-9]{64}$/)
  })
}

test('cancel, malformed JSON, invalid document data and failed application preserve the old document and binding', async () => {
  const cancelled = new DOMException('Cancelled', 'AbortError')
  for (const options of [{ cancel: cancelled }, { contents: 'not JSON' }, { contents: '{"slides":[]}' }, { apply: () => Promise.reject(new Error('Application failed')) }]) {
    const item = fixture(options)
    await assert.rejects(item.api.openLocalDocumentPicker())
    assert.equal(item.current().title, 'Previous')
    assert.equal(item.state.fileName, 'previous.json')
    assert.equal(item.state.nativeFileBound, true)
    assert.equal(item.api.binding().fileHandle, item.originalHandle)
    assert.equal(item.api.binding().outputBinding, item.originalOutputBinding)
    assert.equal(item.api.binding().documentSession, 0)
  }
})

test('unsupported native picker leaves the current document and binding untouched', async () => {
  const item = fixture()
  delete item.pickerWindow.showOpenFilePicker
  assert.equal(item.api.supportsLocalFilePicker(), false)
  assert.equal(await item.api.openLocalDocumentPicker(), false)
  assert.deepEqual(item.calls, [])
  assert.equal(item.api.binding().fileHandle, item.originalHandle)
})

test('the fallback chooser has no OS type restriction and the button and shortcut share the same open path', async () => {
  const input = controls.match(/<input\b[^>]*ref="fileInput"[^>]*>/)?.[0]
  assert.ok(input)
  assert.doesNotMatch(input, /\baccept\s*=/)
  assert.match(controls, /<button\b[^>]*@click="open\(\)"/)
  assert.match(controls, /addEventListener\('keynote-local:open', onOpen\)/)
  const source = controls.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
  let supported = true, nativeCalls = 0, fallbackCalls = 0
  const fileInput = { value: { value: 'old.json', click: () => fallbackCalls++ } }
  const api = evaluate(`
    const { supportsLocalFilePicker, fileInput, openLocalDocumentPicker, showError } = dependencies;
    ${declaration(source, 'open')}
    ${declaration(source, 'onOpen')}
    return { open, onOpen };
  `, {
    supportsLocalFilePicker: () => supported, fileInput,
    openLocalDocumentPicker: () => Promise.resolve(nativeCalls++), showError: assert.fail,
  })
  await api.open(); api.onOpen()
  assert.equal(nativeCalls, 2)
  supported = false
  await api.open(); api.onOpen()
  assert.equal(fallbackCalls, 2)
  assert.equal(fileInput.value.value, '')
})
