import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { Schema } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { history, undo, redo } from 'prosemirror-history'

// Exercise the production command without a browser or a second test copy.
const source = await readFile(new URL('../src/utils/prosemirror/commands/changeFontSize.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace("from 'prosemirror-history'", `from '${import.meta.resolve('prosemirror-history')}'`)
const { changeFontSize, fontSizeShortcutDirection } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    inline_math: { inline: true, group: 'inline', atom: true, attrs: { latex: {} } },
    bullet_list: { content: 'list_item+', group: 'block', attrs: { fontsize: { default: null } } },
    ordered_list: { content: 'list_item+', group: 'block', attrs: { fontsize: { default: null } } },
    list_item: { content: 'paragraph block*' },
  },
  marks: { fontsize: { attrs: { fontsize: {} } }, strong: {}, em: {} },
})
const font = value => schema.marks.fontsize.create({ fontsize: value })
const text = (value, size, other = []) => schema.text(value, [...(size ? [font(size)] : []), ...other])
const paragraph = children => schema.nodes.paragraph.create(null, children)
const document = children => schema.nodes.doc.create(null, children)
const stateFor = (doc, from = 1, to = from, plugins = []) => EditorState.create({ doc, selection: TextSelection.create(doc, from, to), plugins })
const apply = (state, direction, all = false) => {
  assert.equal(changeFontSize(state, tr => {
    state = state.apply(tr) 
  }, direction, all), true)
  return state
}
const runs = doc => {
  const result = []
  doc.descendants(node => {
    if (node.isText) result.push({ text: node.text, size: node.marks.find(mark => mark.type.name === 'fontsize')?.attrs.fontsize, marks: node.marks.map(mark => mark.type.name) })
  })
  return result
}

let checks = 0
const test = (name, fn) => {
  fn()
  checks++
  stdout.write(`PASS ${name}\n`)
}

test('Command, Control, shifted plus and keypad; canvas zoom stays separate', () => {
  const event = { key: '=', code: 'Equal', metaKey: true, ctrlKey: false, altKey: false }
  assert.equal(fontSizeShortcutDirection(event), 1)
  assert.equal(fontSizeShortcutDirection({ ...event, key: '+' }), 1)
  assert.equal(fontSizeShortcutDirection({ ...event, key: '+', code: 'NumpadAdd' }), 1)
  assert.equal(fontSizeShortcutDirection({ ...event, key: '-', code: 'NumpadSubtract' }), -1)
  assert.equal(fontSizeShortcutDirection({ ...event, key: '-', code: 'Minus' }), -1)
  assert.equal(fontSizeShortcutDirection({ ...event, metaKey: false, ctrlKey: true }), 1)
  assert.equal(fontSizeShortcutDirection({ ...event, metaKey: false }), 0)
  assert.equal(fontSizeShortcutDirection({ ...event, altKey: true }), 0)
  assert.equal(fontSizeShortcutDirection({ ...event, key: '>', code: 'Period' }), 0)
})

test('Whole objects retain mixed sizes, styles and text structure', () => {
  const doc = document([paragraph([text('Small', '12px', [schema.marks.strong.create()]), text('LARGE', '32px', [schema.marks.em.create()])]), paragraph([text('Next', '20px')])])
  const updated = apply(stateFor(doc), 1, true)
  assert.deepEqual(runs(updated.doc).map(run => run.size), ['13px', '33px', '21px'])
  assert.deepEqual(runs(updated.doc).map(run => run.marks), [['fontsize', 'strong'], ['fontsize', 'em'], ['fontsize']])
  assert.equal(updated.doc.textContent, doc.textContent)
  assert.equal(updated.doc.childCount, 2)
  assert.equal(runs(doc)[0].size, '12px')
})

test('Only selected characters change and the text selection is preserved', () => {
  const updated = apply(stateFor(document([paragraph([text('abcdef', '20px')])]), 3, 5), 1)
  assert.deepEqual(runs(updated.doc).map(({ text, size }) => ({ text, size })), [
    { text: 'ab', size: '20px' }, { text: 'cd', size: '21px' }, { text: 'ef', size: '20px' },
  ])
  assert.equal(updated.selection.from, 3)
  assert.equal(updated.selection.to, 5)
})

