import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { type ScriptBlock, type TopicScript, AVAILABLE_MODELS, useGenerateScript, useUpdateScript } from '../api/scripts'
import { type Tweet } from '../api/tweets'
import { TweetCard } from './TweetCard'

interface ScriptViewProps {
  topicId: number
  topicTitle: string
  script: TopicScript | null
  tweets: Tweet[]
  showEngagement: boolean
  onClose: () => void
}

function ScriptTextBlock({ text, blockIndex, script, topicId }: {
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

/** Chunk an array into groups of at most `size` */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

type GroupedBlock =
  | { type: 'text'; index: number; block: ScriptBlock }
  | { type: 'tweet_group'; startIndex: number; blocks: ScriptBlock[] }

function groupBlocks(content: ScriptBlock[]): GroupedBlock[] {
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

function TweetRows({ blocks, startIndex, tweets, onImageClick }: {
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

/* ---- Fading drawing ---- */
const FADE_MS = 1500
type TimedPoint = { x: number; y: number; t: number }
type FadingStroke = TimedPoint[]

function DrawCanvas({ strokes, width, height, onAllFaded }: {
  strokes: FadingStroke[]
  width: number
  height: number
  onAllFaded?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const callbackRef = useRef(onAllFaded)
  callbackRef.current = onAllFaded

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || strokes.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio
    canvas.width = width * dpr
    canvas.height = height * dpr

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      const now = Date.now()
      let anyVisible = false

      ctx.lineWidth = 3
      ctx.lineCap = 'round'

      for (const stroke of strokes) {
        if (stroke.length < 2) continue
        for (let i = 1; i < stroke.length; i++) {
          const age = now - stroke[i].t
          const opacity = Math.max(0, 1 - age / FADE_MS)
          if (opacity <= 0) continue
          anyVisible = true
          ctx.strokeStyle = `rgba(255, 68, 68, ${opacity})`
          ctx.beginPath()
          ctx.moveTo(stroke[i - 1].x, stroke[i - 1].y)
          ctx.lineTo(stroke[i].x, stroke[i].y)
          ctx.stroke()
        }
      }

      if (anyVisible) {
        rafRef.current = requestAnimationFrame(draw)
      } else {
        callbackRef.current?.()
      }
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
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

/** Image overlay with optional right-click drawing */
function InlineImageOverlay({ url, onClose, containerRef, drawingEnabled, drawStrokes, onDrawStrokes }: {
  url: string
  onClose: () => void
  containerRef: React.RefObject<HTMLDivElement | null>
  drawingEnabled?: boolean
  drawStrokes?: FadingStroke[]
  onDrawStrokes?: React.Dispatch<React.SetStateAction<FadingStroke[]>>
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
      currentStrokeRef.current = [toLocal(e)]
      onDrawStrokes?.(prev => [...prev, []])
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!currentStrokeRef.current.length) return
      currentStrokeRef.current.push(toLocal(e))
      onDrawStrokes?.(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = [...currentStrokeRef.current]
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
  }, [drawingEnabled, onDrawStrokes])

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
      {drawStrokes && drawStrokes.length > 0 && (
        <DrawCanvas
          strokes={drawStrokes}
          width={rect.width}
          height={rect.height}
          onAllFaded={() => onDrawStrokes?.([])}
        />
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

/** Mirrored cursor (fixed positioning for accuracy) */
function MirrorCursor({ pos, clicking }: { pos: { x: number; y: number } | null; clicking: boolean }) {
  if (!pos) return null
  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        pointerEvents: 'none',
        zIndex: 100,
        transform: 'translate(-2px, -2px)',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}>
        <path d="M5 3l14 8.5L12 14l-3 7L5 3z" fill="white" stroke="black" strokeWidth="1.5" />
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

export default function ScriptView({ topicId, topicTitle, script, tweets, onClose }: ScriptViewProps) {
  const [model, setModel] = useState<string>(AVAILABLE_MODELS[0].id)
  const [feedback, setFeedback] = useState('')
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [mirrorPos, setMirrorPos] = useState<{ x: number; y: number } | null>(null)
  const [mirrorClicking, setMirrorClicking] = useState(false)
  const [drawStrokes, setDrawStrokes] = useState<FadingStroke[]>([])
  const generateScript = useGenerateScript()
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const leftColumnRef = useRef<HTMLDivElement>(null)
  const rightColumnRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  // Synchronized scrolling between left and right columns
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
  }, [script])

  // Mirror mouse from left column to right column (fixed coordinates)
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
  }, [script])

  const handleGenerate = () => {
    generateScript.mutate({
      topicId,
      model,
      feedback: feedback || undefined,
      fetchGrokContext: true,
    })
    setFeedback('')
  }

  const closeImage = useCallback(() => {
    setExpandedImage(null)
    setDrawStrokes([])
  }, [])

  // No script yet — show generate CTA
  if (!script) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '32px 16px',
        color: 'var(--text-secondary)',
      }}>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{
            background: 'var(--bg-raised)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
          }}
        >
          {AVAILABLE_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={generateScript.isPending}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 20px',
            fontSize: 14,
            cursor: generateScript.isPending ? 'wait' : 'pointer',
            opacity: generateScript.isPending ? 0.6 : 1,
          }}
        >
          {generateScript.isPending ? 'Generating...' : 'Generate Script'}
        </button>
      </div>
    )
  }

  const groupedBlocks = groupBlocks(script.content)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <style>{`@keyframes mirror-click-ripple { from { transform: translate(-6px,-6px) scale(0.5); opacity: 1; } to { transform: translate(-6px,-6px) scale(2); opacity: 0; } }`}</style>

      {/* Two-column script layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left: full script (text + tweet cards) */}
        <div
          ref={(el) => { leftRef.current = el; leftColumnRef.current = el }}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '12px 20px',
            position: 'relative',
          }}
        >
          <div style={{
            fontSize: 17, fontWeight: 600, color: 'var(--text-primary)',
            padding: '4px 0 12px', borderBottom: '1px solid var(--border)', marginBottom: 12,
          }}>
            {topicTitle}
          </div>
          {groupedBlocks.map((group) => {
            if (group.type === 'text' && group.block.text) {
              return (
                <ScriptTextBlock
                  key={group.index}
                  text={group.block.text}
                  blockIndex={group.index}
                  script={script}
                  topicId={topicId}
                />
              )
            }
            if (group.type === 'tweet_group') {
              return (
                <TweetRows
                  key={`tg-${group.startIndex}`}
                  blocks={group.blocks}
                  startIndex={group.startIndex}
                  tweets={tweets}
                  onImageClick={setExpandedImage}
                />
              )
            }
            return null
          })}
        </div>

        {/* Center divider with Back to Edit button */}
        <div style={{
          position: 'relative',
          width: 1,
          flexShrink: 0,
          background: 'var(--border)',
        }}>
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              whiteSpace: 'nowrap',
              zIndex: 10,
            }}
          >
            Back to Edit
          </button>
        </div>

        {/* Right: mirrored tweet cards with text placeholders */}
        <div
          ref={(el) => { rightRef.current = el; rightColumnRef.current = el }}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '12px 16px',
            position: 'relative',
          }}
        >
          <div style={{
            fontSize: 17, fontWeight: 600, color: 'var(--text-primary)',
            padding: '4px 0 12px', borderBottom: '1px solid var(--border)', marginBottom: 12,
          }}>
            {topicTitle}
          </div>
          {groupedBlocks.map((group) => {
            if (group.type === 'text' && group.block.text) {
              return (
                <div key={group.index} style={{
                  padding: '8px 0',
                  fontSize: '15px',
                  lineHeight: 1.6,
                  borderBottom: '1px solid var(--border)',
                  marginBottom: 4,
                }}>
                  <div style={{ visibility: 'hidden' }}>{group.block.text}</div>
                </div>
              )
            }
            if (group.type === 'tweet_group') {
              return (
                <TweetRows
                  key={`tg-${group.startIndex}`}
                  blocks={group.blocks}
                  startIndex={group.startIndex}
                  tweets={tweets}
                  onImageClick={setExpandedImage}
                />
              )
            }
            return null
          })}
        </div>
      </div>

      {/* Mirror cursor (hidden when image overlay is open) */}
      {!expandedImage && <MirrorCursor pos={mirrorPos} clicking={mirrorClicking} />}

      {/* Mirrored image overlays with drawing support */}
      {expandedImage && (
        <>
          <InlineImageOverlay
            url={expandedImage}
            onClose={closeImage}
            containerRef={leftColumnRef}
            drawingEnabled
            drawStrokes={drawStrokes}
            onDrawStrokes={setDrawStrokes}
          />
          <InlineImageOverlay
            url={expandedImage}
            onClose={closeImage}
            containerRef={rightColumnRef}
            drawStrokes={drawStrokes}
          />
        </>
      )}

      {/* Bottom bar: version info + feedback + regenerate */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '10px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          v{script.version} · {script.model_used} · {new Date(script.created_at).toLocaleString()}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{
              background: 'var(--bg-raised)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            {AVAILABLE_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Give feedback..."
            onKeyDown={(e) => { if (e.key === 'Enter') handleGenerate() }}
            style={{
              flex: 1,
              background: 'var(--bg-raised)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 13,
            }}
          />
          <button
            onClick={handleGenerate}
            disabled={generateScript.isPending}
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 13,
              cursor: generateScript.isPending ? 'wait' : 'pointer',
              opacity: generateScript.isPending ? 0.6 : 1,
              flexShrink: 0,
            }}
          >
            {generateScript.isPending ? 'Generating...' : 'Regenerate'}
          </button>
        </div>
      </div>
    </div>
  )
}
