import { useState, useEffect } from 'react'

export function useMinWidth(breakpoint: number): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia(`(min-width: ${breakpoint}px)`).matches
      : false
  )

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`)
    setMatches(mql.matches)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
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
  return typeof window !== 'undefined'
    ? ('ontouchstart' in window || navigator.maxTouchPoints > 0)
    : false
}

export function useIsMobile(): boolean {
  return !useMinWidth(768)
}
