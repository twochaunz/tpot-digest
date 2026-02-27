import type { TopicBundle } from '../api/dayBundle'
import { type ScriptBlock, type TopicScript, useTopicScript } from '../api/scripts'
import type { Tweet } from '../api/tweets'
import { ScriptTextBlock } from './DayScriptView'
import { TweetCard } from './TweetCard'

/* ---- Editable block (text or tweet) with left gutter ---- */
function EditableBlock({ block, blockIndex, script, topicId, tweets }: {
  block: ScriptBlock
  blockIndex: number
  script: TopicScript
  topicId: number
  tweets: Tweet[]
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      {/* 32px left gutter placeholder — will get controls in Task 3 */}
      <div style={{ width: 32, flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {block.type === 'text' && block.text && (
          <ScriptTextBlock
            text={block.text}
            blockIndex={blockIndex}
            script={script}
            topicId={topicId}
          />
        )}
        {block.type === 'tweet' && block.tweet_id && (() => {
          const tweet = tweets.find(t => t.tweet_id === block.tweet_id)
          if (!tweet) return null
          return (
            <div data-tweet-id={block.tweet_id} style={{ margin: '8px 0' }}>
              <TweetCard tweet={tweet} selectable={false} />
            </div>
          )
        })()}
      </div>
    </div>
  )
}

/* ---- Per-topic edit section ---- */
function TopicEditSection({ topicId, tweets }: {
  topicId: number
  tweets: Tweet[]
}) {
  const { data: script, isLoading } = useTopicScript(topicId)

  /* Loading state */
  if (isLoading) {
    return (
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
    )
  }

  /* Empty state */
  if (!script) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
        No script generated yet.
      </div>
    )
  }

  /* Render blocks */
  return (
    <div style={{ marginBottom: 8 }}>
      {script.content.map((block, idx) => (
        <EditableBlock
          key={`${topicId}-block-${idx}`}
          block={block}
          blockIndex={idx}
          script={script}
          topicId={topicId}
          tweets={tweets}
        />
      ))}
    </div>
  )
}

/* ---- Main ScriptEditView ---- */
interface ScriptEditViewProps {
  topics: TopicBundle[]
}

export function ScriptEditView({ topics }: ScriptEditViewProps) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {topics.map((topic, idx) => (
        <div key={topic.id}>
          {/* Topic header — colored dot + title (same style as ScriptMirrorView) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 0 8px', borderBottom: '2px solid var(--border)', marginBottom: 12,
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: topic.color || 'var(--text-tertiary)', flexShrink: 0,
            }} />
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>
              {topic.title}
            </span>
          </div>

          <TopicEditSection topicId={topic.id} tweets={topic.tweets} />

          {/* Divider between topics */}
          {idx < topics.length - 1 && (
            <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
          )}
        </div>
      ))}

      {topics.length === 0 && (
        <div style={{
          padding: '40px 0',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 14,
        }}>
          No topics selected. Select topics in the Topics tab.
        </div>
      )}
    </div>
  )
}
