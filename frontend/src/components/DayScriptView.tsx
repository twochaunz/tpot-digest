import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  type ScriptBlock,
  type TopicScript,
  AVAILABLE_MODELS,
  useTopicScript,
  useGenerateScript,
  useGenerateDayScripts,
  useUpdateScript,
} from '../api/scripts'
import type { TopicBundle } from '../api/dayBundle'
import type { Tweet } from '../api/tweets'
import { useUpdateTopic } from '../api/topics'
import { TweetCard } from './TweetCard'
import { sortTopics } from '../utils/topics'

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

/* ---- Helpers ---- */
export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
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
  const rows = chunk(blocks, 3)

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
      {rows.map((row, ri) => {
        const isSingle = row.length === 1
        return (
          <div key={ri} style={{
            display: isSingle ? 'block' : 'flex',
            gap: isSingle ? 0 : 10,
            marginBottom: ri < rows.length - 1 ? 10 : 0,
          }}>
            {row.map((b, j) => {
              const tweet = tweets.find(t => t.tweet_id === b.tweet_id)
              if (!tweet) return null
              return (
                <div key={`${startIndex}-${ri}-${j}`} style={{
                  flex: isSingle ? undefined : 1,
                  minWidth: 0,
                }}>
                  <TweetCard tweet={tweet} selectable={false} />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/* ---- Per-topic script section ---- */
export function TopicScriptSection({ topicId, tweets, onImageClick, onScriptStatus }: {
  topicId: number
  tweets: Tweet[]
  onImageClick: (url: string) => void
  onScriptStatus: (topicId: number, hasScript: boolean) => void
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
        </>
      )}

      {/* No script — show generate controls */}
      {!script && !isLoading && (
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
            if (group.type === 'text' && group.block.text) {
              return (
                <div key={`${topicId}-${group.index}`} style={{
                  padding: '8px 0', fontSize: '15px', lineHeight: 1.6,
                  borderBottom: '1px solid var(--border)', marginBottom: 4,
                }}>
                  <div style={{ visibility: 'hidden' }}>{group.block.text}</div>
                </div>
              )
            }
            if (group.type === 'tweet_group') {
              return <TweetRows key={`${topicId}-tg-${group.startIndex}`} blocks={group.blocks} startIndex={group.startIndex} tweets={tweetPool} onImageClick={onImageClick} />
            }
            return null
          })}

          <div style={{
            marginTop: 8,
            padding: '8px 0',
            borderTop: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
              v{script.version} · {script.model_used}
            </div>
          </div>
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

/* ---- Sortable topic wrapper ---- */
function SortableTopicItem({ topic, editable, allTweets, onImageClick, onScriptStatus }: {
  topic: TopicBundle
  editable: boolean
  allTweets: Tweet[]
  onImageClick: (url: string) => void
  onScriptStatus: (topicId: number, hasScript: boolean) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: topic.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      {/* Topic header with drag handle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 0 8px',
        borderBottom: '2px solid var(--border)',
        marginBottom: 12,
      }}>
        {editable && (
          <span
            {...attributes}
            {...listeners}
            style={{
              cursor: 'grab',
              color: 'var(--text-tertiary)',
              fontSize: 14,
              lineHeight: 1,
              padding: '2px 4px',
              userSelect: 'none',
              touchAction: 'none',
            }}
            title="Drag to reorder"
          >
            &#10303;
          </span>
        )}
        <span style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: topic.color || 'var(--text-tertiary)',
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 17,
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          {topic.title}
        </span>
      </div>

      {/* Script content */}
      {editable ? (
        <TopicScriptSection
          topicId={topic.id}
          tweets={topic.tweets}
          onImageClick={onImageClick}
          onScriptStatus={onScriptStatus}
        />
      ) : (
        <TopicScriptSectionMirror
          topicId={topic.id}
          tweets={topic.tweets}
          allTweets={allTweets}
          onImageClick={onImageClick}
        />
      )}
    </div>
  )
}

/* ---- Main DayScriptView ---- */
interface DayScriptViewProps {
  date: string
  topics: TopicBundle[]
  onClose: () => void
}

export default function DayScriptView({ date, topics, onClose }: DayScriptViewProps) {
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

  // Track topic order locally (init from sorted topics)
  const [orderedTopicIds, setOrderedTopicIds] = useState<number[]>(() =>
    sortTopics(topics).map(t => t.id)
  )

  // Track which topics have scripts
  const [scriptStatus, setScriptStatus] = useState<Map<number, boolean>>(new Map())

  const handleScriptStatus = useCallback((topicId: number, hasScript: boolean) => {
    setScriptStatus(prev => {
      if (prev.get(topicId) === hasScript) return prev
      const next = new Map(prev)
      next.set(topicId, hasScript)
      return next
    })
  }, [])

  // Sync orderedTopicIds when topics are added/removed
  useEffect(() => {
    const currentIds = new Set(topics.map(t => t.id))
    const orderedSet = new Set(orderedTopicIds)

    // Check if sets differ
    if (currentIds.size !== orderedSet.size || [...currentIds].some(id => !orderedSet.has(id))) {
      setOrderedTopicIds(prev => {
        // Keep existing order for topics that still exist, append new ones
        const kept = prev.filter(id => currentIds.has(id))
        const newIds = topics.filter(t => !orderedSet.has(t.id)).map(t => t.id)
        return [...kept, ...newIds]
      })
    }
  }, [topics]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build ordered topic list from IDs
  const topicMap = new Map(topics.map(t => [t.id, t]))
  const orderedTopics = orderedTopicIds
    .map(id => topicMap.get(id))
    .filter((t): t is TopicBundle => !!t)

  // All tweets across topics (for tweet card lookup)
  const allTweets = orderedTopics.flatMap(t => t.tweets)

  // Compute missing script count
  const missingScriptIds = orderedTopics
    .filter(t => scriptStatus.get(t.id) === false)
    .map(t => t.id)

  // Generate missing scripts
  const generateAll = useGenerateDayScripts()
  const [genModel, setGenModel] = useState<string>(AVAILABLE_MODELS[0].id)

  const handleGenerateMissing = useCallback(() => {
    if (missingScriptIds.length === 0) return
    generateAll.mutate({
      date,
      model: genModel,
      topicIds: missingScriptIds,
    })
  }, [generateAll, date, genModel, missingScriptIds])

  // Persist topic reorder
  const updateTopicMutation = useUpdateTopic()

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setOrderedTopicIds(prev => {
      const oldIndex = prev.indexOf(active.id as number)
      const newIndex = prev.indexOf(over.id as number)
      const newOrder = arrayMove(prev, oldIndex, newIndex)

      // Persist position updates
      newOrder.forEach((id, idx) => {
        const topic = topicMap.get(id)
        if (topic && topic.position !== idx) {
          updateTopicMutation.mutate({ id, position: idx })
        }
      })

      return newOrder
    })
  }, [topicMap, updateTopicMutation])

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !expandedImage) { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, expandedImage])

  // Synchronized scrolling
  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right) return

    const syncScroll = (source: HTMLDivElement, target: HTMLDivElement) => () => {
      if (syncing.current) return
      syncing.current = true
      const ratio = source.scrollTop / (source.scrollHeight - source.clientHeight || 1)
      target.scrollTop = ratio * (target.scrollHeight - target.clientHeight || 1)
      syncing.current = false
    }

    const leftHandler = syncScroll(left, right)
    const rightHandler = syncScroll(right, left)
    left.addEventListener('scroll', leftHandler)
    right.addEventListener('scroll', rightHandler)
    return () => {
      left.removeEventListener('scroll', leftHandler)
      right.removeEventListener('scroll', rightHandler)
    }
  }, [orderedTopics.length])

  // Mirror mouse
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
  }, [orderedTopics.length])

  // Right-click drawing on left column
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
  }, [orderedTopics.length])

  // Track column sizes
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
  }, [orderedTopics.length])

  const closeImage = useCallback(() => {
    setExpandedImage(null)
    setPhotoStrokes([])
  }, [])

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

  // Content renderer for a column
  const renderContent = (editable: boolean) => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={editable ? handleDragEnd : undefined}
    >
      <SortableContext items={orderedTopicIds} strategy={verticalListSortingStrategy}>
        {orderedTopics.map((topic, idx) => (
          <div key={topic.id}>
            <SortableTopicItem
              topic={topic}
              editable={editable}
              allTweets={allTweets}
              onImageClick={setExpandedImage}
              onScriptStatus={handleScriptStatus}
            />
            {idx < orderedTopics.length - 1 && (
              <div style={{
                height: 1,
                background: 'var(--border)',
                margin: '16px 0',
              }} />
            )}
          </div>
        ))}
      </SortableContext>
      <DragOverlay />
    </DndContext>
  )

  return createPortal(
    <div style={{
      position: 'fixed',
      top: 66,
      left: 0,
      width: '100vw',
      height: 'calc(100vh - 66px)',
      zIndex: 60,
      background: 'var(--bg-raised)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes mirror-click-ripple { from { transform: translate(-6px,-6px) scale(0.5); opacity: 1; } to { transform: translate(-6px,-6px) scale(2); opacity: 0; } }
      `}</style>

      {/* Header: Back + drawing tools + generate missing */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        padding: '6px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          background: 'none', border: '1px solid var(--border)',
          color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
          padding: '4px 14px', borderRadius: 'var(--radius-sm)',
        }}>
          Back
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
        <button onClick={() => setDrawTool('pen')} style={toolBtnStyle(drawTool === 'pen')}>Pen</button>
        <button onClick={() => setDrawTool('highlighter')} style={toolBtnStyle(drawTool === 'highlighter')}>Highlighter</button>
        <ColorWheelPicker color={drawColor} opacity={drawOpacity} onColorChange={setDrawColor} onOpacityChange={setDrawOpacity} />
        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />

        {/* Generate Missing button */}
        {missingScriptIds.length > 0 && (
          <>
            <select value={genModel} onChange={(e) => setGenModel(e.target.value)} style={{
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              padding: '3px 6px', fontSize: 11,
            }}>
              {AVAILABLE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <button
              onClick={handleGenerateMissing}
              disabled={generateAll.isPending}
              style={{
                background: generateAll.isPending ? 'var(--bg-elevated)' : 'var(--accent)',
                color: generateAll.isPending ? 'var(--text-tertiary)' : '#fff',
                border: 'none', borderRadius: 'var(--radius-sm)',
                padding: '4px 12px', fontSize: 12, fontWeight: 600,
                cursor: generateAll.isPending ? 'wait' : 'pointer',
              }}
            >
              {generateAll.isPending ? 'Generating...' : `Generate Missing (${missingScriptIds.length})`}
            </button>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
          </>
        )}

        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {orderedTopics.length} topic{orderedTopics.length !== 1 ? 's' : ''}
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
          {renderContent(true)}
        </div>

        {/* Center divider */}
        <div style={{ width: 1, flexShrink: 0, background: 'var(--border)' }} />

        {/* Right column (mirror) */}
        <div
          ref={(el) => { rightRef.current = el; rightColumnRef.current = el }}
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 16px', position: 'relative' }}
        >
          {mirroredDrawStrokes.length > 0 && <DrawCanvas strokes={mirroredDrawStrokes} width={rightSize.w} height={rightSize.h} />}
          {renderContent(false)}
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
    </div>,
    document.body,
  )
}
