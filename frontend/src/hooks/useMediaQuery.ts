import { useState, useEffect } from 'react'

export function useMinWidth(breakpoint: number): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= breakpoint : false
  )

  useEffect(() => {
    const check = () => setMatches(window.innerWidth >= breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])

  return matches
}

export function useWindowWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  )

  useEffect(() => {
    const check = () => setWidth(window.innerWidth)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return width
}

export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(() =>
    typeof window !== 'undefined'
      ? ('ontouchstart' in window || navigator.maxTouchPoints > 0)
      : false
  )

  useEffect(() => {
    const check = () => setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0)
    check()
  }, [])

  return isTouch
}

export function useIsMobile(): boolean {
  return !useMinWidth(768)
}
