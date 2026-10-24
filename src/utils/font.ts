import { FONTS } from '@/configs/font'
import { hasSystemFont } from './fontAvailability'

export const isSystemFont = hasSystemFont

// Retained for existing document imports. Font resolution stays on this
// computer: bundled faces, installed system faces, and embedded font files.
export const loadGoogleFonts = (usedFonts: string[]) => {
  const known = new Set(FONTS.map(font => font.value.toLowerCase()))
  for (const name of usedFonts) {
    const family = name.replace(/["'\\;{}<>]/g, '').trim()
    if (!family || (!known.has(family.toLowerCase()) && !isSystemFont(family))) continue
    void document.fonts.load('16px "' + family + '"').catch(() => undefined)
  }
}
