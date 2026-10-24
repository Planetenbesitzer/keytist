import { createVNode, nextTick, render } from 'vue'
import { toPng } from 'html-to-image'
import type { PPTShapeElement, PPTTextElement } from '@/types/slides'
import { INLINE_MATH_SELECTOR } from '@/utils/inlineMath'
import { getImageShadowLayerGeometry } from '@/utils/pptxImageShadow'
import BaseTextElement from '@/views/components/element/TextElement/BaseTextElement.vue'
import BaseShapeElement from '@/views/components/element/ShapeElement/BaseShapeElement.vue'

export const hasInlineMath = (html: string): boolean => {
  if (!html.includes('data-inline-math')) return false
  return !!new DOMParser().parseFromString(html, 'text/html').querySelector(INLINE_MATH_SELECTOR)
}

/**
 * PowerPoint rich-text runs cannot contain inline SVG. Capture only an affected
 * text layer, keeping its browser line wrapping and formula baselines together.
 * Other text and the underlying shape remain native PowerPoint objects.
 */
export const preparePptxInlineMathText = async (element: PPTTextElement | PPTShapeElement) => {
  const content = element.type === 'text' ? element.content : element.text?.content || ''
  if (!hasInlineMath(content)) return null
  if (!(Number.isFinite(element.width) && Number.isFinite(element.height) && element.width > 0 && element.height > 0)) {
    throw new Error(`文本 ${element.id} 的尺寸无效，无法保留行内公式。`)
  }

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  // A transform keeps the work surface offscreen without baking a negative
  // logical inset into html-to-image's copied computed styles.
  host.style.cssText = `position:fixed;left:0;top:0;transform:translateX(-100000px);width:${element.width}px;height:${element.height}px;pointer-events:none;z-index:-1;`
  document.body.appendChild(host)
  try {
    const atOrigin = { ...element, left: 0, top: 0, rotate: 0 }
    const component = element.type === 'text' ? BaseTextElement : BaseShapeElement
    const elementInfo = element.type === 'shape'
      ? { ...atOrigin, fill: '#00000000', gradient: undefined, pattern: undefined, outline: undefined }
      : atOrigin
    render(createVNode(component, { elementInfo }), host)
    await nextTick()
    await document.fonts.ready
    const root = host.firstElementChild as HTMLElement | null
    if (!root) throw new Error('文本预览未生成。')

    // Include overflowing ascenders, descenders and text shadows. The capture
    // may be larger than the original box; its center is rotated around that
    // box's center when it is positioned back onto the PowerPoint slide.
    const origin = root.getBoundingClientRect()
    let left = 0, top = 0, right = element.width, bottom = element.height
    for (const node of [root, ...Array.from(root.querySelectorAll('*'))]) {
      const rect = node.getBoundingClientRect()
      if (!rect.width || !rect.height) continue
      left = Math.min(left, rect.left - origin.left)
      top = Math.min(top, rect.top - origin.top)
      right = Math.max(right, rect.right - origin.left)
      bottom = Math.max(bottom, rect.bottom - origin.top)
    }
    const shadow = element.shadow
    const bleed = Math.max(2, (element.type === 'text' ? element.outline?.width || 0 : 0) / 2)
    const shadowBlur = Math.max(0, shadow?.blur || 0) * 2
    left = Math.floor(left + Math.min(0, (shadow?.h || 0) - shadowBlur) - bleed)
    top = Math.floor(top + Math.min(0, (shadow?.v || 0) - shadowBlur) - bleed)
    right = Math.ceil(right + Math.max(0, (shadow?.h || 0) + shadowBlur) + bleed)
    bottom = Math.ceil(bottom + Math.max(0, (shadow?.v || 0) + shadowBlur) + bleed)
    const width = right - left, height = bottom - top
    host.style.width = `${width}px`
    host.style.height = `${height}px`
    root.style.left = `${-left}px`
    root.style.top = `${-top}px`

    const dataUrl = await toPng(host, {
      width,
      height,
      pixelRatio: Math.min(3, 4096 / Math.max(width, height)),
      style: { position: 'relative', left: '0', top: '0', transform: 'none', zIndex: 'auto' },
    })
    if (!/^data:image\/png;base64,/.test(dataUrl)) throw new Error('文本预览无法生成。')
    return {
      ...getImageShadowLayerGeometry({ ...element, flipH: false, flipV: false }, { left, top, width, height }),
      dataUrl,
    }
  }
  catch (error) {
    throw new Error(`文本 ${element.id} 的行内公式无法导出：${error instanceof Error ? error.message : '无法生成预览。'}`)
  }
  finally {
    render(null, host)
    host.remove()
  }
}
