import { useState, useCallback } from 'react'

const STORAGE_KEY = 'tpot-show-engagement'

function getInitial(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

export function useEngagementToggle() {
  const [showEngagement, setShowEngagement] = useState(getInitial)

  const toggle = useCallback(() => {
    setShowEngagement((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  return { showEngagement, toggle }
}
