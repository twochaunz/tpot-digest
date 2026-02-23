import { useState, useMemo, useCallback, useRef } from 'react'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { useTweets } from '../api/tweets'
import { TweetCard } from './TweetCard'
import type { Tweet } from '../api/tweets'
import type { Category } from '../api/categories'

// --- Data wrapper component (calls hooks at top level) ---

interface TopicSectionWithDataProps {
  topicId: number
  title: string
  color: string | null
  date: string
  search: string
  onDelete: (topicId: number) => void
  onUpdateTitle: (topicId: number, title: string) => void
  onTweetClick?: (tweet: Tweet) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
  showEngagement?: boolean
}

export function TopicSectionWithData({
  topicId,
  title,
  color,
  date,
  search,
  onDelete,
  onUpdateTitle,
  onTweetClick,
  onContextMenu,
  showEngagement = true,
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
      onDelete={onDelete}
      onUpdateTitle={onUpdateTitle}
      onTweetClick={onTweetClick}
      onContextMenu={onContextMenu}
      showEngagement={showEngagement}
    />
  )
}

// --- Draggable tweet card within a topic ---
function DraggableTweetInTopic({
  tweet,
  topicId,
  onTweetClick,
  onContextMenu,
  showEngagement,
}: {
  tweet: Tweet
  topicId: number
  onTweetClick?: (tweet: Tweet) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
  showEngagement: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `draggable-tweet-${tweet.id}`,
    data: { tweet, sourceTopicId: topicId },
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        opacity: isDragging ? 0.3 : 1,
        transition: 'opacity 0.15s ease',
      }}
    >
      {/* Invisible drag handle overlaid on the card */}
      <div
        {...attributes}
        {...listeners}
        style={{
          touchAction: 'none',
        }}
      >
        <TweetCard
          tweet={tweet}
          selectable={false}
          onTweetClick={onTweetClick}
          onContextMenu={onContextMenu}
          showEngagement={showEngagement}
        />
      </div>
    </div>
  )
}

// --- Presentational component ---

interface TopicSectionProps {
  topicId: number
  title: string
  color: string | null
  tweetsByCategory: Map<number | null, { category: Category | null; tweets: Tweet[] }>
  onDelete: (topicId: number) => void
  onUpdateTitle: (topicId: number, title: string) => void
  onTweetClick?: (tweet: Tweet) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
  showEngagement?: boolean
}

function TopicSection({
  topicId,
  title,
  color,
  tweetsByCategory,
  onDelete,
  onUpdateTitle,
  onTweetClick,
  onContextMenu,
  showEngagement = true,
}: TopicSectionProps) {
  const [headerHovered, setHeaderHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(title)
  const [collapsed, setCollapsed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { setNodeRef, isOver } = useDroppable({
    id: `droppable-topic-${topicId}`,
    data: { topicId },
  })

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== title) {
      onUpdateTitle(topicId, trimmed)
    } else {
      setEditValue(title)
    }
    setEditing(false)
  }, [editValue, title, topicId, onUpdateTitle])

  const totalTweets = Array.from(tweetsByCategory.values()).reduce(
    (sum, g) => sum + g.tweets.length,
    0,
  )

  const accentColor = color || 'var(--accent)'

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-raised)',
        border: isOver ? `2px solid ${accentColor}` : '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        transition: 'border 0.15s ease',
      }}
    >
      {/* Header */}
      <div
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed((v) => !v)}
      >
        {/* Collapse arrow */}
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-tertiary)',
            transition: 'transform 0.15s ease',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        >
          &#9660;
        </span>

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
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') {
                setEditValue(title)
                setEditing(false)
              }
            }}
            onBlur={commitEdit}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            style={{
              flex: 1,
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              background: 'var(--bg-base)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 6px',
              outline: 'none',
              fontFamily: 'var(--font-body)',
              minWidth: 0,
            }}
          />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation()
              setEditValue(title)
              setEditing(true)
            }}
            title={title}
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'text',
            }}
          >
            {title}
          </span>
        )}

        {/* Count */}
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            fontWeight: 500,
          }}
        >
          {totalTweets}
        </span>

        {/* Delete button - shows on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm(`Delete topic "${title}"? Tweets will be unassigned.`)) {
              onDelete(topicId)
            }
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontSize: 13,
            cursor: 'pointer',
            padding: '2px 4px',
            opacity: headerHovered ? 1 : 0,
            transition: 'opacity 0.15s ease',
            lineHeight: 1,
          }}
          title="Delete topic"
        >
          &#128465;
        </button>
      </div>

      {/* Body (droppable) - collapsible */}
      {!collapsed && (
        <div ref={setNodeRef} style={{ padding: '12px 16px', minHeight: 60 }}>
          {totalTweets === 0 && (
            <div
              style={{
                padding: '20px 0',
                fontSize: 12,
                color: isOver ? 'var(--accent)' : 'var(--text-tertiary)',
                textAlign: 'center',
                transition: 'color 0.15s ease',
              }}
            >
              {isOver ? 'Drop here' : 'No tweets yet'}
            </div>
          )}

          {Array.from(tweetsByCategory.entries()).map(([catId, group]) => (
            <div key={catId ?? 'uncategorized'} style={{ marginBottom: 8 }}>
              {/* Category label if applicable */}
              {group.category && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 6,
                    padding: '0 2px',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: group.category.color || 'var(--text-tertiary)',
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {group.category.name}
                  </span>
                </div>
              )}

              {/* Tweet cards - vertical feed, max-width 600px */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 600 }}>
                {group.tweets.map((t) => (
                  <DraggableTweetInTopic
                    key={t.id}
                    tweet={t}
                    topicId={topicId}
                    onTweetClick={onTweetClick}
                    onContextMenu={onContextMenu}
                    showEngagement={showEngagement}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
