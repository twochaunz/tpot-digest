import { useState, useCallback } from 'react'
import type { Tweet } from '../api/tweets'
import type { Topic } from '../api/topics'
import type { Category } from '../api/categories'
import { TweetCard } from './TweetCard'
import { AssignDropdown } from './AssignDropdown'

interface UnsortedSectionProps {
  tweets: Tweet[]
  topics: Topic[]
  categories: Category[]
  onAssign: (tweetIds: number[], topicId: number, categoryId?: number) => void
  onTweetClick?: (tweet: Tweet) => void
}

export function UnsortedSection({ tweets, topics, categories, onAssign, onTweetClick }: UnsortedSectionProps) {
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

      {/* Tweet grid */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: selected.size > 0 ? 16 : 0,
        }}
      >
        {tweets.map((t) => (
          <TweetCard
            key={t.id}
            tweet={t}
            selected={selected.has(t.id)}
            onToggle={toggle}
            onTweetClick={onTweetClick}
          />
        ))}
      </div>

      {/* Assign bar */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AssignDropdown
            topics={topics}
            categories={categories}
            onAssign={handleAssign}
          />
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
