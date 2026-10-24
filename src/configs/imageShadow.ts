import type { PPTImageShadow } from '@/types/slides'

// Keynote separates projected, grounded and curled-paper shadow geometries.
// Values use the editor's slide pixels, rather than Keynote's point units.
export const IMAGE_SHADOW_PRESETS: { id: string; label: string; shadow?: PPTImageShadow }[] = [
  { id: 'none', label: '无' },
  { id: 'drop', label: '投影', shadow: { type: 'drop', h: 0, v: 3, blur: 7, color: 'rgba(0,0,0,0.5)' } },
  { id: 'contact', label: '接触', shadow: { type: 'contact', h: 0, v: 0, blur: 7, color: 'rgba(0,0,0,0.5)', perspective: 0.35 } },
  { id: 'curved', label: '曲面', shadow: { type: 'curved', h: 0, v: 3, blur: 7, color: 'rgba(0,0,0,0.5)', curve: 0.65 } },
]

export const createDefaultImageShadow = (): PPTImageShadow => ({ ...IMAGE_SHADOW_PRESETS[3].shadow! })
