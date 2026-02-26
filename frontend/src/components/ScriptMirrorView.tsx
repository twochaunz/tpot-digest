import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { TopicBundle } from '../api/dayBundle'
import {
  FADE_MS,
  type DrawTool,
  type TimedPoint,
  type StyledStroke,
  ColorWheelPicker,
  DrawCanvas,
  InlineImageOverlay,
  MirrorCursor,
  TopicScriptSection,
  TopicScriptSectionMirror,
} from './DayScriptView'

interface ScriptMirrorViewProps {
  topics: TopicBundle[]
}

export function ScriptMirrorView({ topics }: ScriptMirrorViewProps) {
  /* ---- Drawing state ---- */
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [mirrorPos, setMirrorPos] = useState<{ x: number; y: number } | null>(null)
  const [mirrorClicking, setMirrorClicking] = useState(false)
  const [drawStrokes, setDrawStrokes] = useState<StyledStroke[]>([])
  const [photoStrokes, setPhotoStrokes] = useState<StyledStroke[]>([])
  const [drawTool, setDrawTool] = useState<DrawTool>('pen')
  const [drawColor, setDrawColor] = useState('#FF4444')
  const [drawOpacity, setDrawOpacity] = useState(1)
  const currentStrokeRef = useRef<TimedPoint[]>([])
  const drawToolRef = useRef<DrawTool>(drawTool)
  const drawColorRef = useRef(drawColor)
  const drawOpacityRef = useRef(drawOpacity)
  drawToolRef.current = drawTool
  drawColorRef.current = drawColor
  drawOpacityRef.current = drawOpacity

  const [leftSize, setLeftSize] = useState({ w: 0, h: 0 })
  const [rightSize, setRightSize] = useState({ w: 0, h: 0 })
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const leftColumnRef = useRef<HTMLDivElement>(null)
  const rightColumnRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  // No-op script status handler (generation controls are in TopicManagerView)
  const handleScriptStatus = useCallback((_topicId: number, _hasScript: boolean) => {}, [])

  // All tweets across topics (for mirror tweet lookup)
  const allTweets = useMemo(() => topics.flatMap(t => t.tweets), [topics])

  // Topic IDs in order (for scroll sync)
  const topicIds = useMemo(() => topics.map(t => t.id), [topics])

  /* ---- Element-aligned scroll sync ---- */
  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right || topicIds.length === 0) return

    const getTopicElements = (container: HTMLDivElement) => {
      const elements = new Map<number, HTMLElement>()
      for (const id of topicIds) {
        const el = container.querySelector(`[data-topic-id="${id}"]`) as HTMLElement | null
        if (el) elements.set(id, el)
      }
      return elements
    }

    const syncFromLeftToRight = () => {
      if (syncing.current) return
      syncing.current = true

      const leftEls = getTopicElements(left)
      const rightEls = getTopicElements(right)
      const leftRect = left.getBoundingClientRect()

      // Find topmost visible topic in left column
      let activeId: number | null = null
      let activeOffset = 0

      for (const id of topicIds) {
        const el = leftEls.get(id)
        if (!el) continue
        const elTop = el.getBoundingClientRect().top - leftRect.top
        if (elTop <= 20) {
          activeId = id
          activeOffset = elTop
        }
      }
      if (activeId === null && topicIds.length > 0) {
        activeId = topicIds[0]
        const el = leftEls.get(activeId)
        if (el) activeOffset = el.getBoundingClientRect().top - leftRect.top
      }
      if (activeId === null) { syncing.current = false; return }

      const rightEl = rightEls.get(activeId)
      if (rightEl) {
        const rightRect = right.getBoundingClientRect()
        const rightElTop = rightEl.getBoundingClientRect().top - rightRect.top
        right.scrollTop = right.scrollTop + rightElTop - activeOffset
      }

      syncing.current = false
    }

    const syncFromRightToLeft = () => {
      if (syncing.current) return
      syncing.current = true

      const leftEls = getTopicElements(left)
      const rightEls = getTopicElements(right)
      const rightRect = right.getBoundingClientRect()

      let activeId: number | null = null
      let activeOffset = 0

      for (const id of topicIds) {
        const el = rightEls.get(id)
        if (!el) continue
        const elTop = el.getBoundingClientRect().top - rightRect.top
        if (elTop <= 20) {
          activeId = id
          activeOffset = elTop
        }
      }
      if (activeId === null && topicIds.length > 0) {
        activeId = topicIds[0]
        const el = rightEls.get(activeId)
        if (el) activeOffset = el.getBoundingClientRect().top - rightRect.top
      }
      if (activeId === null) { syncing.current = false; return }

      const leftEl = leftEls.get(activeId)
      if (leftEl) {
        const leftRect = left.getBoundingClientRect()
        const leftElTop = leftEl.getBoundingClientRect().top - leftRect.top
        left.scrollTop = left.scrollTop + leftElTop - activeOffset
      }

      syncing.current = false
    }

    // rAF-throttled handlers
    let leftQueued = false
    let rightQueued = false

    const leftHandler = () => {
      if (leftQueued) return
      leftQueued = true
      requestAnimationFrame(() => { syncFromLeftToRight(); leftQueued = false })
    }
    const rightHandler = () => {
      if (rightQueued) return
      rightQueued = true
      requestAnimationFrame(() => { syncFromRightToLeft(); rightQueued = false })
    }

    left.addEventListener('scroll', leftHandler, { passive: true })
    right.addEventListener('scroll', rightHandler, { passive: true })
    return () => {
      left.removeEventListener('scroll', leftHandler)
      right.removeEventListener('scroll', rightHandler)
    }
  }, [topicIds])

  /* ---- Mirror mouse ---- */
  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right) return

    const handleMouseMove = (e: MouseEvent) => {
      const leftRect = left.getBoundingClientRect()
      const rightRect = right.getBoundingClientRect()
      const relX = (e.clientX - leftRect.left) / leftRect.width
      const relY = (e.clientY - leftRect.top) / leftRect.height
      setMirrorPos({
        x: rightRect.left + relX * rightRect.width,
        y: rightRect.top + relY * rightRect.height,
      })
    }

    const handleMouseLeave = () => setMirrorPos(null)
    const handleClick = () => {
      setMirrorClicking(true)
      setTimeout(() => setMirrorClicking(false), 400)
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

  /* ---- Mirrored strokes ---- */
  const hasColumnStrokes = drawStrokes.some(s => s.points.length >= 2)

  const mirroredDrawStrokes: StyledStroke[] = (hasColumnStrokes && leftSize.w > 0 && rightSize.w > 0)
    ? drawStrokes.map(s => ({
        ...s,
        points: s.points.map(p => ({
          x: (p.x / leftSize.w) * rightSize.w,
          y: (p.y / leftSize.h) * rightSize.h,
          t: p.t,
        })),
      }))
    : []

  const toolBtnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--accent)' : 'none',
    color: active ? '#fff' : 'var(--text-secondary)',
    border: active ? 'none' : '1px solid var(--border)',
    fontSize: 12,
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: 'var(--radius-sm)',
  })

  /* ---- Render ---- */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes mirror-click-ripple { from { transform: translate(-6px,-6px) scale(0.5); opacity: 1; } to { transform: translate(-6px,-6px) scale(2); opacity: 0; } }
      `}</style>

      {/* Drawing tools header bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        padding: '6px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <button onClick={() => setDrawTool('pen')} style={toolBtnStyle(drawTool === 'pen')}>Pen</button>
        <button onClick={() => setDrawTool('highlighter')} style={toolBtnStyle(drawTool === 'highlighter')}>Highlighter</button>
        <ColorWheelPicker color={drawColor} opacity={drawOpacity} onColorChange={setDrawColor} onOpacityChange={setDrawOpacity} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {topics.length} topic{topics.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left column (editable) */}
        <div
          ref={(el) => { leftRef.current = el; leftColumnRef.current = el }}
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 20px', position: 'relative' }}
        >
          {hasColumnStrokes && <DrawCanvas strokes={drawStrokes} width={leftSize.w} height={leftSize.h} />}
          {topics.map((topic, idx) => (
            <div key={topic.id} data-topic-id={topic.id}>
              {/* Topic header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 0 8px', borderBottom: '2px solid var(--border)', marginBottom: 12,
              }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: topic.color || 'var(--text-tertiary)', flexShrink: 0 }} />
                <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>{topic.title}</span>
              </div>
              {/* Script content */}
              <TopicScriptSection topicId={topic.id} tweets={topic.tweets} onImageClick={setExpandedImage} onScriptStatus={handleScriptStatus} />
              {/* Divider between topics */}
              {idx < topics.length - 1 && <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />}
            </div>
          ))}
        </div>

        {/* Center divider */}
        <div style={{ width: 1, flexShrink: 0, background: 'var(--border)' }} />

        {/* Right column (mirror) */}
        <div
          ref={(el) => { rightRef.current = el; rightColumnRef.current = el }}
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 16px', position: 'relative' }}
        >
          {mirroredDrawStrokes.length > 0 && <DrawCanvas strokes={mirroredDrawStrokes} width={rightSize.w} height={rightSize.h} />}
          {topics.map((topic, idx) => (
            <div key={topic.id} data-topic-id={topic.id}>
              {/* Topic header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 0 8px', borderBottom: '2px solid var(--border)', marginBottom: 12,
              }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: topic.color || 'var(--text-tertiary)', flexShrink: 0 }} />
                <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>{topic.title}</span>
              </div>
              {/* Script content */}
              <TopicScriptSectionMirror topicId={topic.id} tweets={topic.tweets} allTweets={allTweets} onImageClick={setExpandedImage} />
              {/* Divider between topics */}
              {idx < topics.length - 1 && <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Mirror cursor */}
      {!expandedImage && <MirrorCursor pos={mirrorPos} clicking={mirrorClicking} />}

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
