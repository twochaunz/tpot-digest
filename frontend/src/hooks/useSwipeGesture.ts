import { useRef, useCallback } from 'react'

interface SwipeCallbacks {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeUp?: () => void
  onSwipeDown?: () => void
}

interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
}

const MIN_HORIZONTAL = 50
const MIN_VERTICAL = 80
const MAX_ANGLE_DEG = 30

export function useSwipeGesture(callbacks: SwipeCallbacks): SwipeHandlers {
  const startX = useRef(0)
  const startY = useRef(0)
  const startTime = useRef(0)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    startX.current = touch.clientX
    startY.current = touch.clientY
    startTime.current = Date.now()
  }, [])

  const onTouchMove = useCallback((_e: React.TouchEvent) => {
    // Could add visual feedback here in the future
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - startX.current
    const deltaY = touch.clientY - startY.current
    const elapsed = Date.now() - startTime.current

    // Ignore very slow gestures (> 500ms)
    if (elapsed > 500) return

    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    // Determine angle from horizontal
    const angleDeg = Math.atan2(absY, absX) * (180 / Math.PI)

    if (angleDeg < MAX_ANGLE_DEG && absX >= MIN_HORIZONTAL) {
      // Horizontal swipe
      if (deltaX < 0) callbacks.onSwipeLeft?.()
      else callbacks.onSwipeRight?.()
    } else if (angleDeg > (90 - MAX_ANGLE_DEG) && absY >= MIN_VERTICAL) {
      // Vertical swipe
      if (deltaY < 0) callbacks.onSwipeUp?.()
      else callbacks.onSwipeDown?.()
    }
  }, [callbacks])

  return { onTouchStart, onTouchMove, onTouchEnd }
}
