import { useState } from 'react'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import type { Tweet } from '../api/tweets'

interface UnsortedSectionProps {
  tweets: Tweet[]
  onDelete: (tweetId: number) => void
  onTweetClick?: (tweet: Tweet) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
  showEngagement?: boolean
}

function screenshotUrl(path: string | null): string | null {
  if (!path) return null
  return `/api/screenshots/${path}`
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
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `draggable-tweet-${tweet.id}`,
    data: { tweet, sourceTopicId: null },
  })

  const ssUrl = screenshotUrl(tweet.screenshot_path)

  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onTweetClick?.(tweet)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu?.(e, tweet)
      }}
      style={{
        display: 'flex',
        gap: 8,
        padding: '10px 12px',
        background: hovered ? 'var(--bg-hover)' : 'var(--bg-raised)',
        border: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        alignItems: 'center',
        opacity: isDragging ? 0.3 : 1,
      }}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        style={{
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          padding: '4px 2px',
          flexShrink: 0,
          touchAction: 'none',
        }}
      >
        <GripHandle />
      </div>

      {/* Screenshot thumbnail */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          flexShrink: 0,
          background: 'var(--bg-elevated)',
        }}
      >
        {ssUrl && !imgError ? (
          <img
            src={ssUrl}
            alt={`Tweet by ${tweet.author_handle}`}
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
            }}
          >
            no img
          </div>
        )}
      </div>

      {/* Center: handle + text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginBottom: 2,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            @{tweet.author_handle}
          </span>
          {tweet.url && (
            <a
              href={tweet.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: 'var(--text-tertiary)',
                fontSize: 11,
                lineHeight: 1,
                flexShrink: 0,
                textDecoration: 'none',
              }}
              title="Open on X"
            >
              &#8599;
            </a>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-tertiary)',
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {tweet.text}
        </div>
      </div>

      {/* Delete button (hover only) */}
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(tweet.id)
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontSize: 16,
            cursor: 'pointer',
            padding: '2px 4px',
            lineHeight: 1,
            flexShrink: 0,
          }}
          title="Remove tweet"
        >
          &times;
        </button>
      )}
    </div>
  )
}

export function UnsortedSection({
  tweets,
  onDelete,
  onTweetClick,
  onContextMenu,
  showEngagement: _showEngagement,
}: UnsortedSectionProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'droppable-unsorted',
  })

  if (tweets.length === 0) return null

  return (
    <div
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

      {/* Tweet list (scrollable) */}
      <div
        ref={setNodeRef}
        style={{
          maxHeight: 400,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
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