test('Caret changes subsequent typing without reformatting existing text', () => {
  const doc = document([paragraph([text('abcd', '20px', [schema.marks.strong.create()])])])
  let state = apply(stateFor(doc, 3), 1)
  assert.equal(state.doc.eq(doc), true)
  assert.equal(state.storedMarks.find(mark => mark.type.name === 'fontsize').attrs.fontsize, '21px')
  state = state.apply(state.tr.insertText('x'))
  const inserted = runs(state.doc).find(run => run.text === 'x')
  assert.equal(inserted.size, '21px')
  assert.equal(inserted.marks.includes('strong'), true)
})

test('Selected and whole-object inline formulas scale with text while preserving source and marks', () => {
  const equation = schema.nodes.inline_math.create({ latex: String.raw`\frac{x}{y}` }, null, [font('28px'), schema.marks.strong.create()])
  const doc = document([paragraph([text('a', '20px'), equation, text('b', '32px')])])
  let state = EditorState.create({ doc, selection: NodeSelection.create(doc, 2) })
  state = apply(state, 1)
  assert.equal(state.doc.nodeAt(2).marks.find(mark => mark.type.name === 'fontsize').attrs.fontsize, '29px')
  assert.equal(state.doc.nodeAt(2).attrs.latex, equation.attrs.latex)
  assert.equal(state.doc.nodeAt(2).marks.some(mark => mark.type.name === 'strong'), true)
  assert.deepEqual(runs(state.doc).map(run => run.size), ['20px', '32px'])
  assert.equal(state.selection instanceof NodeSelection, true)
  assert.equal(state.selection.from, 2)

  state = apply(stateFor(doc, 1, 4), -1)
  assert.deepEqual(state.doc.firstChild.content.content.map(node => node.marks.find(mark => mark.type.name === 'fontsize').attrs.fontsize), ['19px', '27px', '31px'])
  state = apply(stateFor(doc), 1, true)
  assert.deepEqual(state.doc.firstChild.content.content.map(node => node.marks.find(mark => mark.type.name === 'fontsize').attrs.fontsize), ['21px', '29px', '33px'])
  const inherited = document([schema.nodes.bullet_list.create({ fontsize: '24px' }, [schema.nodes.list_item.create(null, paragraph([schema.nodes.inline_math.create({ latex: 'x' })]))])])
  state = apply(stateFor(inherited, 3), 1, true)
  assert.equal(state.doc.nodeAt(3).marks.find(mark => mark.type.name === 'fontsize').attrs.fontsize, '25px')
})

test('Empty caret, point units and lower boundary remain usable', () => {
  const empty = apply(stateFor(document([paragraph([])])), 1)
  assert.equal(empty.storedMarks[0].attrs.fontsize, '17px')
  assert.equal(runs(apply(stateFor(document([paragraph([text('x', '20pt')])])), 1, true).doc)[0].size, '21pt')
  assert.equal(runs(apply(stateFor(document([paragraph([text('x', '1px')])])), -1, true).doc)[0].size, '1px')
})

test('List text inherits its size and its marker follows whole-object changes', () => {
  const doc = document([schema.nodes.bullet_list.create({ fontsize: '24px' }, [schema.nodes.list_item.create(null, paragraph([text('Item')]))])])
  const updated = apply(stateFor(doc, 3), 1, true)
  assert.equal(updated.doc.firstChild.attrs.fontsize, '25px')
  assert.equal(runs(updated.doc)[0].size, '25px')
})

test('Font formatting supports ProseMirror undo and redo', () => {
  const doc = document([paragraph([text('abcdef', '20px')])])
  let state = apply(stateFor(doc, 1, 7, [history()]), 1)
  const changed = state.doc
  assert.equal(undo(state, tr => {
    state = state.apply(tr) 
  }), true)
  assert.equal(state.doc.eq(doc), true)
  assert.equal(redo(state, tr => {
    state = state.apply(tr) 
  }), true)
  assert.equal(state.doc.eq(changed), true)
})

stdout.write(`${checks} font-size shortcut regression checks passed (${fileURLToPath(import.meta.url)}).\n`)
