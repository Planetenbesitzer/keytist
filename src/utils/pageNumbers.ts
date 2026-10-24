import { nanoid } from 'nanoid'
import type { AutomaticPageNumberConfig, PPTTextElement, Slide } from '@/types/slides'

export const DEFAULT_AUTOMATIC_PAGE_NUMBER_CONFIG: AutomaticPageNumberConfig = {
  start: 1,
  format: 'number',
  hideOnFirst: true,
}

/** Invalid external settings are rejected before replacing the current document. */
export const normalizeAutomaticPageNumberConfig = (value: unknown): AutomaticPageNumberConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('自动页码设置必须是对象。')
  const config = value as Partial<AutomaticPageNumberConfig>
  if (!Number.isSafeInteger(config.start) || config.start! < 0 || config.start! > 999999) throw new Error('自动页码起始值必须是 0 到 999999 的整数。')
  if (!['number', 'twoDigits', 'fraction'].includes(config.format!)) throw new Error('自动页码格式无效。')
  if (typeof config.hideOnFirst !== 'boolean') throw new Error('自动页码的封面显示设置必须是布尔值。')
  if ('hidden' in value && typeof (value as { hidden: unknown }).hidden !== 'boolean') throw new Error('自动页码的隐藏状态必须是布尔值。')
  return { start: config.start!, format: config.format!, hideOnFirst: config.hideOnFirst }
}

export const getAutomaticPageNumberLabel = (index: number, total: number, config: AutomaticPageNumberConfig) => {
  const number = config.start + index
  if (config.format === 'fraction') return `${number} / ${config.start + total - 1}`
  if (config.format === 'twoDigits') return String(number).padStart(2, '0')
  return String(number)
}

// Native page-number text has no executable markup. Retaining its original tag
// tokens avoids reserializing or flattening custom fonts, colors and alignment.
const tokens = (html: string) => html.match(/<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g) || []
const textToken = (token: string) => !token.startsWith('<')
const decodeText = (text: string) => text.replace(/&(?:#(\d+)|#x([\da-f]+)|(nbsp|amp|lt|gt|quot|apos));/gi, (entity, decimal, hex, name) => {
  if (decimal || hex) {
    const code = parseInt(decimal || hex, decimal ? 10 : 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  }
  return ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()]
})

export const getPageNumberText = (html: string) => tokens(html).filter(textToken).map(decodeText).join('').trim()

const replaceLabel = (html: string, label: string) => {
  const parts = tokens(html)
  let replaced = false
  const result = parts.map(part => {
    if (!textToken(part) || !decodeText(part).trim()) return part
    if (replaced) return ''
    replaced = true
    return part.replace(/\S[\s\S]*?(?=\s*$)/, label)
  }).join('')
  // A blank native text frame still needs a valid paragraph for the editor.
  return replaced ? result : `<p style="text-align:right;">${label}</p>`
}

/** Only marked fields change; old documents and manually removed fields stay intact. */
export const synchronizeAutoPageNumbers = (slides: Slide[]): Slide[] => slides.map((slide, index) => {
  let changed = false
  const elements = slide.elements.map(element => {
    if (element.type !== 'text' || element.autoPageNumber === undefined) return element
    const config = normalizeAutomaticPageNumberConfig(element.autoPageNumber)
    const hidden = config.hideOnFirst && index === 0
    const label = getAutomaticPageNumberLabel(index, slides.length, config)
    const content = getPageNumberText(element.content) === label ? element.content : replaceLabel(element.content, label)
    if (content === element.content && element.autoPageNumber.hidden === hidden) return element
    changed = true
    return { ...element, content, autoPageNumber: { ...config, hidden } }
  })
  return changed ? { ...slide, elements } : slide
})

interface PageNumberLayout {
  width: number
  height: number
  fontName: string
  fontColor: string
  replaceExisting?: boolean
}

const pageNumberCandidate = (element: PPTTextElement, total: number, config: AutomaticPageNumberConfig, layout: PageNumberLayout) => {
  if (element.top < layout.height * 0.8 || element.top + element.height > layout.height + 2 || element.width > layout.width * 0.3 || element.height > layout.height * 0.16 || Math.abs(element.rotate) > 1) return false
  if (/data-inline-math|<(?:svg|math|img|iframe)\b/i.test(element.content)) return false
  const text = getPageNumberText(element.content)
  if (!/^\d{1,6}(?:\s*\/\s*\d{1,6})?$/.test(text)) return false
  const [number, count] = text.split('/').map(part => Number(part.trim()))
  // Opt-in conversion includes stale footers after insertions/reordering. Bound
  // the value to the document's numbering range so years are left untouched.
  return number >= 0 && number <= Math.max(total, config.start + total - 1) && (count === undefined || count === total || count === config.start + total - 1)
}

