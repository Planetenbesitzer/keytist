/** Compare against several generic fallbacks: FontFaceSet.check alone returns
 * true even for an unknown family, because the browser may silently fall back. */
export const hasSystemFont = (family: string): boolean => {
  if (typeof document === 'undefined' || !family) return false
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return false
  const safeFamily = family.replace(/["'\\;{}<>]/g, '')
  const text = 'mmmmmmmmmwwiiW BESbswy 0123456789'
  return ['monospace', 'serif', 'sans-serif'].some(fallback => {
    context.font = `72px ${fallback}`
    const baseline = context.measureText(text).width
    context.font = `72px "${safeFamily}", ${fallback}`
    return context.measureText(text).width !== baseline
  })
}
