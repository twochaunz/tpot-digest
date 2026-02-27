import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  type ScriptBlock,
  type TopicScript,
  AVAILABLE_MODELS,
  useTopicScript,
  useGenerateScript,
  useUpdateScript,
} from '../api/scripts'
import type { Tweet } from '../api/tweets'
import { TweetCard } from './TweetCard'

/* ---- Drawing types ---- */
export const FADE_MS = 2000
export type DrawTool = 'pen' | 'highlighter'
export type TimedPoint = { x: number; y: number; t: number }
export type StyledStroke = { points: TimedPoint[]; color: string; tool: DrawTool; opacity: number }

export function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) || 0
  const g = parseInt(hex.slice(3, 5), 16) || 0
  const b = parseInt(hex.slice(5, 7), 16) || 0
  return [r, g, b]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

/* ---- Circular color wheel picker ---- */
const WHEEL_SIZE = 140

export function ColorWheelPicker({ color, opacity, onColorChange, onOpacityChange }: {
  color: string
  opacity: number
  onColorChange: (c: string) => void
  onOpacityChange: (o: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [hexInput, setHexInput] = useState(color)
  const wheelRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => { setHexInput(color) }, [color])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const canvas = wheelRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = WHEEL_SIZE
    canvas.width = size
    canvas.height = size

    const imageData = ctx.createImageData(size, size)
    const data = imageData.data
    const cx = size / 2
    const radius = size / 2

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = px - cx
        const dy = py - cx
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > radius) continue

        const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360
        const sat = (dist / radius) * 100
        const light = 100 - (sat / 100) * 50
        const [r, g, b] = hslToRgb(angle, sat, light)

        const idx = (py * size + px) * 4
        data[idx] = r
        data[idx + 1] = g
        data[idx + 2] = b
        data[idx + 3] = 255
      }
    }
    ctx.putImageData(imageData, 0, 0)
  }, [open])

  const pickFromEvent = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = wheelRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.round((e.clientX - rect.left) / rect.width * WHEEL_SIZE)
    const y = Math.round((e.clientY - rect.top) / rect.height * WHEEL_SIZE)
    if (x < 0 || x >= WHEEL_SIZE || y < 0 || y >= WHEEL_SIZE) return

    const cx = WHEEL_SIZE / 2
    if (Math.sqrt((x - cx) ** 2 + (y - cx) ** 2) > cx) return

    const pixel = ctx.getImageData(x, y, 1, 1).data
    if (pixel[3] === 0) return
    const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('')
    onColorChange(hex)
    setHexInput(hex)
  }, [onColorChange])

  useEffect(() => {
    if (!open) return
    const handleMove = (e: MouseEvent) => { if (dragging.current) pickFromEvent(e) }
    const handleUp = () => { dragging.current = false }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [open, pickFromEvent])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: 22, height: 22, borderRadius: '50%',
          background: color, border: '2px solid var(--border)',
          cursor: 'pointer', padding: 0, flexShrink: 0,
          opacity: opacity,
        }}
        title="Pick color"
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          marginTop: 6, background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 12, zIndex: 200,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }}>
          <canvas
            ref={wheelRef}
            onMouseDown={(e) => { dragging.current = true; pickFromEvent(e) }}
            style={{ width: WHEEL_SIZE, height: WHEEL_SIZE, borderRadius: '50%', cursor: 'crosshair' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>Opacity</span>
            <input
              type="range" min={0} max={100}
              value={Math.round(opacity * 100)}
              onChange={(e) => onOpacityChange(parseInt(e.target.value) / 100)}
              style={{ flex: 1, accentColor: color }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 28, textAlign: 'right' }}>
              {Math.round(opacity * 100)}%
            </span>
          </div>
          <input
            type="text" value={hexInput}
            onChange={(e) => {
              setHexInput(e.target.value)
              if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onColorChange(e.target.value)
            }}
            onBlur={() => {
              if (/^#[0-9a-fA-F]{6}$/.test(hexInput)) onColorChange(hexInput)
              else setHexInput(color)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            placeholder="#FF4444"
            style={{
              width: '100%', background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px',
              fontSize: 12, fontFamily: 'monospace', textAlign: 'center', boxSizing: 'border-box',
            }}
          />
        </div>
      )}
    </div>
  )
}

