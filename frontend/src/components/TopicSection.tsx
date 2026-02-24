import { useState, useMemo, useCallback, useRef } from 'react'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { useTweets, useFetchGrokContext } from '../api/tweets'
import { EmbeddedTweet } from './EmbeddedTweet'
import type { Tweet } from '../api/tweets'
import type { Category } from '../api/categories'

function GrokRefreshButton({ tweetId, label }: { tweetId: number; label?: string }) {
  const fetchGrok = useFetchGrokContext()

  return (
    <button
      onClick={(e) => { e.stopPropagation(); fetchGrok.mutate(tweetId) }}
      disabled={fetchGrok.isPending}
      style={{
        background: 'none',
        border: 'none',
        color: 'var(--text-tertiary)',
        cursor: fetchGrok.isPending ? 'wait' : 'pointer',
        fontSize: 12,
        padding: '2px 4px',
        opacity: fetchGrok.isPending ? 0.5 : 0.7,
      }}
      title="Refresh Grok context"
    >
      {fetchGrok.isPending ? 'Fetching...' : label ?? '\u21BB'}
    </button>
  )
}

// --- Data wrapper component (calls hooks at top level) ---

interface TopicSectionWithDataProps {
  topicId: number
  title: string
  color: string | null
  date: string
  search: string
  ogTweetId: number | null
  onDelete: (topicId: number) => void
  onUpdateTitle: (topicId: number, title: string) => void
  onSetOg: (topicId: number, tweetId: number | null) => void
  onTweetClick?: (tweet: Tweet) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet, topicId?: number, ogTweetId?: number | null) => void
}

export function TopicSectionWithData({
  topicId,
  title,
  color,
  date,
  search,
  ogTweetId,
  onDelete,
  onUpdateTitle,
  onSetOg,
  onTweetClick,
  onContextMenu,
}: TopicSectionWithDataProps) {
  const tweetsQuery = useTweets({ date, topic_id: topicId, q: search || undefined })
  const tweets = tweetsQuery.data ?? []

  // Separate OG tweet from the rest
  const ogTweet = ogTweetId ? tweets.find(t => t.id === ogTweetId) ?? null : null
  const remainingTweets = ogTweetId ? tweets.filter(t => t.id !== ogTweetId) : tweets

  const tweetsByCategory = useMemo(() => {
    const byCat = new Map<number | null, { category: Category | null; tweets: Tweet[] }>()
    if (remainingTweets.length > 0) {
      byCat.set(null, { category: null, tweets: remainingTweets })
    }
    return byCat
  }, [remainingTweets])

  return (
    <TopicSection
      topicId={topicId}
      title={title}
      color={color}
      tweetsByCategory={tweetsByCategory}
      ogTweet={ogTweet}
      ogTweetId={ogTweetId}
      onDelete={onDelete}
      onUpdateTitle={onUpdateTitle}
      onSetOg={onSetOg}
      onTweetClick={onTweetClick}
      onContextMenu={(e, tweet) => onContextMenu?.(e, tweet, topicId, ogTweetId)}
    />
  )
}

// --- Draggable tweet card within a topic ---
function DraggableTweetInTopic({
  tweet,
  topicId,
  ogTweetId,
  onSetOg,
  onTweetClick,
  onContextMenu,
}: {
  tweet: Tweet
  topicId: number
  ogTweetId: number | null
  onSetOg: (topicId: number, tweetId: number | null) => void
  onTweetClick?: (tweet: Tweet) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `draggable-tweet-${tweet.id}`,
    data: { tweet, sourceTopicId: topicId },
  })
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        opacity: isDragging ? 0.3 : 1,
        transition: 'opacity 0.15s ease',
        position: 'relative',
      }}
    >
      {/* OG star toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onSetOg(topicId, tweet.id === ogTweetId ? null : tweet.id)
        }}
        title={tweet.id === ogTweetId ? 'Remove OG' : 'Set as OG Post'}
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          background: tweet.id === ogTweetId ? '#F59E0B' : 'rgba(0,0,0,0.5)',
          border: 'none',
          borderRadius: '50%',
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontSize: 12,
          color: tweet.id === ogTweetId ? '#000' : '#888',
          opacity: isHovered || tweet.id === ogTweetId ? 1 : 0,
          transition: 'opacity 0.15s',
          zIndex: 2,
        }}
      >
        &#9733;
      </button>

      {/* Invisible drag handle overlaid on the card */}
      <div
        {...attributes}
        {...listeners}
        style={{
          touchAction: 'none',
        }}
      >
        <EmbeddedTweet
          tweet={tweet}
          onTweetClick={onTweetClick}
          onContextMenu={onContextMenu}
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
  ogTweet: Tweet | null
  ogTweetId: number | null
  onDelete: (topicId: number) => void
  onUpdateTitle: (topicId: number, title: string) => void
  onSetOg: (topicId: number, tweetId: number | null) => void
  onTweetClick?: (tweet: Tweet) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
}

