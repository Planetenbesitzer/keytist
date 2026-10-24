import type { Slide } from '@/types/slides'

/** Raster PPTX renders a separate snapshot without mounting executable HTML. */
export const prepareStaticPptxSlides = (slides: Slide[]): Slide[] => slides.map(slide => {
  const snapshot = { ...slide }
  delete snapshot.html
  return snapshot
})

export const getPptxHtmlOmissions = (slides: Slide[]) => {
  const embeddedSlides = slides.filter(slide => !!slide.html)
  const webOnlySlides = embeddedSlides.filter(slide => !slide.elements.some(element => (
    element.type !== 'text' || !element.autoPageNumber
  )))
  return { embeddedPageCount: embeddedSlides.length, webOnlyPageCount: webOnlySlides.length }
}
