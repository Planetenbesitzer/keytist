import type { PPTElement } from '@/types/slides'
import { STUDIO_THEME_COLORS } from '@/configs/colors'

export type StyleKind = Exclude<PPTElement['type'], 'video'>
export type StyleValues = Record<string, unknown>
export interface ObjectStylePreset {
  id: string
  name: string
  kind: StyleKind
  values: StyleValues
  builtin?: boolean
}

// This is intentionally an appearance whitelist. Document content, image data,
// geometry, IDs, links, group membership, and crop coordinates never enter it.
const fields: Record<StyleKind, string[]> = {
  text: ['defaultFontName', 'defaultColor', 'outline', 'fill', 'lineHeight', 'wordSpace', 'opacity', 'shadow', 'paragraphSpace', 'inset', 'vAlign'],
  image: ['outline', 'filters', 'shadow', 'radius', 'colorMask'],
  shape: ['fill', 'gradient', 'outline', 'opacity', 'shadow'],
  line: ['color', 'style', 'width', 'points', 'shadow'],
  latex: ['color', 'strokeWidth'],
  chart: ['fill', 'outline', 'themeColors', 'textColor', 'lineColor'],
  table: ['outline', 'theme'],
  audio: ['color'],
}
const nestedFields: Record<string, string[]> = {
  outline: ['style', 'width', 'color'], shadow: ['type', 'h', 'v', 'blur', 'color', 'curve', 'perspective'],
  filters: ['blur', 'brightness', 'contrast', 'grayscale', 'saturate', 'hue-rotate', 'sepia', 'invert', 'opacity'],
  gradient: ['type', 'colors', 'rotate'], theme: ['color', 'rowHeader', 'rowFooter', 'colHeader', 'colFooter'],
}
const typographyFields = ['fontFamily', 'fontSize', 'color', 'fontWeight', 'fontStyle', 'textDecoration', 'textAlign'] as const
type Typography = Partial<Record<typeof typographyFields[number], string>>

