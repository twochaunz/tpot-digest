import { useState, useCallback, useRef, useEffect } from 'react'
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

function TweetRows({ blocks, startIndex, tweets }: { blocks: ScriptBlock[]; startIndex: number; tweets: Tweet[] }) {
  const rows = chunk(blocks, 3)
  return (
    <div style={{ margin: '8px 0' }}>
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

export default function ScriptView({ topicId, script, tweets }: ScriptViewProps) {
  const [model, setModel] = useState<string>(AVAILABLE_MODELS[0].id)
  const [feedback, setFeedback] = useState('')
  const generateScript = useGenerateScript()
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Two-column script layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left: full script (text + tweet cards) */}
        <div
          ref={leftRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 20px',
            borderRight: '1px solid var(--border)',
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
                />
              )
            }
            return null
          })}
        </div>

        {/* Right: tweet cards only, spacers for text blocks */}
        <div
          ref={rightRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 16px',
          }}
        >
          {groupedBlocks.map((group) => {
            if (group.type === 'text' && group.block.text) {
              // Invisible spacer matching left-side text height
              return (
                <div key={group.index} style={{
                  padding: '8px 0',
                  fontSize: '15px',
                  lineHeight: 1.6,
                  visibility: 'hidden',
                }}>
                  {group.block.text}
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
                />
              )
            }
            return null
          })}
        </div>
      </div>

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
