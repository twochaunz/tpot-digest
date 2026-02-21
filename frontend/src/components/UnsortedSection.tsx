import { useState, useCallback } from 'react'
import type { Tweet } from '../api/tweets'
import type { Topic } from '../api/topics'
import type { Category } from '../api/categories'
import { AssignDropdown } from './AssignDropdown'

interface UnsortedSectionProps {
  tweets: Tweet[]
  topics: Topic[]
  categories: Category[]
  onAssign: (tweetIds: number[], topicId: number, categoryId?: number) => void
  onDelete: (tweetId: number) => void
  onTweetClick?: (tweet: Tweet) => void
  onCreateCategory?: (name: string, color: string) => void
  onDeleteCategory?: (id: number) => void
}

function screenshotUrl(path: string | null): string | null {
  if (!path) return null
  return `/api/screenshots/${path}`
}

function FeedTweetCard({
  tweet,
  selected,
  onToggle,
  onDelete,
  onTweetClick,
}: {
  tweet: Tweet
  selected: boolean
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  onTweetClick?: (tweet: Tweet) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)

  const ssUrl = screenshotUrl(tweet.screenshot_path)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onTweetClick?.(tweet)}
      style={{
        display: 'flex',
        gap: 12,
        padding: '10px 12px',
        background: hovered ? 'var(--bg-hover)' : 'var(--bg-raised)',
        border: selected
          ? '1.5px solid var(--accent)'
          : `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        alignItems: 'center',
      }}
    >
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

      {/* Right: checkbox + delete */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
        }}
      >
        {/* Checkbox */}
        <div
          onClick={(e) => {
            e.stopPropagation()
            onToggle(tweet.id)
          }}
          style={{
            width: 18,
            height: 18,
            borderRadius: 'var(--radius-sm)',
            border: selected ? 'none' : '1.5px solid var(--border-strong)',
            background: selected ? 'var(--accent)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: '#fff',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
        >
          {selected && '\u2713'}
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
    </div>
  )
}

export function UnsortedSection({
  tweets,
  topics,
  categories,
  onAssign,
  onDelete,
  onTweetClick,
  onCreateCategory,
  onDeleteCategory,
}: UnsortedSectionProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleAssign = useCallback(
    (topicId: number, categoryId?: number) => {
      if (selected.size === 0) return
      onAssign(Array.from(selected), topicId, categoryId)
      setSelected(new Set())
    },
    [selected, onAssign],
  )

  const handleDeleteSelected = useCallback(() => {
    for (const id of selected) {
      onDelete(id)
    }
    setSelected(new Set())
  }, [selected, onDelete])

  if (tweets.length === 0) return null

  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        marginBottom: 24,
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

        {selected.size > 0 && (
          <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>
            {selected.size} selected
          </span>
        )}
      </div>

      {/* Tweet list (scrollable) */}
      <div
        style={{
          maxHeight: 400,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          marginBottom: selected.size > 0 ? 16 : 0,
        }}
      >
        {tweets.map((t) => (
          <FeedTweetCard
            key={t.id}
            tweet={t}
            selected={selected.has(t.id)}
            onToggle={toggle}
            onDelete={onDelete}
            onTweetClick={onTweetClick}
          />
        ))}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AssignDropdown
            topics={topics}
            categories={categories}
            onAssign={handleAssign}
            onCreateCategory={onCreateCategory}
            onDeleteCategory={onDeleteCategory}
          />
          <button
            onClick={handleDeleteSelected}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--danger, #e53e3e)',
              fontSize: 12,
              cursor: 'pointer',
              padding: '4px 8px',
              fontWeight: 500,
              fontFamily: 'var(--font-body)',
            }}
          >
            Delete selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-tertiary)',
              fontSize: 12,
              cursor: 'pointer',
              padding: '4px 8px',
              fontFamily: 'var(--font-body)',
            }}
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  )
}