function TopicSection({
  topicId,
  title,
  color,
  tweetsByCategory,
  ogTweet,
  ogTweetId,
  onDelete,
  onUpdateTitle,
  onSetOg,
  onTweetClick,
  onContextMenu,
}: TopicSectionProps) {
  const [headerHovered, setHeaderHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(title)
  const [collapsed, setCollapsed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const sectionRef = useRef<HTMLDivElement>(null)

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
  ) + (ogTweet ? 1 : 0)

  const accentColor = color || 'var(--accent)'

  return (
    <div
      ref={sectionRef}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-raised)',
        border: isOver ? `2px solid ${accentColor}` : '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        transition: 'border 0.15s ease',
        scrollSnapAlign: 'start' as const,
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
          padding: '14px 20px',
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
          cursor: 'pointer',
          position: 'sticky' as const,
          top: 0,
          zIndex: 5,
          background: 'var(--bg-raised)',
        }}
        onClick={() => {
          setCollapsed((v) => {
            const next = !v
            if (!next && sectionRef.current) {
              setTimeout(() => {
                sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }, 50)
            }
            return next
          })
        }}
      >
        {/* Collapse arrow */}
        <span
          style={{
            fontSize: 12,
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
              fontSize: 17,
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
              fontSize: 17,
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
            fontSize: 13,
            fontWeight: 700,
            color: '#fff',
            background: accentColor,
            padding: '2px 10px',
            borderRadius: 12,
            minWidth: 28,
            textAlign: 'center',
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

          {/* OG Tweet - pinned at top */}
          {ogTweet && (
            <div style={{
              borderLeft: '3px solid #F59E0B',
              borderRadius: 'var(--radius-lg)',
              marginBottom: 12,
              position: 'relative',
            }}>
              {/* OG Badge */}
              <div style={{
                position: 'absolute',
                top: 12,
                right: 12,
                background: '#F59E0B',
                color: '#000',
                fontSize: 13,
                fontWeight: 700,
                padding: '4px 10px',
                borderRadius: 6,
                zIndex: 2,
                letterSpacing: '0.05em',
              }}>
                OG
              </div>

              {/* Tweet card */}
              <div
                onClick={() => onTweetClick?.(ogTweet)}
                onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, ogTweet) }}
                style={{ cursor: 'pointer' }}
              >
                <EmbeddedTweet tweet={ogTweet} />
              </div>

              {/* Grok Context section */}
              {ogTweet.grok_context && (
                <>
                  <div style={{ height: 1, background: 'var(--border)', margin: '0 12px' }} />
                  <div style={{
                    padding: '10px 14px',
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                    background: 'var(--bg-subtle, rgba(0,0,0,0.1))',
                    borderBottomLeftRadius: 'var(--radius-lg)',
                    borderBottomRightRadius: 'var(--radius-lg)',
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      Grok Context
                      <GrokRefreshButton tweetId={ogTweet.id} />
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{ogTweet.grok_context}</div>
                  </div>
                </>
              )}

              {/* No context yet - show fetch button */}
              {!ogTweet.grok_context && (
                <>
                  <div style={{ height: 1, background: 'var(--border)', margin: '0 12px' }} />
                  <div style={{
                    padding: '10px 14px',
                    fontSize: 13,
                    color: 'var(--text-tertiary)',
                    background: 'var(--bg-subtle, rgba(0,0,0,0.1))',
                    borderBottomLeftRadius: 'var(--radius-lg)',
                    borderBottomRightRadius: 'var(--radius-lg)',
                  }}>
                    <GrokRefreshButton tweetId={ogTweet.id} label="Fetch Grok Context" />
                  </div>
                </>
              )}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {group.tweets.map((t) => (
                  <DraggableTweetInTopic
                    key={t.id}
                    tweet={t}
                    topicId={topicId}
                    ogTweetId={ogTweetId}
                    onSetOg={onSetOg}
                    onTweetClick={onTweetClick}
                    onContextMenu={onContextMenu}
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
