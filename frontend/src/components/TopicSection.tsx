import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTweets, useFetchGrokContext } from '../api/tweets'
import { TweetCard } from './TweetCard'
import type { Tweet } from '../api/tweets'
import { getCategoryDef } from '../constants/categories'
import { isKekTopic } from '../utils/topics'
import { useAuth } from '../contexts/AuthContext'

function GrokContextSection({ tweetId, context }: { tweetId: number; context: string }) {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', width: '100%' }}>
      <div style={{ marginTop: 10 }}>
        <div style={{ height: 1, background: 'var(--border)' }} />
      </div>
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          padding: '10px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.5)',
            transition: 'transform 0.15s ease',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          }}>&#9660;</span>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.5)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Context
          </span>
        </div>
        <GrokRefreshButton tweetId={tweetId} />
      </div>
      {!collapsed && (
        <div style={{
          padding: '0 12px 12px',
          fontSize: 14,
          color: 'var(--text-primary)',
          lineHeight: 1.6,
        }}
          className="grok-context-md"
        >
          <Markdown remarkPlugins={[remarkGfm]}>{context}</Markdown>
        </div>
      )}
    </div>
  )
}

function GrokRefreshButton({ tweetId, label }: { tweetId: number; label?: string }) {
  const { isAdmin } = useAuth()
  const fetchGrok = useFetchGrokContext()

  if (!isAdmin) return null

  return (
    <button
      onClick={(e) => { e.stopPropagation(); fetchGrok.mutate({ tweetId, force: true }) }}
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
      title="Refresh context"
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
  onUpdateTitle: (topicId: number, title: string) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet, topicId?: number, ogTweetId?: number | null) => void
  onTopicContextMenu?: (e: React.MouseEvent, topicId: number, title: string) => void
  tweets?: Tweet[]
  isAdmin?: boolean
}

export function TopicSectionWithData({
  topicId,
  title,
  color,
  date,
  search,
  ogTweetId,
  onUpdateTitle,
  onContextMenu,
  onTopicContextMenu,
  tweets: propTweets,
  isAdmin,
}: TopicSectionWithDataProps) {
  const tweetsQuery = useTweets({ date, topic_id: topicId, q: search || undefined }, { enabled: !propTweets })
  const tweets = propTweets ?? tweetsQuery.data ?? []

  // Separate OG tweet from the rest
  const ogTweet = ogTweetId ? tweets.find(t => t.id === ogTweetId) ?? null : null
  const remainingTweets = ogTweetId ? tweets.filter(t => t.id !== ogTweetId) : tweets

  const tweetsByCategory = useMemo(() => {
    const byCat = new Map<string | null, { category: { name: string; color: string; sortOrder: number } | null; tweets: Tweet[] }>()
    for (const tweet of remainingTweets) {
      const catKey = tweet.category ?? null
      if (!byCat.has(catKey)) {
        const def = catKey ? getCategoryDef(catKey) : null
        byCat.set(catKey, {
          category: def ? { name: def.label, color: def.color, sortOrder: def.sortOrder } : null,
          tweets: [],
        })
      }
      byCat.get(catKey)!.tweets.push(tweet)
    }
    // Sort by narrative order: categorized groups by sortOrder, uncategorized (null) last
    const sorted = new Map(
      Array.from(byCat.entries()).sort(([aKey, aGroup], [bKey, bGroup]) => {
        if (aKey === null) return 1
        if (bKey === null) return -1
        return (aGroup.category?.sortOrder ?? 999) - (bGroup.category?.sortOrder ?? 999)
      })
    )
    return sorted
  }, [remainingTweets])

  return (
    <TopicSection
      topicId={topicId}
      title={title}
      color={color}
      tweetsByCategory={tweetsByCategory}
      ogTweet={ogTweet}
      onUpdateTitle={onUpdateTitle}
      onContextMenu={(e, tweet) => onContextMenu?.(e, tweet, topicId, ogTweetId)}
      onTopicContextMenu={onTopicContextMenu}
      isAdmin={isAdmin}
    />
  )
}

// --- Draggable tweet card within a topic ---
const DraggableTweetInTopic = memo(function DraggableTweetInTopic({
  tweet,
  topicId,
  onContextMenu,
  isAdmin = true,
}: {
  tweet: Tweet
  topicId: number
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
  isAdmin?: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `draggable-tweet-${tweet.id}`,
    data: { tweet, sourceTopicId: topicId },
    disabled: !isAdmin,
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
        {...(isAdmin ? { ...attributes, ...listeners } : {})}
        style={{
          touchAction: isAdmin ? 'none' : undefined,
        }}
      >
        <TweetCard
          tweet={tweet}
          selectable={false}
          onContextMenu={onContextMenu}
        />
      </div>
    </div>
  )
})

// --- Category nav label with cascade on hover ---

