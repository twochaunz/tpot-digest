import { memo } from 'react'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { TweetCard } from './TweetCard'
import { useAcceptSuggestion, useDismissSuggestion } from '../api/dayBundle'
import { getCategoryDef } from '../constants/categories'
import type { Tweet } from '../api/tweets'

interface UnsortedSectionProps {
  tweets: Tweet[]
  onDelete: (tweetId: number) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
}

// Grip handle SVG (6 dots, 2x3)
function GripHandle() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}>
      <circle cx="3" cy="3" r="1.5" />
      <circle cx="7" cy="3" r="1.5" />
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="7" cy="8" r="1.5" />
      <circle cx="3" cy="13" r="1.5" />
      <circle cx="7" cy="13" r="1.5" />
    </svg>
  )
}

function SuggestionBadge({ tweet }: { tweet: Tweet }) {
  const accept = useAcceptSuggestion()
  const dismiss = useDismissSuggestion()

  if (!tweet.ai_topic_title && !tweet.ai_new_topic_title) return null

  const isNewTopic = !tweet.ai_topic_id

  const catDef = tweet.ai_category ? getCategoryDef(tweet.ai_category) : null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 10px',
      marginTop: 4,
    }}>
      <button
        onClick={(e) => { e.stopPropagation(); accept.mutate(tweet.id) }}
        disabled={accept.isPending}
        style={{
          background: 'var(--accent-muted)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--accent)',
          cursor: accept.isPending ? 'wait' : 'pointer',
          fontSize: 12,
          padding: '4px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-body)',
        }}
      >
        <span style={{ fontSize: 11 }}>{isNewTopic ? '+' : '→'}</span>
        <span>{tweet.ai_topic_title || tweet.ai_new_topic_title}</span>
        {catDef && (
          <span style={{
            fontSize: 10,
            color: catDef.color,
            fontWeight: 600,
          }}>
            · {catDef.label}
          </span>
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); dismiss.mutate(tweet.id) }}
        disabled={dismiss.isPending}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          fontSize: 14,
          padding: '2px 6px',
          lineHeight: 1,
        }}
        title="Dismiss suggestion"
      >
        ✕
      </button>
    </div>
  )
}

const DraggableFeedTweetCard = memo(function DraggableFeedTweetCard({
  tweet,
  onDelete,
  onContextMenu,
}: {
  tweet: Tweet
  onDelete: (id: number) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `draggable-tweet-${tweet.id}`,
    data: { tweet, sourceTopicId: null },
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        opacity: isDragging ? 0.3 : 1,
        transition: 'opacity 0.15s ease',
      }}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        style={{
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          padding: '16px 2px',
          flexShrink: 0,
          touchAction: 'none',
        }}
      >
        <GripHandle />
      </div>

      {/* TweetCard */}
      <TweetCard
        tweet={tweet}
        selectable={false}
        onContextMenu={onContextMenu}
        onDelete={onDelete}
      />
    </div>
  )
})

export const UnsortedSection = memo(function UnsortedSection({
  tweets,
  onDelete,
  onContextMenu,
}: UnsortedSectionProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'droppable-unsorted',
  })

  if (tweets.length === 0) return null

  return (
    <div
      id="toc-unsorted"
      style={{
        background: 'var(--bg-raised)',
        border: isOver ? '2px dashed var(--accent)' : '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        marginBottom: 24,
        transition: 'all 0.15s ease',
        backgroundColor: isOver ? 'color-mix(in srgb, var(--accent) 6%, var(--bg-raised))' : 'var(--bg-raised)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Unsorted
          </h2>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-tertiary)',
              background: 'var(--bg-elevated)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {tweets.length}
          </span>
        </div>
      </div>

      {/* Tweet feed (vertical) */}
      <div
        ref={setNodeRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {tweets.map((t) => (
          <div key={t.id}>
            <DraggableFeedTweetCard
              tweet={t}
              onDelete={onDelete}
              onContextMenu={onContextMenu}
            />
            <SuggestionBadge tweet={t} />
          </div>
        ))}
      </div>
    </div>
  )
})
