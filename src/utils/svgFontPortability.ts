/** SVG image documents have their own font context: parent-page @font-face
 * rules do not reach <img>, CSS backgrounds, or SVG <image> resources.
 * Until those separate contexts join the export preflight, refuse textual SVG
 * images rather than silently depending on fonts installed on the recipient. */
export const assertPortableSvgImageFonts = (svg: Pick<Document, 'querySelectorAll'>): void => {
  for (const element of Array.from(svg.querySelectorAll('text,tspan,textPath,foreignObject'))) {
    // foreignObject can paint form-control labels or CSS-generated text even
    // when textContent is empty; its complete font use cannot be proved here.
    if (element.localName === 'foreignObject') throw new Error('SVG 图片含尚未打包字体的 HTML 内容，请先转为普通图片，或使用文稿文本框。')
    const copy = element.cloneNode(true) as Element
    copy.querySelectorAll('style,script,title,desc,metadata').forEach(node => node.remove())
    if (copy.textContent?.trim()) throw new Error('SVG 图片含未打包字体的文字，请先将文字转为轮廓，或使用文稿文本框。')
  }
}
