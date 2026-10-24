import { ref } from 'vue'
import { FONTS, PREFERRED_FONT_NAMES, preferredFontOption } from '@/configs/font'

export interface EmbeddedFont {
  id: string
  family: string
  name: string
  mime: string
  dataUrl: string
}

export const embeddedFonts = ref<EmbeddedFont[]>([])
const loadedFaces = new Map<string, FontFace>()
const addedOptions = new Set<string>()
const fontExtensions = /\.(woff2?|ttf|otf)$/i

const announceChange = () => window.dispatchEvent(new Event('keynote-local:assets-changed'))

const addOption = (font: EmbeddedFont) => {
  const option = FONTS.find(item => item.value === font.family)
  if (!option) {
    FONTS.splice(PREFERRED_FONT_NAMES.length, 0, { label: font.family, value: font.family, fontFamily: font.family, group: '文稿字体', note: '已嵌入' })
    addedOptions.add(font.family)
  }
  else {
    option.disabled = false
    option.note = '已嵌入'
  }
}

const loadFace = async (font: EmbeddedFont) => {
  const face = await new FontFace(font.family, `url("${font.dataUrl}")`).load()
  const previous = loadedFaces.get(font.id)
  if (previous) document.fonts.delete(previous)
  document.fonts.add(face)
  loadedFaces.set(font.id, face)
  addOption(font)
}

const validFont = (font: EmbeddedFont): boolean => !!font &&
  typeof font.id === 'string' && !!font.id &&
  typeof font.family === 'string' && !!font.family.trim() && font.family.length < 160 &&
  typeof font.name === 'string' && fontExtensions.test(font.name) &&
  typeof font.mime === 'string' &&
  typeof font.dataUrl === 'string' &&
  /^data:(?:font\/[^;,]+|application\/[^;,]+);base64,[A-Za-z0-9+/=\s]+$/.test(font.dataUrl)

export const getEmbeddedFonts = (): EmbeddedFont[] => embeddedFonts.value.map(font => ({ ...font }))

/** Restore only this document's font assets; no network or system font access. */
export const restoreEmbeddedFonts = async (fonts: EmbeddedFont[] = []) => {
  if (!Array.isArray(fonts) || fonts.some(font => !validFont(font)) ||
    new Set(fonts.map(font => font.id)).size !== fonts.length ||
    new Set(fonts.map(font => font.family)).size !== fonts.length) {
    throw new Error('文稿包含无效的嵌入字体。')
  }
  // Load before replacing the current set: a broken font cannot remove the
  // currently visible document's fonts halfway through an import.
  const prepared = await Promise.all(fonts.map(async font => ({
    font,
    face: await new FontFace(font.family, `url("${font.dataUrl}")`).load(),
  })))
  for (const face of loadedFaces.values()) document.fonts.delete(face)
  loadedFaces.clear()
  for (let i = FONTS.length - 1; i >= 0; i--) {
    if (addedOptions.has(FONTS[i].value)) FONTS.splice(i, 1)
    else if (PREFERRED_FONT_NAMES.includes(FONTS[i].value)) Object.assign(FONTS[i], preferredFontOption(FONTS[i].value))
    else if (FONTS[i].note === '已嵌入') delete FONTS[i].note
  }
  addedOptions.clear()
  embeddedFonts.value = fonts.map(font => ({ ...font }))
  for (const { font, face } of prepared) {
    document.fonts.add(face)
    loadedFaces.set(font.id, face)
    addOption(font)
  }
}

export const loadEmbeddedFonts = restoreEmbeddedFonts

export const importFontFile = async (file: File): Promise<EmbeddedFont> => {
  if (!fontExtensions.test(file.name)) throw new Error('请选择 WOFF、WOFF2、TTF 或 OTF 字体文件。')
  const mime = ({
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  }[file.name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(`data:${mime};base64,${String(reader.result).split(',')[1]}`)
    reader.onerror = () => reject(new Error('无法读取字体文件。'))
    reader.readAsDataURL(file)
  })
  const family = file.name.replace(fontExtensions, '').replace(/[_]+/g, ' ').replace(/["'\\;{}<>]/g, '').trim()
  if (!family) throw new Error('字体文件名需要包含一个可用名称。')
  const existing = embeddedFonts.value.find(font => font.family === family)
  const font: EmbeddedFont = { id: existing?.id ?? crypto.randomUUID(), family, name: file.name, mime, dataUrl }
  await loadFace(font)
  embeddedFonts.value = [...embeddedFonts.value.filter(item => item.id !== font.id), font]
  announceChange()
  return font
}

export const removeEmbeddedFont = (id: string) => {
  const font = embeddedFonts.value.find(item => item.id === id)
  if (!font) return
  const face = loadedFaces.get(id)
  if (face) document.fonts.delete(face)
  loadedFaces.delete(id)
  embeddedFonts.value = embeddedFonts.value.filter(item => item.id !== id)
  if (addedOptions.has(font.family)) {
    const index = FONTS.findIndex(item => item.value === font.family)
    if (index >= 0) FONTS.splice(index, 1)
    addedOptions.delete(font.family)
  }
  else {
    const option = FONTS.find(item => item.value === font.family)
    if (option && PREFERRED_FONT_NAMES.includes(font.family)) Object.assign(option, preferredFontOption(font.family))
    else if (option) delete option.note
  }
  announceChange()
}

type LocalFontWindow = Window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> }
export const canReadLocalFonts = () => typeof (window as LocalFontWindow).queryLocalFonts === 'function'

export const readLocalFontNames = async (): Promise<number> => {
  const query = (window as LocalFontWindow).queryLocalFonts
  if (!query) throw new Error('此浏览器无法列出本机字体，请使用 Chrome 或导入字体文件。')
  const fonts = await query.call(window)
  let count = 0
  for (const family of [...new Set(fonts.map(font => font.family))].sort()) {
    if (!family || FONTS.some(font => font.value === family)) continue
    FONTS.push({ label: family, value: family, fontFamily: family, group: '本机字体', note: '本机可用' })
    count++
  }
  return count
}
