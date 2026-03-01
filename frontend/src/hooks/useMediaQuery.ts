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
