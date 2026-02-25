import { useDroppable, useDraggable } from '@dnd-kit/core'
import { EmbeddedTweet } from './EmbeddedTweet'
import type { Tweet } from '../api/tweets'

interface UnsortedSectionProps {
  tweets: Tweet[]
  onDelete: (tweetId: number) => void
  onTweetClick?: (tweet: Tweet) => void
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

function DraggableFeedTweetCard({
  tweet,
  onDelete,
  onTweetClick,
  onContextMenu,
}: {
  tweet: Tweet
  onDelete: (id: number) => void
  onTweetClick?: (tweet: Tweet) => void
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
      <EmbeddedTweet
        tweet={tweet}
        onTweetClick={onTweetClick}
        onContextMenu={onContextMenu}
        onDelete={onDelete}
      />
    </div>
  )
}

export function UnsortedSection({
  tweets,
  onDelete,
  onTweetClick,
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
          <DraggableFeedTweetCard
            key={t.id}
            tweet={t}
            onDelete={onDelete}
            onTweetClick={onTweetClick}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </div>
  )
}
