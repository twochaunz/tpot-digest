import { useState, useCallback, useEffect, useRef } from 'react'

export interface UndoAction {
  label: string
  undo: () => void | Promise<void>
}

const MAX_STACK = 10
const TOAST_DURATION = 5000

export function useUndo(clearKey?: string) {
  const [stack, setStack] = useState<UndoAction[]>([])
  const [toast, setToast] = useState<UndoAction | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Clear stack when clearKey changes (e.g. date changes)
  useEffect(() => {
    setStack([])
    setToast(null)
  }, [clearKey])

  const push = useCallback((action: UndoAction) => {
    setStack((prev) => [...prev.slice(-(MAX_STACK - 1)), action])
    setToast(action)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), TOAST_DURATION)
  }, [])

  const undoLast = useCallback(async () => {
    setStack((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      last.undo()
      return prev.slice(0, -1)
    })
    setToast(null)
  }, [])

  const dismissToast = useCallback(() => {
    setToast(null)
    clearTimeout(timerRef.current)
  }, [])

  // Cmd+Z listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        // Don't capture if user is typing in an input
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        undoLast()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [undoLast])

  return { push, undoLast, dismissToast, toast, stackSize: stack.length }
}
