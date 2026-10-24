import { EditorState } from 'prosemirror-state'
import { type DirectEditorProps, EditorView } from 'prosemirror-view'
import { Schema, DOMParser, DOMSerializer, type Mark } from 'prosemirror-model'
import { buildPlugins, type PluginOptions } from './plugins/index'
import { schemaNodes, schemaMarks } from './schema/index'

const schema = new Schema({
  nodes: schemaNodes,
  marks: schemaMarks,
})

export const createDocument = (content: string) => {
  const htmlString = `<div>${content}</div>`
  const parser = new window.DOMParser()
  const element = parser.parseFromString(htmlString, 'text/html').body.firstElementChild
  return DOMParser.fromSchema(schema).parse(element as Element)
}

/** Serialize the document model, excluding transient editor decorations. */
export const serializeDocument = (view: EditorView) => {
  const container = view.dom.ownerDocument.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeFragment(view.state.doc.content, { document: view.dom.ownerDocument }))
  return container.innerHTML
}

// Empty inline nodes cannot retain marks in a ProseMirror document. Recover
// explicit empty-paragraph styling as the insertion marks instead, so a styled
// new text box uses the same appearance for the first real keystroke.
export const getEmptyTextMarks = (content: string): Mark[] | undefined => {
  const body = new window.DOMParser().parseFromString(content, 'text/html').body
  if (body.textContent?.trim()) return undefined
  const paragraph = body.querySelector<HTMLElement>('p[style],blockquote[style]')
  if (!paragraph) return undefined
  const style = paragraph.style
  const result: Mark[] = []
  if (style.fontFamily) result.push(schema.marks.fontname.create({ fontname: style.fontFamily.replace(/["']/g, '') }))
  if (style.fontSize) result.push(schema.marks.fontsize.create({ fontsize: style.fontSize }))
  if (style.color) result.push(schema.marks.forecolor.create({ color: style.color }))
  if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) result.push(schema.marks.strong.create())
  if (style.fontStyle === 'italic') result.push(schema.marks.em.create())
  const decoration = style.textDecorationLine || style.textDecoration
  if (decoration.includes('underline')) result.push(schema.marks.underline.create())
  if (decoration.includes('line-through')) result.push(schema.marks.strikethrough.create())
  return result
}

export const initProsemirrorEditor = (
  dom: Element,
  content: string,
  props: Omit<DirectEditorProps, 'state'>,
  pluginOptions?: PluginOptions,
) => {
  return new EditorView(dom, {
    state: EditorState.create({
      doc: createDocument(content),
      storedMarks: getEmptyTextMarks(content),
      plugins: buildPlugins(schema, pluginOptions),
    }),
    ...props,
  })
}
