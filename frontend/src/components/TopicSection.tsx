import { useState, useMemo, useCallback } from 'react'
import { useTweets } from '../api/tweets'
import type { Tweet } from '../api/tweets'
import type { Category } from '../api/categories'
import { TweetCard } from './TweetCard'

// --- Data wrapper component (calls hooks at top level) ---

interface TopicSectionWithDataProps {
  topicId: number
  title: string
  color: string | null
  date: string
  search: string
  onUnassign: (tweetIds: number[], topicId: number) => void
}

export function TopicSectionWithData({
  topicId,
  title,
  color,
  date,
  search,
  onUnassign,
}: TopicSectionWithDataProps) {
  const tweetsQuery = useTweets({ date, topic_id: topicId, q: search || undefined })
  const tweets = tweetsQuery.data ?? []

  // Group all tweets under uncategorized for now
  const tweetsByCategory = useMemo(() => {
    const byCat = new Map<number | null, { category: Category | null; tweets: Tweet[] }>()
    if (tweets.length > 0) {
      byCat.set(null, { category: null, tweets })
    }
    return byCat
  }, [tweets])

  return (
    <TopicSection
      topicId={topicId}
      title={title}
      color={color}
      tweetsByCategory={tweetsByCategory}
      onUnassign={onUnassign}
    />
  )
}

// --- Presentational component ---

interface TopicSectionProps {
  topicId: number
  title: string
  color: string | null
  tweetsByCategory: Map<number | null, { category: Category | null; tweets: Tweet[] }>
  onUnassign: (tweetIds: number[], topicId: number) => void
}

function TopicSection({
  topicId,
  title,
  color,
  tweetsByCategory,
  onUnassign,
}: TopicSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [headerHovered, setHeaderHovered] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const totalTweets = Array.from(tweetsByCategory.values()).reduce(
    (sum, g) => sum + g.tweets.length,
    0,
  )

  const accentColor = color || 'var(--accent)'

  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        marginBottom: 16,
        overflow: 'hidden',
        transition: 'border-color 0.15s ease',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 20px',
          background: headerHovered ? 'var(--bg-hover)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          transition: 'background 0.1s ease',
          fontFamily: 'var(--font-body)',
        }}
      >
        {/* Color dot */}
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: accentColor,
            flexShrink: 0,
          }}
        />

        {/* Title */}
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
            flex: 1,
            textAlign: 'left',
          }}
        >
          {title}
        </span>

        {/* Count */}
        <span
          style={{
            fontSize: 12,
            color: 'var(--text-tertiary)',
            fontWeight: 500,
          }}
        >
          {totalTweets} tweet{totalTweets !== 1 ? 's' : ''}
        </span>

        {/* Chevron */}
        <span
          style={{
            fontSize: 14,
            color: 'var(--text-tertiary)',
            transition: 'transform 0.2s ease',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          }}
        >
          &#9662;
        </span>
      </button>

      {/* Body */}
      {!collapsed && (
        <div style={{ padding: '0 20px 16px' }}>
          {totalTweets === 0 && (
            <div
              style={{
                padding: '12px 0',
                fontSize: 12,
                color: 'var(--text-tertiary)',
              }}
            >
              No tweets in this topic yet. Assign tweets from the Unsorted section above.
            </div>
          )}

          {Array.from(tweetsByCategory.entries()).map(([catId, group]) => (
            <div key={catId ?? 'uncategorized'} style={{ marginTop: 12 }}>
              {/* Category label */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                {group.category?.color && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: group.category.color,
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {group.category?.name ?? 'Tweets'}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                  }}
                >
                  ({group.tweets.length})
                </span>
              </div>

              {/* Tweets */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {group.tweets.map((t) => (
                  <TweetCard
                    key={t.id}
                    tweet={t}
                    selected={selected.has(t.id)}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Unassign bar */}
          {selected.size > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginTop: 16,
                paddingTop: 12,
                borderTop: '1px solid var(--border)',
              }}
            >
              <button
                onClick={() => {
                  onUnassign(Array.from(selected), topicId)
                  setSelected(new Set())
                }}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-secondary)',
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  fontFamily: 'var(--font-body)',
                }}
              >
                Unassign {selected.size} tweet{selected.size !== 1 ? 's' : ''}
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
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
