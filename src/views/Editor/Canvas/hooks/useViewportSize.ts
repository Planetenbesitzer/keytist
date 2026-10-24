import { ref, computed, onMounted, onUnmounted, watch, type ShallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore, useSlidesStore } from '@/store'

export default (canvasRef: ShallowRef<HTMLElement | null>) => {
  const viewportLeft = ref(0)
  const viewportTop = ref(0)
  const canvasSize = ref({ width: 0, height: 0 })
  const panBounds = ref({ minLeft: 0, maxLeft: 0, minTop: 0, maxTop: 0 })

  const mainStore = useMainStore()
  const { canvasPercentage, canvasDragged, canvasScale } = storeToRefs(mainStore)
  const { viewportRatio, viewportSize } = storeToRefs(useSlidesStore())

  // Keep the existing screen-relative coordinates: rulers, selection and floating
  // tools all use these offsets. The scrollbar maps its distance to the offsets.
  const updatePanBounds = (reset = false) => {
    const { width, height } = canvasSize.value
    if (!width || !height) return
    const scaledWidth = viewportSize.value * canvasScale.value
    const scaledHeight = scaledWidth * viewportRatio.value
    const padding = 32
    const centerLeft = (width - scaledWidth) / 2
    const centerTop = (height - scaledHeight) / 2
    const minLeft = scaledWidth > width ? width - scaledWidth - padding : centerLeft
    const maxLeft = scaledWidth > width ? padding : centerLeft
    const minTop = scaledHeight > height ? height - scaledHeight - padding : centerTop
    const maxTop = scaledHeight > height ? padding : centerTop
    // Space-drag can still move beyond the usual margins. Retain that expanded
    // range until the next zoom/fit so dragging a scrollbar stays predictable.
    panBounds.value = {
      minLeft: Math.min(minLeft, viewportLeft.value, reset ? minLeft : panBounds.value.minLeft),
      maxLeft: Math.max(maxLeft, viewportLeft.value, reset ? maxLeft : panBounds.value.maxLeft),
      minTop: Math.min(minTop, viewportTop.value, reset ? minTop : panBounds.value.minTop),
      maxTop: Math.max(maxTop, viewportTop.value, reset ? maxTop : panBounds.value.maxTop),
    }
  }

  const scrollbars = computed(() => ({
    horizontal: { max: panBounds.value.maxLeft - panBounds.value.minLeft, position: panBounds.value.maxLeft - viewportLeft.value, viewport: canvasSize.value.width },
    vertical: { max: panBounds.value.maxTop - panBounds.value.minTop, position: panBounds.value.maxTop - viewportTop.value, viewport: canvasSize.value.height },
  }))
  const hasScrollbars = computed(() => scrollbars.value.horizontal.max > .5 || scrollbars.value.vertical.max > .5)

  const scrollViewport = ({ x, y }: { x?: number; y?: number }) => {
    if (x !== undefined) viewportLeft.value = panBounds.value.maxLeft - Math.max(0, Math.min(scrollbars.value.horizontal.max, x))
    if (y !== undefined) viewportTop.value = panBounds.value.maxTop - Math.max(0, Math.min(scrollbars.value.vertical.max, y))
    mainStore.setCanvasDragged(true)
  }
  const panViewport = (x: number, y: number) => scrollViewport({ x: scrollbars.value.horizontal.position + x, y: scrollbars.value.vertical.position + y })

  // 初始化画布可视区域的位置
  const initViewportPosition = () => {
    if (!canvasRef.value) return
    const canvasWidth = canvasRef.value.clientWidth
    const canvasHeight = canvasRef.value.clientHeight
    if (!canvasWidth || !canvasHeight) return
    canvasSize.value = { width: canvasWidth, height: canvasHeight }

    if (canvasHeight / canvasWidth > viewportRatio.value) {
      const viewportActualWidth = canvasWidth * (canvasPercentage.value / 100)
      mainStore.setCanvasScale(viewportActualWidth / viewportSize.value)
      viewportLeft.value = (canvasWidth - viewportActualWidth) / 2
      viewportTop.value = (canvasHeight - viewportActualWidth * viewportRatio.value) / 2
    }
    else {
      const viewportActualHeight = canvasHeight * (canvasPercentage.value / 100)
      mainStore.setCanvasScale(viewportActualHeight / (viewportSize.value * viewportRatio.value))
      viewportLeft.value = (canvasWidth - viewportActualHeight / viewportRatio.value) / 2
      viewportTop.value = (canvasHeight - viewportActualHeight) / 2
    }
    updatePanBounds(true)
  }

  // 更新画布可视区域的位置
  const setViewportPosition = (newValue: number, oldValue: number) => {
    if (!canvasRef.value) return
    const canvasWidth = canvasRef.value.clientWidth
    const canvasHeight = canvasRef.value.clientHeight
    if (!canvasWidth || !canvasHeight) return
    canvasSize.value = { width: canvasWidth, height: canvasHeight }

    if (canvasHeight / canvasWidth > viewportRatio.value) {      
      const newViewportActualWidth = canvasWidth * (newValue / 100)
      const oldViewportActualWidth = canvasWidth * (oldValue / 100)
      const newViewportActualHeight = newViewportActualWidth * viewportRatio.value
      const oldViewportActualHeight = oldViewportActualWidth * viewportRatio.value

      mainStore.setCanvasScale(newViewportActualWidth / viewportSize.value)

      viewportLeft.value = viewportLeft.value - (newViewportActualWidth - oldViewportActualWidth) / 2
      viewportTop.value = viewportTop.value - (newViewportActualHeight - oldViewportActualHeight) / 2
    }
    else {
      const newViewportActualHeight = canvasHeight * (newValue / 100)
      const oldViewportActualHeight = canvasHeight * (oldValue / 100)
      const newViewportActualWidth = newViewportActualHeight / viewportRatio.value
      const oldViewportActualWidth = oldViewportActualHeight / viewportRatio.value

      mainStore.setCanvasScale(newViewportActualHeight / (viewportSize.value * viewportRatio.value))

      viewportLeft.value = viewportLeft.value - (newViewportActualWidth - oldViewportActualWidth) / 2
      viewportTop.value = viewportTop.value - (newViewportActualHeight - oldViewportActualHeight) / 2
    }
    updatePanBounds(true)
  }

  // 可视区域缩放或比例变化时，重置/更新可视区域的位置
  watch(canvasPercentage, setViewportPosition)
  watch(viewportRatio, initViewportPosition)
  watch(viewportSize, initViewportPosition)

  // 画布拖拽状态改变（复原）时，重置可视区域的位置
  watch(canvasDragged, () => {
    if (!canvasDragged.value) initViewportPosition()
  })

  // 画布可视区域位置和大小的样式
  const viewportStyles = computed(() => ({
    width: viewportSize.value,
    height: viewportSize.value * viewportRatio.value,
    left: viewportLeft.value,
    top: viewportTop.value,
  }))

  // 监听画布尺寸发生变化时，重置可视区域的位置
  const resizeObserver = new ResizeObserver(initViewportPosition)

  onMounted(() => {
    if (canvasRef.value) resizeObserver.observe(canvasRef.value)
  })
  onUnmounted(() => {
    resizeObserver.disconnect()
  })

  // 拖拽画布
  const dragViewport = (e: MouseEvent) => {
    let isMouseDown = true

    const startPageX = e.pageX
    const startPageY = e.pageY

    const originLeft = viewportLeft.value
    const originTop = viewportTop.value

    document.onmousemove = e => {
      if (!isMouseDown) return

      const currentPageX = e.pageX
      const currentPageY = e.pageY

      viewportLeft.value = originLeft + (currentPageX - startPageX)
      viewportTop.value = originTop + (currentPageY - startPageY)
      updatePanBounds()
    }

    document.onmouseup = () => {
      isMouseDown = false
      document.onmousemove = null
      document.onmouseup = null

      mainStore.setCanvasDragged(true)
    }
  }

  return {
    viewportStyles,
    dragViewport,
    scrollbars,
    hasScrollbars,
    scrollViewport,
    panViewport,
  }
}
