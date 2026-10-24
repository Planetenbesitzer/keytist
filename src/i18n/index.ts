import { readonly, ref } from 'vue'
import { englishMessages } from './messages'

export type UiLanguage = 'zh-CN' | 'en'
const languagePreferenceKey = 'slide-studio:ui-language-v1'
const isLanguage = (value: unknown): value is UiLanguage => value === 'zh-CN' || value === 'en'

/** UI language is an independent preference; document content is never translated. */
export const readUiLanguage = (storage?: Pick<Storage, 'getItem'>, browserLanguage = 'en'): UiLanguage => {
  try {
    const saved = storage?.getItem(languagePreferenceKey)
    if (isLanguage(saved)) return saved
    // Existing installations retain their Chinese interface until explicitly changed.
    if (storage?.getItem('slide-studio:sidebar-layout-v1') || storage?.getItem('slide-studio-style-library-v1') || storage?.getItem('PPTIST_DISCARDED_DB')) return 'zh-CN'
  }
  catch { /* A blocked preference store must not prevent editing. */ }
  return /^zh(?:-|$)/i.test(browserLanguage) ? 'zh-CN' : 'en'
}
const detectInitialLanguage = (): UiLanguage => {
  if (typeof window === 'undefined') return 'en'
  try {
    return readUiLanguage(window.localStorage, window.navigator?.language || 'en')
  }
  catch {
    return /^zh(?:-|$)/i.test(window.navigator?.language || 'en') ? 'zh-CN' : 'en'
  }
}
const initialLanguage = detectInitialLanguage()
const uiLanguage = ref<UiLanguage>(initialLanguage)
export const language = readonly(uiLanguage)
export const setUiLanguage = (value: UiLanguage) => {
  if (!isLanguage(value)) return
  uiLanguage.value = value
  try {
    window.localStorage.setItem(languagePreferenceKey, value) 
  }
  catch { /* Session language still works when browser storage is unavailable. */ }
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = value
}
if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = initialLanguage

const interpolate = (text: string, values: Record<string, unknown>) => text.replace(/\{([\w]+)\}/g, (whole, key) => Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole)
const dynamicMessages = Object.entries(englishMessages).filter(([key]) => /\{[\w]+\}/.test(key) && /[\u3400-\u9fff]/.test(key)).map(([key, translated]) => {
  const names: string[] = []
  const expression = key.split(/(\{[\w]+\})/g).map(part => {
    if (/^\{[\w]+\}$/.test(part)) {
      names.push(part.slice(1, -1)); return '([\\s\\S]*?)' 
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('')
  return { names, translated, expression: new RegExp(`^${expression}$`) }
})

/** Translate application-owned UI strings only. Do not call this on document text. */
export const t = (key: string | number | undefined | null, values: Record<string, unknown> = {}): string => {
  const text = key === undefined || key === null ? '' : String(key)
  if (uiLanguage.value === 'zh-CN') return interpolate(text, values)
  const exact = englishMessages[text]
  if (exact !== undefined) return interpolate(exact, values)
  // Service errors and status messages may already contain filenames or counts.
  // Matching is limited to full, explicitly registered application UI patterns.
  for (const entry of dynamicMessages) {
    const match = entry.expression.exec(text)
    if (match) return interpolate(entry.translated, Object.fromEntries(entry.names.map((name, index) => [name, match[index + 1]])))
  }
  return text
}
/** Imported and installed font family names are user data, including Chinese names. */
export const uiOptionLabel = (option: { label: string; fontFamily?: string; localize?: boolean }) =>
  option.localize === false || (option.fontFamily && option.fontFamily === option.label) ? option.label : t(option.label)
export const useI18n = () => ({ language, setUiLanguage, t })