export const isStyleKind = (type: string): type is StyleKind => Object.prototype.hasOwnProperty.call(fields, type)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const safeString = (value: unknown): value is string => typeof value === 'string' && value.length <= 300 && !/(?:url\s*\(|data:|javascript:|<|>)/i.test(value)
const safeScalar = (value: unknown) => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || safeString(value)

const sanitizeProperty = (key: string, value: unknown): unknown => {
  if (key === 'typography') {
    if (!value || typeof value !== 'object') return undefined
    return Object.fromEntries(typographyFields.filter(field => safeString((value as Typography)[field])).map(field => [field, (value as Typography)[field]]))
  }
  if (key === 'cellStyle') {
    if (!value || typeof value !== 'object') return undefined
    const allowed = ['bold', 'em', 'underline', 'strikethrough', 'color', 'backcolor', 'fontsize', 'fontname', 'align', 'vAlign']
    return Object.fromEntries(allowed.filter(field => safeScalar((value as StyleValues)[field])).map(field => [field, (value as StyleValues)[field]]))
  }
  if (key === 'shapeText') {
    if (!value || typeof value !== 'object') return undefined
    const values = value as StyleValues
    return Object.fromEntries(['defaultFontName', 'defaultColor', 'align', 'lineHeight', 'wordSpace', 'paragraphSpace', 'inset', 'typography']
      .filter(field => values[field] !== undefined).map(field => [field, sanitizeProperty(field, values[field])]).filter(([, item]) => item !== undefined))
  }
  if (Array.isArray(value)) {
    if (key === 'colors') return value.slice(0, 20).filter(item => item && typeof item === 'object' && Number.isFinite(item.pos) && safeString(item.color)).map(item => ({ pos: item.pos, color: item.color }))
    if (!['inset', 'themeColors', 'points'].includes(key)) return undefined
    return value.slice(0, key === 'themeColors' ? 20 : 4).filter(safeScalar)
  }
  if (value && typeof value === 'object') {
    const allowed = nestedFields[key]
    if (!allowed) return undefined
    return Object.fromEntries(allowed.filter(field => (value as StyleValues)[field] !== undefined).map(field => [field, sanitizeProperty(field, (value as StyleValues)[field])]).filter(([, item]) => item !== undefined))
  }
  return safeScalar(value) ? value : undefined
}

export const sanitizeStyleValues = (kind: StyleKind, values: StyleValues): StyleValues => {
  const allowed = [...fields[kind], ...(kind === 'text' ? ['typography'] : []), ...(kind === 'shape' ? ['shapeText'] : []), ...(kind === 'table' ? ['cellStyle'] : [])]
  return Object.fromEntries(allowed.filter(key => values[key] !== undefined).map(key => [key, sanitizeProperty(key, values[key])]).filter(([, value]) => value !== undefined))
}

const readTypography = (content: string, fontFamily: string, color: string): Typography => {
  const body = new DOMParser().parseFromString(content, 'text/html').body
  const firstText = Array.from(body.querySelectorAll('*')).find(el => el.textContent?.trim() && el.children.length === 0) || body.firstElementChild
  const result: Typography = { fontFamily, color, fontSize: '16px', fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none', textAlign: 'left' }
  const decorations = new Set<string>()
  const ancestors: HTMLElement[] = []
  for (let element = firstText as HTMLElement | null; element && element !== body; element = element.parentElement) ancestors.unshift(element)
  for (const element of ancestors) {
    if (['B', 'STRONG'].includes(element.tagName)) result.fontWeight = 'bold'
    if (['I', 'EM'].includes(element.tagName)) result.fontStyle = 'italic'
    const decoration = element.style.textDecorationLine || element.style.textDecoration
    if (!decoration && element.tagName === 'U') decorations.add('underline')
    if (!decoration && ['S', 'STRIKE'].includes(element.tagName)) decorations.add('line-through')
    for (const value of decoration.split(/\s+/)) if (['underline', 'line-through'].includes(value)) decorations.add(value)
    for (const key of typographyFields) if (key !== 'textDecoration' && element.style[key]) result[key] = element.style[key]
    if (element.tagName === 'FONT') {
      if (element.getAttribute('color')) result.color = element.getAttribute('color')!
      if (element.getAttribute('face')) result.fontFamily = element.getAttribute('face')!
    }
  }
  result.textDecoration = [...decorations].join(' ') || 'none'
  return result
}

const applyTypography = (content: string, typography: Typography): string => {
  const body = new DOMParser().parseFromString(content || '<p></p>', 'text/html').body
  if (!body.firstElementChild) {
    const paragraph = body.ownerDocument.createElement('p')
    paragraph.append(...body.childNodes)
    body.append(paragraph)
  }
  // Semantic marks must be converted too: <strong style="font-weight:normal">
  // would otherwise become bold again when ProseMirror parses the document.
  for (const element of Array.from(body.querySelectorAll('b,strong,i,em,u,s,strike'))) {
    const span = body.ownerDocument.createElement('span')
    for (const attribute of Array.from(element.attributes)) span.setAttribute(attribute.name, attribute.value)
    span.append(...element.childNodes)
    element.replaceWith(span)
  }
  // Apply the appearance to existing nodes without storing or replacing words.
  for (const element of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
    element.style.removeProperty('text-decoration-line')
    for (const key of typographyFields) if (typography[key]) element.style[key] = typography[key]!
  }
  return body.innerHTML
}

export const captureElementStyle = (element: PPTElement): StyleValues => {
  if (!isStyleKind(element.type)) return {}
  const values = sanitizeStyleValues(element.type, element as unknown as StyleValues)
  if (element.type === 'text') values.typography = readTypography(element.content, element.defaultFontName, element.defaultColor)
  if (element.type === 'shape' && element.text) {
    values.shapeText = {
      ...sanitizeProperty('shapeText', element.text) as StyleValues,
      typography: readTypography(element.text.content, element.text.defaultFontName, element.text.defaultColor),
    }
  }
  if (element.type === 'table') values.cellStyle = sanitizeProperty('cellStyle', element.data.flat().find(cell => cell.style)?.style || {})
  return clone(values)
}

export const applyElementStyle = (element: PPTElement, preset: Pick<ObjectStylePreset, 'kind' | 'values'>): PPTElement => {
  if (element.type !== preset.kind) return clone(element)
  const values = sanitizeStyleValues(preset.kind, preset.values)
  const result = clone(element) as PPTElement & StyleValues
  // Explicitly clear optional appearance absent from this preset. Structural
  // fields such as a line's stroke width are required and always retained.
  const required: Record<StyleKind, string[]> = { text: ['defaultFontName', 'defaultColor'], image: [], shape: ['fill'], line: ['color', 'style', 'width', 'points'], latex: ['color', 'strokeWidth'], chart: ['themeColors'], table: ['outline'], audio: ['color'] }
  for (const key of fields[preset.kind]) if (values[key] === undefined && !required[preset.kind].includes(key)) delete result[key]
  for (const key of fields[preset.kind]) if (values[key] !== undefined) result[key] = clone(values[key])
  if (result.type === 'text' && values.typography) result.content = applyTypography(result.content, values.typography as Typography)
  if (result.type === 'shape' && values.shapeText) {
    const textStyle = values.shapeText as StyleValues
    const { typography, ...props } = textStyle
    const content = result.text?.content || ''
    result.text = {
      defaultFontName: 'Helvetica Neue', defaultColor: '#1d1d1f', align: 'middle',
      ...props, content: typography ? applyTypography(content, typography as Typography) : content,
    } as typeof result.text
  }
  if (result.type === 'table' && values.cellStyle) result.data = result.data.map(row => row.map(cell => ({ ...cell, style: clone(values.cellStyle) }))) as typeof result.data
  return result
}

const textPreset = (id: string, name: string, fontSize: string, extra: Typography = {}): ObjectStylePreset => ({
  id: `text-${id}`, name, kind: 'text', builtin: true,
  values: { defaultFontName: 'Helvetica Neue', defaultColor: '#1d1d1f', typography: { fontFamily: 'Helvetica Neue', color: '#1d1d1f', fontSize, fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none', textAlign: 'left', ...extra }, lineHeight: 1.2, paragraphSpace: 5 },
})
export const BUILTIN_OBJECT_STYLES: ObjectStylePreset[] = [
  textPreset('title', '大标题', '66px', { fontWeight: 'bold', textAlign: 'center' }),
  textPreset('subtitle', '小标题', '40px', { fontWeight: 'bold', textAlign: 'center' }),
  textPreset('body', '正文', '24px'), textPreset('small', '小正文', '18px'),
  textPreset('note', '注释', '16px', { fontStyle: 'italic' }), textPreset('caption', '图注', '16px', { color: '#636366' }),
  ...(['shape', 'image', 'line', 'latex', 'chart', 'table', 'audio'] as StyleKind[]).flatMap(kind => {
    const values: Record<string, StyleValues[]> = {
      shape: [{ fill: '#007AFF' }, { fill: '#F2F2F7', outline: { color: '#8E8E93', width: 1, style: 'solid' } }, { fill: '#FF9500' }],
      image: [{}, { shadow: { type: 'drop', h: 0, v: 5, blur: 12, color: 'rgba(0,0,0,.28)' } }, { radius: 12, shadow: { type: 'curved', h: 0, v: 3, blur: 7, color: 'rgba(0,0,0,.5)', curve: .65 } }],
      line: [{ color: '#007AFF', width: 2, style: 'solid', points: ['', ''] }, { color: '#8E8E93', width: 2, style: 'dashed', points: ['', ''] }, { color: '#FF9500', width: 3, style: 'solid', points: ['', 'arrow'] }],
      latex: [{ color: '#1D1D1F', strokeWidth: 2 }, { color: '#007AFF', strokeWidth: 2 }, { color: '#FF9500', strokeWidth: 2 }],
      chart: [{ themeColors: [...STUDIO_THEME_COLORS], textColor: '#1D1D1F', lineColor: '#D1D1D6' }],
      table: [{ outline: { color: '#D1D1D6', width: 1, style: 'solid' }, theme: { color: '#007AFF', rowHeader: true, rowFooter: false, colHeader: false, colFooter: false } }],
      audio: [{ color: '#007AFF' }, { color: '#1D1D1F' }, { color: '#FF9500' }],
    }
    return values[kind].map((value, index) => ({ id: `${kind}-${index}`, kind, builtin: true, name: ['简洁', '柔和', '强调'][index], values: value }))
  }),
]
