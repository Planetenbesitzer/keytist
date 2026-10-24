import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import { BUILTIN_OBJECT_STYLES, isStyleKind, sanitizeStyleValues, type ObjectStylePreset, type StyleKind, type StyleValues } from '@/utils/stylePresets'
import { IMAGE_SHADOW_PRESETS } from '@/configs/imageShadow'
import type { PPTImageShadow } from '@/types/slides'

export const STYLE_LIBRARY_STORAGE_KEY = 'slide-studio-style-library-v1'
interface ShadowPreset { id: string; label: string; shadow?: PPTImageShadow; builtin?: boolean }
interface Library { presets: ObjectStylePreset[]; defaults: Partial<Record<StyleKind, string>>; shadows: ShadowPreset[] }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const factory = (): Library => ({ presets: copy(BUILTIN_OBJECT_STYLES), defaults: {}, shadows: IMAGE_SHADOW_PRESETS.map(preset => ({ ...copy(preset), builtin: true })) })
const readLibrary = (): Library => {
  try {
    const raw = localStorage.getItem(STYLE_LIBRARY_STORAGE_KEY)
    if (!raw || raw.length > 192 * 1024) return factory()
    const parsed = JSON.parse(raw)
    if (parsed.version !== 1 || !Array.isArray(parsed.presets) || !Array.isArray(parsed.shadows)) return factory()
    // Restoring deleted builtins can temporarily exceed the per-kind add limit.
    // Keep all valid states that save() accepts instead of truncating on reload.
    const presets = parsed.presets.slice(0, 300).filter((item: ObjectStylePreset) => item && isStyleKind(item.kind) && typeof item.id === 'string' && item.id.length <= 80 && typeof item.name === 'string' && item.values && typeof item.values === 'object')
      .map((item: ObjectStylePreset) => ({ id: item.id, name: item.name.slice(0, 40), kind: item.kind, values: sanitizeStyleValues(item.kind, item.values), builtin: BUILTIN_OBJECT_STYLES.some(builtin => builtin.id === item.id && builtin.kind === item.kind) }))
    const defaults = Object.fromEntries(Object.entries(parsed.defaults || {}).filter(([kind, id]) => presets.some((preset: ObjectStylePreset) => preset.kind === kind && preset.id === id)))
    const shadows = parsed.shadows.slice(0, 30).filter((item: ShadowPreset) => item && typeof item.id === 'string' && typeof item.label === 'string')
      .map((item: ShadowPreset) => ({ id: item.id.slice(0, 80), label: item.label.slice(0, 40), shadow: item.shadow ? sanitizeStyleValues('image', { shadow: item.shadow }).shadow as PPTImageShadow : undefined, builtin: IMAGE_SHADOW_PRESETS.some(builtin => builtin.id === item.id) }))
    return { presets, defaults, shadows: shadows.length ? shadows : factory().shadows }
  }
  catch {
    return factory()
  }
}

export const useStylePresetsStore = defineStore('stylePresets', {
  state: () => ({ library: readLibrary() }),
  actions: {
    save(next: Library) {
      const data = JSON.stringify({ version: 1, ...next })
      if (data.length > 192 * 1024) throw new Error('样式库已满，请先删除不需要的样式。')
      try {
        localStorage.setItem(STYLE_LIBRARY_STORAGE_KEY, data)
      }
      catch {
        throw new Error('无法保存样式库：本地存储不可用或空间不足。原样式已保留。')
      }
      this.library = next
    },
    add(kind: StyleKind, name: string, values: StyleValues) {
      if (this.library.presets.filter(preset => preset.kind === kind).length >= 30) throw new Error('此类对象最多保存 30 个样式。')
      const preset: ObjectStylePreset = { id: nanoid(10), kind, name: name.trim().slice(0, 40) || '自定义样式', values: sanitizeStyleValues(kind, values) }
      this.save({ ...copy(this.library), presets: [...copy(this.library.presets), preset] })
      return preset.id
    },
    update(id: string, patch: { name?: string; values?: StyleValues }) {
      const next = copy(this.library)
      const preset = next.presets.find(item => item.id === id)
      if (!preset) return
      if (patch.name !== undefined) preset.name = patch.name.trim().slice(0, 40) || preset.name
      if (patch.values) preset.values = sanitizeStyleValues(preset.kind, patch.values)
      this.save(next)
    },
    remove(id: string) {
      const next = copy(this.library)
      next.presets = next.presets.filter(item => item.id !== id)
      for (const key of Object.keys(next.defaults) as StyleKind[]) if (next.defaults[key] === id) delete next.defaults[key]
      this.save(next)
    },
    setDefault(kind: StyleKind, id?: string) {
      const next = copy(this.library)
      if (id) next.defaults[kind] = id
      else delete next.defaults[kind]
      this.save(next)
    },
    restore(kind: StyleKind, id?: string) {
      const next = copy(this.library)
      const originals = BUILTIN_OBJECT_STYLES.filter(item => item.kind === kind && (!id || item.id === id))
      next.presets = [...next.presets.filter(item => !originals.some(original => original.id === item.id)), ...copy(originals)]
      this.save(next)
    },
    updateShadow(id: string, label: string, shadow?: PPTImageShadow) {
      const next = copy(this.library)
      const preset = next.shadows.find(item => item.id === id)
      if (!preset) return
      preset.label = label.trim().slice(0, 40) || preset.label
      preset.shadow = shadow ? sanitizeStyleValues('image', { shadow }).shadow as PPTImageShadow : undefined
      this.save(next)
    },
    restoreShadows() {
      this.save({ ...copy(this.library), shadows: factory().shadows })
    },
  },
})
