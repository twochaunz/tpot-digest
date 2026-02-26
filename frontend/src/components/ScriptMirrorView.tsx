import { useState, useCallback, useRef, useEffect, useMemo, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { TopicBundle } from '../api/dayBundle'
import {
  FADE_MS,
  type DrawTool,
  type TimedPoint,
  type StyledStroke,
  DrawCanvas,
  InlineImageOverlay,
  TopicScriptSection,
  TopicScriptSectionMirror,
} from './DayScriptView'

interface ScriptMirrorViewProps {
  topics: TopicBundle[]
  drawToolRef: RefObject<DrawTool>
  drawColorRef: RefObject<string>
  drawOpacityRef: RefObject<number>
}

export function ScriptMirrorView({ topics, drawToolRef, drawColorRef, drawOpacityRef }: ScriptMirrorViewProps) {
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [drawStrokes, setDrawStrokes] = useState<StyledStroke[]>([])
  const [photoStrokes, setPhotoStrokes] = useState<StyledStroke[]>([])
  const currentStrokeRef = useRef<TimedPoint[]>([])

  const [leftSize, setLeftSize] = useState({ w: 0, h: 0 })
  const [rightSize, setRightSize] = useState({ w: 0, h: 0 })
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const leftColumnRef = useRef<HTMLDivElement>(null)
  const rightColumnRef = useRef<HTMLDivElement>(null)

  // Ref-based cursor (no re-renders on mousemove)
  const cursorRef = useRef<HTMLDivElement>(null)

  const handleScriptStatus = useCallback((_topicId: number, _hasScript: boolean) => {}, [])
  const allTweets = useMemo(() => topics.flatMap(t => t.tweets), [topics])
  const topicIds = useMemo(() => topics.map(t => t.id), [topics])

  /* ---- Element-aligned scroll sync with source tracking ---- */
  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right || topicIds.length === 0) return

    // Source tracking prevents feedback loops: when left syncs right,
    // the right's scroll event is ignored because scrollSource is 'left'.
    // Timer resets after 80ms of inactivity so both can scroll again.
    let scrollSource: 'left' | 'right' | null = null
    let sourceTimer: ReturnType<typeof setTimeout> | null = null

    const getTopicElements = (container: HTMLDivElement) => {
      const elements = new Map<number, HTMLElement>()
      for (const id of topicIds) {
        const el = container.querySelector(`[data-topic-id="${id}"]`) as HTMLElement | null
        if (el) elements.set(id, el)
      }
      return elements
    }

    const syncColumns = (source: HTMLDivElement, target: HTMLDivElement) => {
      const sourceEls = getTopicElements(source)
      const targetEls = getTopicElements(target)
      const sourceRect = source.getBoundingClientRect()

      // Find topmost visible topic in the source column
      let activeId: number | null = null
      let activeOffset = 0
      for (const id of topicIds) {
        const el = sourceEls.get(id)
        if (!el) continue
        const elTop = el.getBoundingClientRect().top - sourceRect.top
        if (elTop <= 20) {
          activeId = id
          activeOffset = elTop
        }
      }
      if (activeId === null && topicIds.length > 0) {
        activeId = topicIds[0]
        const el = sourceEls.get(activeId)
        if (el) activeOffset = el.getBoundingClientRect().top - sourceRect.top
      }
      if (activeId === null) return

      // Align same topic in target column to the same viewport offset
      const targetEl = targetEls.get(activeId)
      if (targetEl) {
        const targetRect = target.getBoundingClientRect()
        const targetElTop = targetEl.getBoundingClientRect().top - targetRect.top
        target.scrollTop = target.scrollTop + targetElTop - activeOffset
      }
    }

    let leftQueued = false
    let rightQueued = false

    const leftHandler = () => {
      if (scrollSource === 'right') return
      scrollSource = 'left'
      if (sourceTimer) clearTimeout(sourceTimer)
      sourceTimer = setTimeout(() => { scrollSource = null }, 80)

      if (leftQueued) return
      leftQueued = true
      requestAnimationFrame(() => { syncColumns(left, right); leftQueued = false })
    }

    const rightHandler = () => {
      if (scrollSource === 'left') return
      scrollSource = 'right'
      if (sourceTimer) clearTimeout(sourceTimer)
      sourceTimer = setTimeout(() => { scrollSource = null }, 80)

      if (rightQueued) return
      rightQueued = true
      requestAnimationFrame(() => { syncColumns(right, left); rightQueued = false })
    }

    left.addEventListener('scroll', leftHandler, { passive: true })
    right.addEventListener('scroll', rightHandler, { passive: true })
    return () => {
      left.removeEventListener('scroll', leftHandler)
      right.removeEventListener('scroll', rightHandler)
      if (sourceTimer) clearTimeout(sourceTimer)
    }
  }, [topicIds])

  /* ---- Mirror cursor (ref-based, zero re-renders) ---- */
  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right) return

    const handleMouseMove = (e: MouseEvent) => {
      const cursor = cursorRef.current
      if (!cursor) return
      const leftRect = left.getBoundingClientRect()
      const rightRect = right.getBoundingClientRect()
      const relX = (e.clientX - leftRect.left) / leftRect.width
      const relY = (e.clientY - leftRect.top) / leftRect.height
      cursor.style.left = `${rightRect.left + relX * rightRect.width}px`
      cursor.style.top = `${rightRect.top + relY * rightRect.height}px`
      cursor.style.display = 'block'
    }

    const handleMouseLeave = () => {
      if (cursorRef.current) cursorRef.current.style.display = 'none'
    }

    const handleClick = () => {
      const cursor = cursorRef.current
      if (!cursor) return
      const ripple = document.createElement('div')
      ripple.style.cssText = 'position:absolute;top:0;left:0;width:24px;height:24px;border-radius:50%;border:2px solid var(--accent);animation:mirror-click-ripple 0.4s ease-out forwards;transform:translate(-6px,-6px);'
      cursor.appendChild(ripple)
      setTimeout(() => ripple.remove(), 400)
    }

    left.addEventListener('mousemove', handleMouseMove)
    left.addEventListener('mouseleave', handleMouseLeave)
    left.addEventListener('click', handleClick, true)
    return () => {
      left.removeEventListener('mousemove', handleMouseMove)
      left.removeEventListener('mouseleave', handleMouseLeave)
      left.removeEventListener('click', handleClick, true)
    }
  }, [topicIds.length])

  // Hide cursor when image overlay opens
  useEffect(() => {
    if (expandedImage && cursorRef.current) cursorRef.current.style.display = 'none'
  }, [expandedImage])

  /* ---- Right-click drawing on left column ---- */
  useEffect(() => {
    const left = leftRef.current
    if (!left) return

    const toLocal = (e: MouseEvent): TimedPoint => {
      const rect = left.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top + left.scrollTop, t: Date.now() }
    }

    const handleContextMenu = (e: MouseEvent) => e.preventDefault()

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return
      e.preventDefault()
      const now = Date.now()
      currentStrokeRef.current = [toLocal(e)]
      setDrawStrokes(prev => {
        const active = prev.filter(s => s.points.some(p => now - p.t < FADE_MS))
        return [...active, { points: [], color: drawColorRef.current, tool: drawToolRef.current, opacity: drawOpacityRef.current }]
      })
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!currentStrokeRef.current.length) return
      currentStrokeRef.current.push(toLocal(e))
      setDrawStrokes(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        updated[updated.length - 1] = { ...last, points: [...currentStrokeRef.current] }
        return updated
      })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 2 || !currentStrokeRef.current.length) return
      currentStrokeRef.current = []
    }

    left.addEventListener('contextmenu', handleContextMenu)
    left.addEventListener('mousedown', handleMouseDown)
    left.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      left.removeEventListener('contextmenu', handleContextMenu)
      left.removeEventListener('mousedown', handleMouseDown)
      left.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [topicIds.length])

  /* ---- Column size tracking ---- */
  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right) return

    const update = () => {
      setLeftSize({ w: left.clientWidth, h: left.scrollHeight })
      setRightSize({ w: right.clientWidth, h: right.scrollHeight })
    }
    update()

    const ro = new ResizeObserver(update)
    ro.observe(left)
    ro.observe(right)
    return () => ro.disconnect()
  }, [topicIds.length])

  const closeImage = useCallback(() => {
    setExpandedImage(null)
    setPhotoStrokes([])
  }, [])

  /* ---- Mirrored strokes (scroll-offset based, not ratio) ---- */
  // Converts left document coords to viewport coords, then to right document coords.
  // This ensures marks appear at the same viewport position on both sides.
  const hasColumnStrokes = drawStrokes.some(s => s.points.length >= 2)
  const leftScroll = leftRef.current?.scrollTop ?? 0
  const rightScroll = rightRef.current?.scrollTop ?? 0

  const mirroredDrawStrokes: StyledStroke[] = (hasColumnStrokes && leftSize.w > 0 && rightSize.w > 0)
    ? drawStrokes.map(s => ({
        ...s,
        points: s.points.map(p => ({
          x: (p.x / leftSize.w) * rightSize.w,
          y: p.y - leftScroll + rightScroll,
          t: p.t,
        })),
      }))
    : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes mirror-click-ripple { from { transform: translate(-6px,-6px) scale(0.5); opacity: 1; } to { transform: translate(-6px,-6px) scale(2); opacity: 0; } }
      `}</style>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left column (editable) */}
        <div
          ref={(el) => { leftRef.current = el; leftColumnRef.current = el }}
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 20px', position: 'relative' }}
        >
          {hasColumnStrokes && <DrawCanvas strokes={drawStrokes} width={leftSize.w} height={leftSize.h} />}
          {topics.map((topic, idx) => (
            <div key={topic.id} data-topic-id={topic.id}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 0 8px', borderBottom: '2px solid var(--border)', marginBottom: 12,
              }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: topic.color || 'var(--text-tertiary)', flexShrink: 0 }} />
                <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>{topic.title}</span>
              </div>
              <TopicScriptSection topicId={topic.id} tweets={topic.tweets} onImageClick={setExpandedImage} onScriptStatus={handleScriptStatus} hideControls />
              {idx < topics.length - 1 && <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />}
            </div>
          ))}
        </div>

        <div style={{ width: 1, flexShrink: 0, background: 'var(--border)' }} />

        {/* Right column (mirror) */}
        <div
          ref={(el) => { rightRef.current = el; rightColumnRef.current = el }}
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 16px', position: 'relative' }}
        >
          {mirroredDrawStrokes.length > 0 && <DrawCanvas strokes={mirroredDrawStrokes} width={rightSize.w} height={rightSize.h} />}
          {topics.map((topic, idx) => (
            <div key={topic.id} data-topic-id={topic.id}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 0 8px', borderBottom: '2px solid var(--border)', marginBottom: 12,
              }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: topic.color || 'var(--text-tertiary)', flexShrink: 0 }} />
                <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>{topic.title}</span>
              </div>
              <TopicScriptSectionMirror topicId={topic.id} tweets={topic.tweets} allTweets={allTweets} onImageClick={setExpandedImage} />
              {idx < topics.length - 1 && <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Mirror cursor (always mounted, positioned via ref) */}
      {createPortal(
        <div
          ref={cursorRef}
          style={{
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: 100,
            display: 'none',
            transform: 'translate(-1px, -1px)',
          }}
        >
          <svg width="14" height="20" viewBox="0 0 14 20" fill="none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}>
            <path d="M0.5 0.5L0.5 17L5 12L8.5 19L10.5 18L7 11H13L0.5 0.5Z" fill="white" stroke="black" strokeWidth="0.8" strokeLinejoin="round" />
          </svg>
        </div>,
        document.body,
      )}

      {/* Image overlays */}
      {expandedImage && (
        <>
          <InlineImageOverlay
            url={expandedImage}
            onClose={closeImage}
            containerRef={leftColumnRef}
            drawingEnabled
            drawStrokes={photoStrokes}
            onDrawStrokes={setPhotoStrokes}
            toolRef={drawToolRef}
            colorRef={drawColorRef}
            opacityRef={drawOpacityRef}
          />
          <InlineImageOverlay
            url={expandedImage}
            onClose={closeImage}
            containerRef={rightColumnRef}
            drawStrokes={photoStrokes}
          />
        </>
      )}
    </div>
  )
}
