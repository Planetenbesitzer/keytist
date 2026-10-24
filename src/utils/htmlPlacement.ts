/** Placement is measured in slide coordinates; the webpage viewport stays fixed. */
export interface HtmlPlacement {
  left: number
  top: number
  scale: number
}

export type HtmlPlacementInput = Partial<HtmlPlacement>

export const HTML_MIN_SCALE = 0.05
export const HTML_MAX_SCALE = 10

export const getHtmlPlacement = (value: HtmlPlacementInput = {}): HtmlPlacement => ({
  left: value.left ?? 0,
  top: value.top ?? 0,
  scale: value.scale ?? 1,
})

export const getHtmlPlacementTransform = (value: HtmlPlacementInput = {}) =>
  `translate(${value.left ?? 0}px, ${value.top ?? 0}px) scale(${value.scale ?? 1})`