export const findPageNumberCandidate = (slide: Slide, _index: number, total: number, config: AutomaticPageNumberConfig, layout: PageNumberLayout): PPTTextElement | undefined => {
  if (slide.elements.some(element => element.type === 'text' && element.autoPageNumber !== undefined)) return undefined
  return slide.elements.find((element): element is PPTTextElement => element.type === 'text' && pageNumberCandidate(element, total, config, layout))
}

const numberElement = (id: string, config: AutomaticPageNumberConfig, layout: PageNumberLayout): PPTTextElement => ({
  id, type: 'text', name: '自动页码', textType: 'footer',
  left: layout.width * 0.82, top: layout.height - 43,
  width: layout.width * 0.13, height: 28, rotate: 0,
  defaultFontName: layout.fontName, defaultColor: layout.fontColor,
  content: '<p style="text-align:right;"><span style="font-size:14px;">1</span></p>',
  lineHeight: 1, paragraphSpace: 0, inset: [3, 2, 3, 2], fixedHeight: true,
  autoPageNumber: { ...config },
})

export const applyAutoPageNumbers = (slides: Slide[], value: AutomaticPageNumberConfig, layout: PageNumberLayout): Slide[] => {
  const config = normalizeAutomaticPageNumberConfig(value)
  if (![layout.width, layout.height].every(number => Number.isFinite(number) && number > 0)) throw new Error('自动页码需要有效的页面尺寸。')
  const bodyTemplate = layout.replaceExisting ? slides.slice(1).map((slide, index) => {
    return findPageNumberCandidate(slide, index + 1, slides.length, config, layout) || slide.elements.find((element): element is PPTTextElement => element.type === 'text' && !!element.autoPageNumber)
  }).find((element): element is PPTTextElement => !!element) : undefined
  const result = slides.map((slide, index) => {
    const candidate = layout.replaceExisting ? findPageNumberCandidate(slide, index, slides.length, config, layout) : undefined
    let found = false
    let elements = slide.elements.map(element => {
      if (element.type !== 'text') return element
      if (element.autoPageNumber !== undefined || (!found && candidate?.id === element.id)) {
        found = true
        return { ...element, autoPageNumber: { ...config } }
      }
      return element
    })
    if (!found) {
      const ids = new Set(elements.map(element => element.id))
      let id = nanoid(10)
      while (ids.has(id)) id = nanoid(10)
      const number = bodyTemplate ? { ...JSON.parse(JSON.stringify(bodyTemplate)) as PPTTextElement, id, autoPageNumber: { ...config } } : numberElement(id, config, layout)
      delete number.groupId
      delete number.link
      elements = [...elements, number]
    }
    return { ...slide, elements }
  })
  return synchronizeAutoPageNumbers(result)
}

export const removeAutoPageNumbers = (slides: Slide[]): Slide[] => slides.map(slide => {
  const elements = slide.elements.filter(element => element.type !== 'text' || element.autoPageNumber === undefined)
  return elements.length === slide.elements.length ? slide : { ...slide, elements }
})

/** Call only for newly inserted pages, never a complete reordered/undo document. */
export const inheritAutoPageNumbers = (newSlides: Slide[], existingSlides: Slide[]): Slide[] => {
  const template = existingSlides.flatMap(slide => slide.elements).find((element): element is PPTTextElement => element.type === 'text' && !!element.autoPageNumber)
  if (!template) return newSlides
  return newSlides.map(slide => {
    if (slide.elements.some(element => element.type === 'text' && element.autoPageNumber !== undefined)) return slide
    const ids = new Set(slide.elements.map(element => element.id))
    let id = nanoid(10)
    while (ids.has(id)) id = nanoid(10)
    const element = { ...JSON.parse(JSON.stringify(template)) as PPTTextElement, id }
    // A footer inherits typography and position, not grouping or navigation.
    delete element.groupId
    delete element.link
    return { ...slide, elements: [...slide.elements, element] }
  })
}
