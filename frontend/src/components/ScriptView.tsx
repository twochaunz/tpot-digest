import { useState, useCallback } from 'react'
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


export default function ScriptView({ topicId, script, tweets }: ScriptViewProps) {
  const [model, setModel] = useState<string>(AVAILABLE_MODELS[0].id)
  const [feedback, setFeedback] = useState('')
  const generateScript = useGenerateScript()

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

  // Group consecutive tweet blocks together for side-by-side rendering
  const groupedBlocks: Array<{ type: 'text'; index: number; block: ScriptBlock } | { type: 'tweet_group'; startIndex: number; blocks: ScriptBlock[] }> = []
  for (let i = 0; i < script.content.length; i++) {
    const block = script.content[i]
    if (block.type === 'tweet' && block.tweet_id) {
      const tweetBlocks: ScriptBlock[] = [block]
      while (i + 1 < script.content.length && script.content[i + 1].type === 'tweet' && script.content[i + 1].tweet_id) {
        i++
        tweetBlocks.push(script.content[i])
      }
      groupedBlocks.push({ type: 'tweet_group', startIndex: i - tweetBlocks.length + 1, blocks: tweetBlocks })
    } else {
      groupedBlocks.push({ type: 'text', index: i, block })
    }
  }

  // Render script blocks
  return (
    <div>
      <div style={{ padding: '8px 16px' }}>
        {groupedBlocks.map((group) => {
          if (group.type === 'text' && group.block.text) {
            return <ScriptTextBlock key={group.index} text={group.block.text} blockIndex={group.index} script={script} topicId={topicId} />
          }
          if (group.type === 'tweet_group') {
            const isSingle = group.blocks.length === 1
            return (
              <div key={`tg-${group.startIndex}`} style={{
                display: isSingle ? 'block' : 'flex',
                gap: isSingle ? 0 : 12,
                margin: '12px 0',
              }}>
                {group.blocks.map((b, j) => {
                  const tweet = tweets.find(t => t.tweet_id === b.tweet_id)
                  if (!tweet) return null
                  return (
                    <div key={`${group.startIndex}-${j}`} style={{
                      flex: isSingle ? undefined : 1,
                      maxWidth: isSingle ? 550 : undefined,
                      minWidth: 0,
                    }}>
                      <TweetCard tweet={tweet} selectable={false} />
                    </div>
                  )
                })}
              </div>
            )
          }
          return null
        })}
      </div>

      {/* Bottom bar: version info + feedback + regenerate */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
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
