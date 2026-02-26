import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { type ScriptBlock, type TopicScript, AVAILABLE_MODELS, useGenerateScript, useUpdateScript } from '../api/scripts'
import { type Tweet } from '../api/tweets'
import { TweetCard } from './TweetCard'

interface ScriptViewProps {
  topicId: number
  script: TopicScript | null
  tweets: Tweet[]
  showEngagement: boolean
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
      // Only intercept media images (not avatars — avatars are 40px)
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

function InlineImageOverlay({ url, onClose, containerRef }: {
  url: string
  onClose: () => void
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const container = containerRef.current
  if (!container) return null

  const rect = container.getBoundingClientRect()

  return createPortal(
    <div
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

export default function ScriptView({ topicId, script, tweets }: ScriptViewProps) {
  const [model, setModel] = useState<string>(AVAILABLE_MODELS[0].id)
  const [feedback, setFeedback] = useState('')
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
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

  const handleGenerate = () => {
    generateScript.mutate({
      topicId,
      model,
      feedback: feedback || undefined,
      fetchGrokContext: true,
    })
    setFeedback('')
  }

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
      {/* Two-column script layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left: full script (text + tweet cards) */}
        <div
          ref={(el) => { leftRef.current = el; leftColumnRef.current = el }}
          style={{
            width: '50%',
            flexShrink: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '12px 20px',
          }}
        >
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

        {/* Center divider */}
        <div style={{
          width: 1,
          flexShrink: 0,
          background: 'var(--border)',
        }} />

        {/* Right: tweet cards only, divider placeholders for text blocks */}
        <div
          ref={(el) => { rightRef.current = el; rightColumnRef.current = el }}
          style={{
            width: '50%',
            flexShrink: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '12px 16px',
          }}
        >
          {groupedBlocks.map((group) => {
            if (group.type === 'text' && group.block.text) {
              // Divider placeholder matching left-side text height
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

      {/* Mirrored image overlays on both columns */}
      {expandedImage && (
        <>
          <InlineImageOverlay
            url={expandedImage}
            onClose={() => setExpandedImage(null)}
            containerRef={leftColumnRef}
          />
          <InlineImageOverlay
            url={expandedImage}
            onClose={() => setExpandedImage(null)}
            containerRef={rightColumnRef}
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
