import { useState, useCallback } from 'react'

export interface Annotation {
  id: string
  type: 'highlight' | 'box' | 'freehand'
  color: string
  opacity: number
  points?: number[]  // for freehand
  x?: number
  y?: number
  width?: number
  height?: number
}

export function useAnnotationHistory() {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [history, setHistory] = useState<Annotation[][]>([[]])
  const [historyIndex, setHistoryIndex] = useState(0)

  const addAnnotation = useCallback((annotation: Annotation) => {
    const newAnnotations = [...annotations, annotation]
    setAnnotations(newAnnotations)
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(newAnnotations)
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
  }, [annotations, history, historyIndex])

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      setAnnotations(history[newIndex])
    }
  }, [history, historyIndex])

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      setAnnotations(history[newIndex])
    }
  }, [history, historyIndex])

  const clear = useCallback(() => {
    setAnnotations([])
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push([])
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
  }, [history, historyIndex])

  return {
    annotations,
    addAnnotation,
    undo,
    redo,
    clear,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
  }
}
