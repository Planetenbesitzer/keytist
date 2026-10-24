import { STUDIO_THEME_COLORS } from './colors'
import type { PPTTextElement, PPTShapeElement, Slide, SlideTheme } from '@/types/slides'
import { renderLatex } from '@/utils/latex'

const font = 'Helvetica Neue'
const ink = '#1d1d1f'
const blue = '#007aff'
const text = (id: string, value: string, left: number, top: number, width: number, size: number, color = ink, weight = 400): PPTTextElement => ({
  id, type: 'text', left, top, width, height: size * 1.3 * value.split('<br>').length, rotate: 0,
  content: value.split('<br>').map(line => `<p><span style="font-size:${size}px;font-weight:${weight};">${line}</span></p>`).join(''),
  defaultFontName: font, defaultColor: color, lineHeight: 1.15, paragraphSpace: 0, inset: [0, 0, 0, 0],
})
const rect = (id: string, left: number, top: number, width: number, height: number, fill: string): PPTShapeElement => ({
  id, type: 'shape', left, top, width, height, rotate: 0, viewBox: [100, 100],
  path: 'M 8 0 H 92 Q 100 0 100 8 V 92 Q 100 100 92 100 H 8 Q 0 100 0 92 V 8 Q 0 0 8 0 Z',
  fill, fixedRatio: false,
})

export const STUDIO_THEME: SlideTheme = {
  themeColors: [...STUDIO_THEME_COLORS],
  fontColor: ink, fontName: font, backgroundColor: '#ffffff',
  shadow: { h: 0, v: 6, blur: 18, color: '#00000018' },
  outline: { width: 1, color: '#d2d2d7', style: 'solid' },
}

export function createStarterDocument() {
  const eq = renderLatex(String.raw`\mathcal{L}_{\mathrm{QCD}}=-\frac{1}{4}F^{a}_{\mu\nu}F^{a\mu\nu}+\sum_f\bar{q}_f\left(i\gamma^\mu D_\mu-m_f\right)q_f`)
  const eqWidth = Math.min(eq.w * 1.08, 820)
  const image = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="#172c50"/><stop offset="1" stop-color="#5069aa"/></linearGradient><radialGradient id="o"><stop stop-color="#f8cba2"/><stop offset="1" stop-color="#ef795b"/></radialGradient></defs><rect width="1200" height="800" fill="url(#b)"/><circle cx="800" cy="320" r="200" fill="url(#o)"/><g stroke="#fff" stroke-opacity=".18" fill="none"><ellipse cx="680" cy="460" rx="500" ry="145" transform="rotate(-25 680 460)"/><ellipse cx="680" cy="460" rx="560" ry="175" transform="rotate(-25 680 460)"/><ellipse cx="680" cy="460" rx="620" ry="205" transform="rotate(-25 680 460)"/></g><g fill="#fff" opacity=".7"><circle cx="160" cy="170" r="3"/><circle cx="380" cy="270" r="2"/><circle cx="980" cy="630" r="3"/><circle cx="600" cy="100" r="2"/><circle cx="1100" cy="160" r="2"/></g></svg>`
  const imageSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`
  const slides: Slide[] = [
    {
      id: 'studio-intro', background: { type: 'solid', color: '#fbfbfd' },
      elements: [
        text('intro-eyebrow', 'SLIDE STUDIO', 72, 62, 450, 13, blue, 600),
        text('intro-title', '让想法，<br>清晰呈现。', 72, 150, 620, 62, ink, 600),
        text('intro-subtitle', '自由排版 · 精致公式 · 从容表达', 76, 326, 560, 21, '#86868b'),
        rect('intro-blue', 718, 140, 155, 225, '#007aff'),
        rect('intro-purple', 817, 280, 111, 154, '#c4c0ff'),
        rect('intro-light', 679, 341, 113, 98, '#e8e8ed'),
        text('intro-footer', '你的第一份演示文稿', 76, 481, 550, 13, '#86868b'),
        text('intro-number', '01', 903, 481, 55, 13, '#86868b'),
      ],
      remark: '欢迎。单击选择对象，双击编辑文字或公式。用顶部工具插入内容，右侧调整样式。',
    },
    {
      id: 'studio-equation', background: { type: 'solid', color: '#ffffff' },
      elements: [
        text('eq-eyebrow', 'THE BEAUTY OF AN EQUATION', 72, 62, 700, 13, blue, 600),
        text('eq-title', '让公式成为论证的一部分。', 72, 126, 870, 39, ink, 600),
        text('eq-description', '从一个拉格朗日量出发。', 76, 197, 800, 19, '#86868b'),
        { id: 'qcd-lagrangian', type: 'latex', left: (1000 - eqWidth) / 2, top: 282, width: eqWidth, height: eq.h * (eqWidth / eq.w), rotate: 0, latex: eq.latex, svg: eq.svg, path: '', viewBox: [eq.w, eq.h], color: ink, strokeWidth: 0, fixedRatio: true },
        text('eq-hint', '双击公式，继续编辑 LaTeX。', 76, 454, 800, 15, '#86868b'),
        text('eq-number', '02', 903, 481, 55, 13, '#86868b'),
      ],
      remark: '公式是独立对象。选中后可改颜色、移动和缩放；双击可回到 LaTeX 源码。',
    },
    {
      id: 'studio-image', background: { type: 'solid', color: '#fbfbfd' },
      elements: [
        text('image-eyebrow', 'A LITTLE ROOM TO EXPLORE', 72, 62, 700, 13, blue, 600),
        text('image-title', '为画面，留一点空间。', 72, 145, 442, 43, ink, 600),
        text('image-copy', '文字、图像与形状，<br>放在你想要的位置。', 76, 270, 420, 23, '#86868b'),
        { id: 'image-art', type: 'image', left: 550, top: 128, width: 370, height: 300, rotate: 0, src: imageSrc, fixedRatio: false, radius: 18, clip: { shape: 'roundRect', range: [[0, 0], [100, 100]] }, outline: { width: 1, color: '#ffffff', style: 'solid' } },
        text('image-footer', '选择图片，在右侧调整裁剪与边框。', 76, 481, 650, 13, '#86868b'),
        text('image-number', '03', 903, 481, 55, 13, '#86868b'),
      ],
    },
  ]
  return Promise.resolve({ title: '我的演示文稿', theme: STUDIO_THEME, slides, viewportSize: 1000, viewportRatio: 0.5625, slideIndex: 0 })
}
