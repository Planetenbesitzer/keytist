import { type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore, useSlidesStore } from '@/store'
import type { PPTImageElement } from '@/types/slides'
import { getImageDataURL, getImageSize } from '@/utils/image'
import useHistorySnapshot from '@/hooks/useHistorySnapshot'
import message from '@/utils/message'

export default () => {
  const mainStore = useMainStore()
  const slidesStore = useSlidesStore()
  const { handleElement, handleElementId } = storeToRefs(mainStore)

  const handleImageElement = handleElement as Ref<PPTImageElement>

  const { addHistorySnapshot } = useHistorySnapshot()

  const replaceImage = (files: FileList) => {
    const imageFile = files[0]
    const imageElement = handleImageElement.value
    const imageElementId = handleElementId.value
    if (!imageFile || !imageElement || imageElement.type !== 'image' || !imageElementId) return

    getImageDataURL(imageFile).then(dataURL => {
      const originWidth = imageElement.width
      const originHeight = imageElement.height
      const originLeft = imageElement.left
      const originTop = imageElement.top
      getImageSize(dataURL).then(({ width, height }) => {
        // Replacing an image fills its existing frame, preserving the layout.
        const imageRatio = width / height
        const frameRatio = originWidth / originHeight
        const visibleX = Math.min(1, frameRatio / imageRatio)
        const visibleY = Math.min(1, imageRatio / frameRatio)
        slidesStore.updateElement({
          id: imageElementId,
          props: {
            src: dataURL, width: originWidth, height: originHeight, left: originLeft, top: originTop,
            clip: { shape: imageElement.clip?.shape || 'rect', range: [[(1 - visibleX) * 50, (1 - visibleY) * 50], [(1 + visibleX) * 50, (1 + visibleY) * 50]] },
          },
        })
        addHistorySnapshot()
      }).catch(() => message.error('无法读取这张图片，请选择有效的图片文件。'))
    }).catch(() => message.error('无法读取这张图片，请选择有效的图片文件。'))
  }

  return {
    replaceImage,
  }
}