/* ---- Draw canvas ---- */
export function DrawCanvas({ strokes, width, height }: {
  strokes: StyledStroke[]
  width: number
  height: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || strokes.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio
    canvas.width = width * dpr
    canvas.height = height * dpr

    let running = true
    const draw = () => {
      if (!running) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      const now = Date.now()
      let anyVisible = false

      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      for (const { points, color, tool, opacity: strokeOpacity } of strokes) {
        if (points.length < 2) continue
        const isPen = tool === 'pen'
        ctx.lineWidth = isPen ? 3 : 18
        const [r, g, b] = hexToRgb(color)
        const baseOpacity = isPen ? 1 : 0.35

        const visible = points.filter(p => (now - p.t) < FADE_MS)
        if (visible.length < 2) continue

        const newestFade = Math.max(0, 1 - (now - visible[visible.length - 1].t) / FADE_MS)
        if (newestFade <= 0) continue
        anyVisible = true

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${baseOpacity * strokeOpacity * newestFade})`
        ctx.beginPath()
        ctx.moveTo(visible[0].x, visible[0].y)

        if (visible.length === 2) {
          ctx.lineTo(visible[1].x, visible[1].y)
        } else {
          for (let i = 1; i < visible.length - 1; i++) {
            const mx = (visible[i].x + visible[i + 1].x) / 2
            const my = (visible[i].y + visible[i + 1].y) / 2
            ctx.quadraticCurveTo(visible[i].x, visible[i].y, mx, my)
          }
          const last = visible[visible.length - 1]
          ctx.lineTo(last.x, last.y)
        }
        ctx.stroke()
      }

      if (anyVisible) {
        rafRef.current = requestAnimationFrame(draw)
      }
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => { running = false; cancelAnimationFrame(rafRef.current) }
  }, [strokes, width, height])

  if (width === 0 || height === 0) return null

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: 'none',
        zIndex: 90,
      }}
    />
  )
}

/* ---- Image overlay with drawing ---- */
export function InlineImageOverlay({ url, onClose, containerRef, drawingEnabled, drawStrokes, onDrawStrokes, toolRef, colorRef, opacityRef }: {
  url: string
  onClose: () => void
  containerRef: React.RefObject<HTMLDivElement | null>
  drawingEnabled?: boolean
  drawStrokes?: StyledStroke[]
  onDrawStrokes?: React.Dispatch<React.SetStateAction<StyledStroke[]>>
  toolRef?: React.RefObject<DrawTool>
  colorRef?: React.RefObject<string>
  opacityRef?: React.RefObject<number>
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const currentStrokeRef = useRef<TimedPoint[]>([])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    if (!drawingEnabled || !overlayRef.current) return
    const el = overlayRef.current

    const toLocal = (e: MouseEvent): TimedPoint => {
      const rect = el.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: Date.now() }
    }

    const handleContextMenu = (e: MouseEvent) => e.preventDefault()

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return
      e.preventDefault()
      const now = Date.now()
      currentStrokeRef.current = [toLocal(e)]
      onDrawStrokes?.(prev => {
        const active = prev.filter(s => s.points.some(p => now - p.t < FADE_MS))
        return [...active, { points: [], color: colorRef?.current ?? '#FF4444', tool: toolRef?.current ?? 'pen', opacity: opacityRef?.current ?? 1 }]
      })
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!currentStrokeRef.current.length) return
      currentStrokeRef.current.push(toLocal(e))
      onDrawStrokes?.(prev => {
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

    el.addEventListener('contextmenu', handleContextMenu)
    el.addEventListener('mousedown', handleMouseDown)
    el.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      el.removeEventListener('contextmenu', handleContextMenu)
      el.removeEventListener('mousedown', handleMouseDown)
      el.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [drawingEnabled, onDrawStrokes, toolRef, colorRef, opacityRef])

  const container = containerRef.current
  if (!container) return null
  const rect = container.getBoundingClientRect()

  return createPortal(
    <div
      ref={overlayRef}
      onClick={onClose}
      style={{
        position: 'fixed',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: 150,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <img
        src={url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90%',
          maxHeight: '90%',
          objectFit: 'contain',
          borderRadius: 8,
          cursor: 'default',
        }}
      />
      {drawStrokes && drawStrokes.some(s => s.points.length >= 2) && (
        <DrawCanvas strokes={drawStrokes} width={rect.width} height={rect.height} />
      )}
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 12, right: 12,
          background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', fontSize: 22,
          width: 36, height: 36, borderRadius: '50%', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >&times;</button>
    </div>,
    document.body,
  )
}

/* ---- Mirror cursor ---- */
export function MirrorCursor({ pos, clicking }: { pos: { x: number; y: number } | null; clicking: boolean }) {
  if (!pos) return null
  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        pointerEvents: 'none',
        zIndex: 100,
        transform: 'translate(-1px, -1px)',
      }}
    >
      <svg width="14" height="20" viewBox="0 0 14 20" fill="none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}>
        <path d="M0.5 0.5L0.5 17L5 12L8.5 19L10.5 18L7 11H13L0.5 0.5Z" fill="white" stroke="black" strokeWidth="0.8" strokeLinejoin="round" />
      </svg>
      {clicking && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: '2px solid var(--accent)',
          animation: 'mirror-click-ripple 0.4s ease-out forwards',
          transform: 'translate(-6px, -6px)',
        }} />
      )}
    </div>,
    document.body,
  )
}

/* ---- Script text block (editable) ---- */
export function ScriptTextBlock({ text, blockIndex, script, topicId }: {
  text: string
  blockIndex: number
  script: TopicScript
  topicId: number
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(text)
  const updateScript = useUpdateScript()

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== text) {
      const updatedContent = script.content.map((b, i) =>
        i === blockIndex ? { ...b, text: trimmed } : b
      )
      updateScript.mutate({ topicId, content: updatedContent })
    } else {
      setEditValue(text)
    }
    setEditing(false)
  }, [editValue, text, blockIndex, script.content, topicId, updateScript])

  if (editing) {
    return (
      <textarea
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit()
          if (e.key === 'Escape') {
            setEditValue(text)
            setEditing(false)
          }
        }}
        onBlur={commitEdit}
        autoFocus
        style={{
          width: '100%',
          padding: '8px 6px',
          fontSize: '15px',
          lineHeight: 1.6,
          color: 'var(--text-primary)',
          background: 'var(--bg-base)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-sm)',
          outline: 'none',
          fontFamily: 'var(--font-body)',
          resize: 'vertical',
          minHeight: 60,
          boxSizing: 'border-box',
        }}
      />
    )
  }

  return (
    <div
      onClick={() => {
        setEditValue(text)
        setEditing(true)
      }}
      style={{
        padding: '8px 0',
        fontSize: '15px',
        lineHeight: 1.6,
        color: 'var(--text-primary)',
        cursor: 'text',
      }}
    >
      {text}
    </div>
  )
}


export type GroupedBlock =
  | { type: 'text'; index: number; block: ScriptBlock }
  | { type: 'tweet_group'; startIndex: number; blocks: ScriptBlock[] }

export function groupBlocks(content: ScriptBlock[]): GroupedBlock[] {
  const groups: GroupedBlock[] = []
  for (let i = 0; i < content.length; i++) {
    const block = content[i]
    if (block.type === 'tweet' && block.tweet_id) {
      const tweetBlocks: ScriptBlock[] = [block]
      while (i + 1 < content.length && content[i + 1].type === 'tweet' && content[i + 1].tweet_id) {
        i++
        tweetBlocks.push(content[i])
      }
      groups.push({ type: 'tweet_group', startIndex: i - tweetBlocks.length + 1, blocks: tweetBlocks })
    } else {
      groups.push({ type: 'text', index: i, block })
    }
  }
  return groups
}

export function TweetRows({ blocks, startIndex, tweets, onImageClick }: {
  blocks: ScriptBlock[]
  startIndex: number
  tweets: Tweet[]
  onImageClick?: (url: string) => void
}) {
  const handleContainerClick = onImageClick ? (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'IMG') {
      const src = (target as HTMLImageElement).src
      if (target.clientWidth > 60) {
        e.stopPropagation()
        e.preventDefault()
        onImageClick(src)
      }
    }
  } : undefined

  return (
    <div style={{ margin: '8px 0' }} onClickCapture={handleContainerClick}>
      {blocks.map((b, i) => {
        const tweet = tweets.find(t => t.tweet_id === b.tweet_id)
        if (!tweet) return null
        return (
          <div key={`${startIndex}-${i}`} data-tweet-id={b.tweet_id} style={{ marginBottom: i < blocks.length - 1 ? 10 : 0 }}>
            <TweetCard tweet={tweet} selectable={false} />
          </div>
        )
      })}
    </div>
  )
}

/* ---- Per-topic script section ---- */
export function TopicScriptSection({ topicId, tweets, onImageClick, onScriptStatus, hideControls }: {
  topicId: number
  tweets: Tweet[]
  onImageClick: (url: string) => void
  onScriptStatus: (topicId: number, hasScript: boolean) => void
  hideControls?: boolean
}) {
  const { data: script, isLoading } = useTopicScript(topicId)
  const generateScript = useGenerateScript()
  const [model, setModel] = useState<string>(AVAILABLE_MODELS[0].id)
  const [feedback, setFeedback] = useState('')

  // Report script status to parent
  useEffect(() => {
    if (!isLoading) {
      onScriptStatus(topicId, !!script)
    }
  }, [topicId, script, isLoading, onScriptStatus])

  const handleRegenerate = () => {
    generateScript.mutate({ topicId, model, feedback: feedback || undefined, fetchGrokContext: true })
    setFeedback('')
  }

  const groupedBlocks = script ? groupBlocks(script.content) : []

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Loading state */}
      {isLoading && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '20px 0',
          color: 'var(--text-tertiary)',
          fontSize: 13,
        }}>
          <span style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            border: '2px solid var(--border-strong)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          Loading script...
        </div>
      )}

      {/* Script content */}
      {script && !isLoading && (
        <>
          {groupedBlocks.map((group) => {
            if (group.type === 'text' && group.block.text) {
              return <ScriptTextBlock key={`${topicId}-${group.index}`} text={group.block.text} blockIndex={group.index} script={script} topicId={topicId} />
            }
            if (group.type === 'tweet_group') {
              return <TweetRows key={`${topicId}-tg-${group.startIndex}`} blocks={group.blocks} startIndex={group.startIndex} tweets={tweets} onImageClick={onImageClick} />
            }
            return null
          })}

          {/* Script info + regeneration controls */}
          {!hideControls && (
            <div style={{
              marginTop: 8,
              padding: '8px 0',
              borderTop: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                v{script.version} · {script.model_used} · {new Date(script.created_at).toLocaleString()}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select value={model} onChange={(e) => setModel(e.target.value)} style={{
                  background: 'var(--bg-raised)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12, flexShrink: 0,
                }}>
                  {AVAILABLE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <input type="text" value={feedback} onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Feedback..."
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRegenerate() }}
                  style={{
                    flex: 1, background: 'var(--bg-raised)', color: 'var(--text-primary)',
                    border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12,
                  }}
                />
                <button onClick={handleRegenerate} disabled={generateScript.isPending} style={{
                  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6,
                  padding: '4px 12px', fontSize: 12,
                  cursor: generateScript.isPending ? 'wait' : 'pointer',
                  opacity: generateScript.isPending ? 0.6 : 1, flexShrink: 0,
                }}>
                  {generateScript.isPending ? 'Generating...' : 'Regenerate'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* No script — show generate controls */}
      {!script && !isLoading && !hideControls && (
        <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={{
            background: 'var(--bg-raised)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12,
          }}>
            {AVAILABLE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button
            onClick={() => generateScript.mutate({ topicId, model, fetchGrokContext: true })}
            disabled={generateScript.isPending}
            style={{
              background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6,
              padding: '4px 12px', fontSize: 12,
              cursor: generateScript.isPending ? 'wait' : 'pointer',
              opacity: generateScript.isPending ? 0.6 : 1,
            }}
          >
            {generateScript.isPending ? 'Generating...' : 'Generate Script'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ---- Read-only mirror of a topic's script (right column) ---- */
export function TopicScriptSectionMirror({ topicId, tweets, allTweets, onImageClick }: {
  topicId: number
  tweets: Tweet[]
  allTweets: Tweet[]
  onImageClick: (url: string) => void
}) {
  const { data: script, isLoading } = useTopicScript(topicId)

  const groupedBlocks = script ? groupBlocks(script.content) : []
  const tweetPool = [...tweets, ...allTweets]

  return (
    <div style={{ marginBottom: 8 }}>
      {isLoading && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '20px 0',
          color: 'var(--text-tertiary)',
          fontSize: 13,
        }}>
          <span style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            border: '2px solid var(--border-strong)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          Loading script...
        </div>
      )}

      {script && !isLoading && (
        <>
          {groupedBlocks.map((group) => {
            if (group.type === 'tweet_group') {
              return <TweetRows key={`${topicId}-tg-${group.startIndex}`} blocks={group.blocks} startIndex={group.startIndex} tweets={tweetPool} onImageClick={onImageClick} />
            }
            return null
          })}
        </>
      )}

      {!script && !isLoading && (
        <div style={{ padding: '12px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
          No script generated yet.
        </div>
      )}
    </div>
  )
}