function CategoryNavLabel({
  allCategories,
  currentCategoryKey,
  topicId,
  onHoverChange,
}: {
  allCategories: Array<{ key: string | null; name: string; color: string }>
  currentCategoryKey: string | null
  topicId: number
  onHoverChange?: (hovered: boolean) => void
}) {
  const [isHovered, setIsHovered] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const foundIndex = allCategories.findIndex(c => c.key === currentCategoryKey)
  if (foundIndex < 0) return null
  const currentIndex = foundIndex
  const displayed = allCategories[currentIndex]

  useEffect(() => {
    return () => { if (leaveTimer.current) clearTimeout(leaveTimer.current) }
  }, [])

  const ITEM_H = 28
  const GAP = 3
  const STEP = ITEM_H + GAP

  const setHover = (val: boolean) => {
    setIsHovered(val)
    onHoverChange?.(val)
  }

  const handleEnter = () => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
    setHover(true)
  }

  const handleLeave = () => {
    leaveTimer.current = setTimeout(() => setHover(false), 150)
  }

  const handleNav = (catKey: string | null) => {
    const feedPanel = document.querySelector<HTMLElement>('[data-active-feed="true"]')
    if (!feedPanel) return
    const el = feedPanel.querySelector<HTMLElement>(`#toc-cat-${topicId}-${catKey ?? 'uncategorized'}`)
    if (!el) return
    const panelTop = feedPanel.getBoundingClientRect().top
    const topic = el.closest<HTMLElement>('[id^="toc-topic-"]')
    const header = topic?.querySelector<HTMLElement>(':scope > div')
    const off = header ? header.offsetHeight : 0
    feedPanel.scrollTo({
      top: feedPanel.scrollTop + el.getBoundingClientRect().top - panelTop - off,
      behavior: 'smooth',
    })
    setHover(false)
  }

  // Single category - static label
  if (allCategories.length <= 1) {
    return (
      <div style={{
        display: 'inline-block',
        background: displayed.color,
        color: '#fff',
        fontSize: 15,
        fontWeight: 700,
        padding: '4px 10px',
        borderRadius: 'var(--radius-sm)',
        letterSpacing: '0.03em',
        marginLeft: -14,
        transform: 'translateY(4px)',
      }}>
        {displayed.name}
      </div>
    )
  }

  return (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        position: 'relative',
        display: 'inline-block',
        marginLeft: -14,
        transform: 'translateY(4px)',
        pointerEvents: 'auto',
      }}
    >
      {/* Current category label */}
      {!isHovered && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: displayed.color,
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            letterSpacing: '0.03em',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {displayed.name}
          <span style={{ fontSize: 10, opacity: 0.6 }}>&#9662;</span>
        </div>
      )}

      {/* Cascading menu */}
      {isHovered && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: -(currentIndex * STEP),
          display: 'flex',
          flexDirection: 'column',
          gap: GAP,
          zIndex: 20,
        }}>
          {allCategories.map((cat, idx) => {
            const dist = Math.abs(idx - currentIndex)
            const fromY = (currentIndex - idx) * STEP
            const isCurrent = idx === currentIndex
            return (
              <div
                key={cat.key ?? 'uncat'}
                onClick={(e) => { e.stopPropagation(); handleNav(cat.key) }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: cat.color,
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  letterSpacing: '0.03em',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  height: ITEM_H,
                  boxSizing: 'border-box',
                  '--cascade-from': `${fromY}px`,
                  animation: `catCascadeIn 0.2s ease ${dist * 0.05}s both`,
                } as React.CSSProperties}
              >
                {isCurrent && <span style={{ fontSize: 8 }}>&#9679;</span>}
                {cat.name}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Presentational component ---

interface TopicSectionProps {
  topicId: number
  title: string
  color: string | null
  tweetsByCategory: Map<string | null, { category: { name: string; color: string; sortOrder: number } | null; tweets: Tweet[] }>
  ogTweet: Tweet | null
  onUpdateTitle: (topicId: number, title: string) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
  onTopicContextMenu?: (e: React.MouseEvent, topicId: number, title: string) => void
  isAdmin?: boolean
}

function TopicSection({
  topicId,
  title,
  color,
  tweetsByCategory,
  ogTweet,
  onUpdateTitle,
  onContextMenu,
  onTopicContextMenu,
  isAdmin = true,
}: TopicSectionProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(title)
  const [collapsed, setCollapsed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const sectionRef = useRef<HTMLDivElement>(null)
  const [labelHovered, setLabelHovered] = useState(false)

  const allCategoryList = useMemo(() => {
    const list: Array<{ key: string | null; name: string; color: string }> = []
    const seen = new Set<string | null>()
    if (ogTweet) {
      list.push({ key: 'og', name: 'og', color: '#F59E0B' })
      seen.add('og')
    }
    for (const [key, group] of tweetsByCategory.entries()) {
      if (seen.has(key)) continue
      seen.add(key)
      list.push({
        key,
        name: group.category?.name || 'Uncategorized',
        color: group.category?.color || '#6B7280',
      })
    }
    return list
  }, [tweetsByCategory, ogTweet])

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
      id={`toc-topic-${topicId}`}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-raised)',
        border: isOver ? `2px solid ${accentColor}` : '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        transition: 'border 0.15s ease',
        scrollSnapAlign: 'start' as const,
      }}
    >
      {/* Header */}
      <div
        onContextMenu={isAdmin ? (e) => { e.preventDefault(); onTopicContextMenu?.(e, topicId, title) } : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 20px',
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
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

        {/* Color dot with count */}
        <span
          style={{
            minWidth: 22,
            height: 22,
            borderRadius: 11,
            background: accentColor,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            color: '#fff',
            padding: '0 5px',
          }}
        >
          {totalTweets}
        </span>

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
            onClick={isAdmin ? (e) => {
              e.stopPropagation()
              setEditValue(title)
              setEditing(true)
            } : undefined}
            title={title}
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: 'var(--text-primary)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: isAdmin ? 'text' : 'default',
            }}
          >
            {title}
          </span>
        )}

      </div>

      {/* Body (droppable) - collapsible */}
      {!collapsed && (
        <div ref={setNodeRef} style={{
          padding: '12px 8px',
          minHeight: 60,
        }}>
            <>
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
                <div
                  id={`toc-cat-${topicId}-og`}
                  style={{
                    position: 'relative',
                    marginBottom: 12,
                  }}
                >
                  {/* Sticky OG nav label */}
                  <div
                    style={{
                      position: 'sticky',
                      top: 52,
                      zIndex: labelHovered ? 10 : 4,
                      pointerEvents: 'none',
                      height: 0,
                    }}
                  >
                    <CategoryNavLabel
                      allCategories={allCategoryList}
                      currentCategoryKey="og"
                      topicId={topicId}
                      onHoverChange={setLabelHovered}
                    />
                  </div>

                  {/* Tweet card */}
                  <div style={{
                    borderRadius: 'var(--radius-lg)',
                    background: 'rgba(245, 158, 11, 0.06)',
                  }}>
                  <div
                    onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, ogTweet) }}
                    style={{ padding: '4px 0 0' }}
                  >
                    <TweetCard tweet={ogTweet} selectable={false} />
                  </div>

                  {/* Grok Context section */}
                  {ogTweet.grok_context && (
                    <GrokContextSection tweetId={ogTweet.id} context={ogTweet.grok_context} />
                  )}

                  {/* No context yet - show fetch button */}
                  {!ogTweet.grok_context && (
                    <div style={{ maxWidth: 600, margin: '0 auto', width: '100%' }}>
                      <div style={{ marginTop: 10 }}>
                        <div style={{ height: 1, background: 'var(--border)' }} />
                      </div>
                      <div style={{ padding: '10px 12px 12px', fontSize: 13, color: 'var(--text-tertiary)' }}>
                        <GrokRefreshButton tweetId={ogTweet.id} label="Fetch Context" />
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              )}

              {isKekTopic(title) ? (
                /* Kek topics: render all tweets flat, no category grouping */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {Array.from(tweetsByCategory.values()).flatMap((group) => group.tweets).map((t) => (
                    <DraggableTweetInTopic
                      key={t.id}
                      tweet={t}
                      topicId={topicId}
                      onContextMenu={onContextMenu}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              ) : (
                Array.from(tweetsByCategory.entries()).map(([catKey, group], idx) => (
                <div
                  key={catKey ?? 'uncategorized'}
                  id={`toc-cat-${topicId}-${catKey ?? 'uncategorized'}`}
                  style={{
                    position: 'relative',
                    marginTop: idx > 0 ? 16 : 0,
                  }}
                >
                  {/* Sticky category nav label */}
                  <div
                    style={{
                      position: 'sticky',
                      top: 52,
                      zIndex: labelHovered ? 10 : 4,
                      pointerEvents: 'none',
                      height: 0,
                    }}
                  >
                    <CategoryNavLabel
                      allCategories={allCategoryList}
                      currentCategoryKey={catKey}
                      topicId={topicId}
                      onHoverChange={setLabelHovered}
                    />
                  </div>

                  {/* Tweet cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
                    {group.tweets.map((t) => (
                      <DraggableTweetInTopic
                        key={t.id}
                        tweet={t}
                        topicId={topicId}
                        onContextMenu={onContextMenu}
                        isAdmin={isAdmin}
                      />
                    ))}
                  </div>
                </div>
              ))
              )}
            </>
        </div>
      )}
    </div>
  )
}
