import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useDayBundle, type TopicBundle } from '../api/dayBundle'
import type { Tweet } from '../api/tweets'
import { sortTopics } from '../utils/topics'
import {
  type DigestBlock,
  type SubscriberInfo,
  useDigestDrafts,
  useDigestDraft,
  useCreateDigestDraft,
  useUpdateDigestDraft,
  useDeleteDigestDraft,
  useDigestPreview,
  useSendTestDigest,
  useSendDigest,
  useSubscriberCount,
  useSubscribers,
  useGenerateTemplate,
  useDraftSendLog,
  useRetryFailedSends,
} from '../api/digest'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function formatDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function defaultDateStr(): string {
  const now = new Date()
  // Default to yesterday unless it's past 4pm
  if (now.getHours() < 16) {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    return formatDateStr(yesterday)
  }
  return formatDateStr(now)
}

function recentDates(count: number): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    dates.push(formatDateStr(d))
  }
  return dates
}

function defaultSubject(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const yy = String(d.getFullYear()).slice(2)
  return `${d.getMonth() + 1}/${d.getDate()}/${yy} abridged tech`
}

function defaultScheduleTime(dateStr: string): string {
  // Next day at 8am local time
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T08:00`
}

function normalizeDateTime(dt: string): string {
  // datetime-local inputs expect YYYY-MM-DDTHH:MM (no seconds/timezone)
  return dt.slice(0, 16)
}

let _blockCounter = 0
function nextBlockId(): string {
  return `block-${Date.now()}-${_blockCounter++}`
}

/* ---- Compact tweet preview (used inside topic blocks and tweet blocks) ---- */
function CompactTweet({
  tweet,
  expanded = false,
  onToggleExpand,
}: {
  tweet: Tweet
  expanded?: boolean
  onToggleExpand?: () => void
}) {
  const isLong = tweet.text.length > 120

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0',
        cursor: isLong ? 'pointer' : 'default',
      }}
      onClick={isLong && onToggleExpand ? onToggleExpand : undefined}
    >
      {tweet.author_avatar_url && (
        <img
          src={tweet.author_avatar_url}
          alt=""
          style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1 }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          @{tweet.author_handle}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 6 }}>
          {expanded || !isLong ? tweet.text : tweet.text.slice(0, 120) + '...'}
        </span>
        {isLong && (
          <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 4, cursor: 'pointer' }}>
            {expanded ? '(less)' : '(more)'}
          </span>
        )}
      </div>
    </div>
  )
}

/* ---- Tweet selector side panel (opened from topic-header click) ---- */
function TweetSelectorPanel({
  topic,
  includedTweetIds,
  onToggleTweet,
  onClose,
}: {
  topic: TopicBundle
  includedTweetIds: Set<number>
  onToggleTweet: (tweetId: number, include: boolean) => void
  onClose: () => void
}) {
  const CATEGORY_ORDER = ['og post', 'echo', 'context', 'commentary', 'pushback', 'hot-take', 'callout', 'kek']

  const categoryGroups: Record<string, Tweet[]> = {}
  for (const tw of topic.tweets) {
    const cat = tw.category || 'og post'
    if (!categoryGroups[cat]) categoryGroups[cat] = []
    categoryGroups[cat].push(tw)
  }

  const sortedCategories = Object.keys(categoryGroups).sort(
    (a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a)
      const bi = CATEGORY_ORDER.indexOf(b)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    }
  )

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.3)',
        }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, zIndex: 10001,
        background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border)',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              {topic.title}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
              {includedTweetIds.size} of {topic.tweets.length} tweets selected
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 18, cursor: 'pointer' }}>&times;</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {sortedCategories.map(cat => (
            <div key={cat} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                {cat}
              </div>
              {categoryGroups[cat].map(tw => {
                const included = includedTweetIds.has(tw.id)
                return (
                  <label key={tw.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(e) => onToggleTweet(tw.id, e.target.checked)}
                      style={{ marginTop: 3 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <CompactTweet tweet={tw} />
                    </div>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/* ---- Insertion point between blocks ---- */
function BlockInsertRow({
  index,
  topics,
  usedTopicIds,
  usedTweetIds,
  onAddText,
  onAddTopic,
  onAddTweet,
  onAddDivider,
}: {
  index: number
  topics: TopicBundle[]
  usedTopicIds: Set<number>
  usedTweetIds: Set<number>
  onAddText: (atIndex: number) => void
  onAddTopic: (topicId: number, atIndex: number) => void
  onAddTweet: (tweetId: number, atIndex: number) => void
  onAddDivider: (atIndex: number) => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: hovered ? 32 : 16,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginLeft: 32,
        transition: 'height 0.15s',
      }}
    >
      {hovered && (
        <>
          <button onClick={() => onAddText(index)} style={smallBtnStyle}>+ Text</button>
          <TopicPicker
            topics={topics}
            usedTopicIds={usedTopicIds}
            onSelect={(topicId) => onAddTopic(topicId, index)}
            small
          />
          <TweetPicker
            topics={topics}
            usedTweetIds={usedTweetIds}
            onSelect={(tweetId) => onAddTweet(tweetId, index)}
            small
          />
          <button onClick={() => onAddDivider(index)} style={smallBtnStyle}>+ Divider</button>
        </>
      )}
    </div>
  )
}

/* ---- Sortable block row ---- */
function SortableBlock({
  block,
  topics,
  isSent,
  onUpdateBlock,
  onDeleteBlock,
  onAutoSave,
  onOpenTweetSelector,
}: {
  block: DigestBlock
  topics: TopicBundle[]
  isSent: boolean
  onUpdateBlock: (id: string, patch: Partial<DigestBlock>) => void
  onDeleteBlock: (id: string) => void
  onAutoSave: () => void
  onOpenTweetSelector?: (topicId: number) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id })

  const [expandedTweets, setExpandedTweets] = useState<Set<number>>(new Set())
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!ctxMenu) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [ctxMenu])
  const toggleExpand = (tweetId: number) => {
    setExpandedTweets(prev => {
      const next = new Set(prev)
      if (next.has(tweetId)) next.delete(tweetId)
      else next.add(tweetId)
      return next
    })
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 0,
    marginBottom: 0,
  }

  const topic = block.type === 'topic-header' && block.topic_id
    ? topics.find((t) => t.id === block.topic_id)
    : null

  // For tweet blocks, find the tweet across all topics + unsorted
  const tweetData = block.type === 'tweet' && block.tweet_id
    ? (() => {
        for (const t of topics) {
          const found = t.tweets.find((tw) => tw.id === block.tweet_id)
          if (found) return { tweet: found, topicTitle: t.title, topicColor: t.color }
        }
        return null
      })()
    : null

  return (
    <div ref={setNodeRef} style={style}>
      {/* Gutter: drag handle */}
      <div style={{
        width: 32,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'stretch',
      }}>
        <span
          {...attributes}
          {...listeners}
          onContextMenu={(e) => {
            if (isSent) return
            e.preventDefault()
            setCtxMenu({ x: e.clientX, y: e.clientY })
          }}
          style={{
            cursor: isSent ? 'default' : 'grab',
            color: 'var(--text-tertiary)',
            fontSize: 14,
            lineHeight: 1,
            padding: '2px 4px',
            userSelect: 'none',
            touchAction: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
          }}
          title="Drag to reorder · Right-click to delete"
        >
          &#10303;
        </span>
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <>
          <div
            onClick={() => setCtxMenu(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
          />
          <div
            style={{
              position: 'fixed',
              left: ctxMenu.x,
              top: ctxMenu.y,
              zIndex: 10000,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              padding: '4px 0',
              minWidth: 120,
            }}
          >
            <button
              onClick={() => {
                onDeleteBlock(block.id)
                setCtxMenu(null)
              }}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                padding: '8px 16px',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 13,
                color: '#ef4444',
                fontFamily: 'var(--font-body)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
            >
              Delete
            </button>
          </div>
        </>
      )}

      {/* Block content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {block.type === 'text' && (
          <TextBlockEditor block={block} isSent={isSent} onContentChange={onAutoSave} />
        )}

        {block.type === 'topic-header' && topic && (
          <div
            onClick={() => !isSent && onOpenTweetSelector?.(block.topic_id!)}
            style={{
              cursor: isSent ? 'default' : 'pointer',
              padding: '8px 14px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: topic.color || 'var(--text-tertiary)',
                flexShrink: 0,
              }} />
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                {topic.title}
              </span>
              {!isSent && (
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                  click to select tweets
                </span>
              )}
            </div>
          </div>
        )}

        {block.type === 'topic-header' && !topic && (
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            color: 'var(--text-tertiary)',
            fontSize: 13,
          }}>
            Topic #{block.topic_id} (not found)
          </div>
        )}

        {block.type === 'tweet' && tweetData && (
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}>
            {/* Topic color dot */}
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: tweetData.topicColor || 'var(--accent)',
              flexShrink: 0,
              marginTop: 5,
            }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <CompactTweet tweet={tweetData.tweet} expanded={expandedTweets.has(tweetData.tweet.id)} onToggleExpand={() => toggleExpand(tweetData.tweet.id)} />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                from {tweetData.topicTitle}
              </span>
              {!isSent && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={block.show_engagement || false}
                    onChange={(e) => {
                      onUpdateBlock(block.id, { show_engagement: e.target.checked })
                      onAutoSave()
                    }}
                    style={{ margin: 0 }}
                  />
                  Show engagement
                </label>
              )}
            </div>
          </div>
        )}

        {block.type === 'tweet' && !tweetData && (
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            color: 'var(--text-tertiary)',
            fontSize: 13,
          }}>
            Tweet #{block.tweet_id} (not found)
          </div>
        )}

        {block.type === 'divider' && (
          <hr style={{
            border: 'none',
            borderTop: '1px solid var(--border)',
            margin: '8px 0',
          }} />
        )}
      </div>
    </div>
  )
}

/* ---- Text block with local editing (avoids parent re-renders on every keystroke) ---- */
function TextBlockEditor({ block, isSent, onContentChange }: { block: DigestBlock; isSent: boolean; onContentChange: () => void }) {
  const [value, setValue] = useState(block.content || '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync if block content changes externally (e.g. draft load)
  useEffect(() => {
    setValue(block.content || '')
  }, [block.content])

  // We write directly to the block object on change to keep state in sync
  // without causing parent re-renders (the blocks array reference stays stable)
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    block.content = e.target.value
    onContentChange()
  }

  // Auto-resize
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }, [value])

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={handleChange}
      disabled={isSent}
      placeholder="Write markdown content..."
      rows={3}
      style={{ ...markdownTextareaStyle, overflow: 'hidden', resize: 'none' }}
    />
  )
}

/* ---- Topic picker dropdown ---- */
function TopicPicker({
  topics,
  usedTopicIds,
  onSelect,
  small,
}: {
  topics: TopicBundle[]
  usedTopicIds: Set<number>
  onSelect: (topicId: number) => void
  small?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const available = topics.filter((t) => !usedTopicIds.has(t.id))

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        disabled={available.length === 0}
        style={{
          ...(small ? smallBtnStyle : addBtnStyle),
          opacity: available.length === 0 ? 0.4 : 1,
          cursor: available.length === 0 ? 'default' : 'pointer',
        }}
      >
        + Topic
      </button>

      {open && available.length > 0 && (
        <div style={dropdownStyle}>
          {available.map((t) => (
            <div
              key={t.id}
              onClick={() => { onSelect(t.id); setOpen(false) }}
              style={dropdownItemStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: t.color || 'var(--accent)',
                flexShrink: 0,
              }} />
              {t.title}
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                {t.tweet_count} tweet{t.tweet_count !== 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---- Tweet picker dropdown (grouped by topic) ---- */
function TweetPicker({
  topics,
  usedTweetIds,
  onSelect,
  small,
}: {
  topics: TopicBundle[]
  usedTweetIds: Set<number>
  onSelect: (tweetId: number) => void
  small?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [expandedTopics, setExpandedTopics] = useState<Set<number>>(new Set())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setExpandedTopics(new Set())
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Topics that have at least one available (non-used) tweet
  const topicsWithAvailable = topics.filter((t) =>
    t.tweets.some((tw) => !usedTweetIds.has(tw.id))
  )
  const hasAny = topicsWithAvailable.length > 0

  const toggleTopicExpand = (topicId: number) => {
    setExpandedTopics((prev) => {
      const next = new Set(prev)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return next
    })
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => {
          setOpen(!open)
          if (!open) setExpandedTopics(new Set())
        }}
        disabled={!hasAny}
        style={{
          ...(small ? smallBtnStyle : addBtnStyle),
          opacity: hasAny ? 1 : 0.4,
          cursor: hasAny ? 'pointer' : 'default',
        }}
      >
        + Tweet
      </button>

      {open && hasAny && (
        <div style={{ ...dropdownStyle, minWidth: 340, maxHeight: 400 }}>
          {topicsWithAvailable.map((topic) => {
            const isExpanded = expandedTopics.has(topic.id)
            const availableTweets = topic.tweets.filter((tw) => !usedTweetIds.has(tw.id))

            return (
              <div key={topic.id}>
                {/* Topic header */}
                <div
                  onClick={() => toggleTopicExpand(topic.id)}
                  style={{
                    ...dropdownItemStyle,
                    fontWeight: 600,
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: topic.color || 'var(--accent)',
                    flexShrink: 0,
                  }} />
                  <span style={{ flex: 1 }}>{topic.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {availableTweets.length}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                    {isExpanded ? '\u25B2' : '\u25BC'}
                  </span>
                </div>

                {/* Tweet list (expanded) */}
                {isExpanded && availableTweets.map((tw) => (
                  <div
                    key={tw.id}
                    onClick={() => { onSelect(tw.id); setOpen(false); setExpandedTopics(new Set()) }}
                    style={{
                      padding: '6px 12px 6px 28px',
                      cursor: 'pointer',
                      borderRadius: 6,
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.4,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {tw.author_avatar_url && (
                      <img src={tw.author_avatar_url} alt="" style={{ width: 16, height: 16, borderRadius: '50%', marginTop: 1 }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        @{tw.author_handle}
                      </span>
                      {' '}
                      {tw.text.length > 80 ? tw.text.slice(0, 80) + '...' : tw.text}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ---- Drafts browser modal ---- */
function DraftsModal({
  drafts,
  selectedDraftId,
  onSelect,
  onClose,
  onCreate,
}: {
  drafts: import('../api/digest').DigestDraft[]
  selectedDraftId: number | null
  onSelect: (id: number) => void
  onClose: () => void
  onCreate: (date: string) => void
}) {
  const [newDate, setNewDate] = useState('')

  const grouped = {
    draft: drafts.filter(d => d.status === 'draft'),
    scheduled: drafts.filter(d => d.status === 'scheduled'),
    sent: drafts.filter(d => d.status === 'sent'),
  }

  const statusLabel: Record<string, string> = { draft: 'Drafts', scheduled: 'Scheduled', sent: 'Sent' }
  const statusColor: Record<string, string> = {
    draft: 'var(--text-secondary)',
    scheduled: '#a78bfa',
    sent: '#4ade80',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', width: 480, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Drafts</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 18, cursor: 'pointer' }}>&times;</button>
        </div>

        {/* New draft */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            style={{
              flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: '6px 10px', color: 'var(--text-primary)',
              fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none',
            }}
          />
          <button
            onClick={() => { if (newDate) { onCreate(newDate); onClose() } }}
            disabled={!newDate}
            style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 'var(--radius-md)', padding: '6px 14px', fontSize: 13,
              fontWeight: 500, cursor: newDate ? 'pointer' : 'default',
              opacity: newDate ? 1 : 0.4, fontFamily: 'var(--font-body)',
            }}
          >
            New Draft
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {(['draft', 'scheduled', 'sent'] as const).map(status => {
            const items = grouped[status]
            if (items.length === 0) return null
            return (
              <div key={status}>
                <div style={{ padding: '8px 20px', fontSize: 11, fontWeight: 600, color: statusColor[status], textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  {statusLabel[status]} ({items.length})
                </div>
                {items.map(d => {
                  const topicCount = (d.content_blocks || []).filter(b => b.type === 'topic-header' || (b.type as string) === 'topic').length
                  return (
                    <div
                      key={d.id}
                      onClick={() => { onSelect(d.id); onClose() }}
                      style={{
                        padding: '10px 20px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: d.id === selectedDraftId ? 'var(--bg-hover)' : 'transparent',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = d.id === selectedDraftId ? 'var(--bg-hover)' : 'transparent' }}
                    >
                      <div>
                        <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{d.date}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                          {topicCount} topic{topicCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {d.sent_at && (
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                          {d.recipient_count} recipients
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ---- Topic selector for new draft template ---- */
function TopicSelectorModal({
  topics,
  date: _date,
  onConfirm,
  onClose,
}: {
  topics: TopicBundle[]
  date: string
  onConfirm: (orderedIds: number[]) => void
  onClose: () => void
}) {
  const [ordered, setOrdered] = useState<number[]>([])

  const toggle = (id: number) => {
    setOrdered(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const selectTop3 = () => {
    setOrdered(topics.slice(0, 3).map(t => t.id))
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', width: 420, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            Select featured topics
          </h3>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
            Selected topics become full blocks. Others go to &ldquo;more on the timeline&rdquo; links.
          </p>
        </div>

        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button onClick={selectTop3} style={{ ...addBtnStyle, fontSize: 12, padding: '4px 10px' }}>
            Top 3
          </button>
          <button onClick={() => setOrdered(topics.map(t => t.id))} style={{ ...addBtnStyle, fontSize: 12, padding: '4px 10px' }}>
            All
          </button>
          <button onClick={() => setOrdered([])} style={{ ...addBtnStyle, fontSize: 12, padding: '4px 10px' }}>
            None
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px' }}>
          {topics.map(t => (
            <label
              key={t.id}
              onClick={() => toggle(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px',
                cursor: 'pointer', borderRadius: 'var(--radius-sm)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {(() => {
                const pos = ordered.indexOf(t.id)
                const isSelected = pos !== -1
                return (
                  <span
                    style={{
                      width: 22, height: 22, borderRadius: '50%',
                      border: isSelected ? 'none' : '2px solid var(--border)',
                      background: isSelected ? 'var(--accent)' : 'transparent',
                      color: '#fff', fontSize: 11, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {isSelected ? pos + 1 : ''}
                  </span>
                )
              })()}
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color || 'var(--accent)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>{t.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {t.tweet_count} tweet{t.tweet_count !== 1 ? 's' : ''}
              </span>
            </label>
          ))}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={addBtnStyle}>Cancel</button>
          <button
            onClick={() => onConfirm(ordered)}
            disabled={ordered.length === 0}
            style={{
              background: ordered.length === 0 ? 'var(--text-tertiary)' : 'var(--accent)',
              color: '#fff', border: 'none',
              borderRadius: 'var(--radius-md)', padding: '8px 16px', fontSize: 13,
              fontWeight: 500, cursor: ordered.length === 0 ? 'default' : 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            Create Draft ({ordered.length})
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---- Send confirmation modal with subscriber selection ---- */
function SendConfirmModal({
  subscribers,
  onConfirm,
  onClose,
}: {
  subscribers: SubscriberInfo[]
  onConfirm: (subscriberIds: number[]) => void
  onClose: () => void
}) {
  const active = subscribers.filter(s => !s.unsubscribed_at)
  const [selected, setSelected] = useState<Set<number>>(() => new Set(active.map(s => s.id)))
  const [search, setSearch] = useState('')

  const filtered = active.filter(s =>
    s.email.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', width: 420, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            Send digest
          </h3>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
            Select which subscribers to send to.
          </p>
        </div>

        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text"
            placeholder="Search subscribers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
            style={{
              width: '100%', padding: '8px 12px',
              background: 'var(--bg-base)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
              fontSize: 13, outline: 'none', fontFamily: 'var(--font-body)',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSelected(new Set(active.map(s => s.id)))} style={{ ...addBtnStyle, fontSize: 12, padding: '4px 10px' }}>
              All
            </button>
            <button onClick={() => setSelected(new Set())} style={{ ...addBtnStyle, fontSize: 12, padding: '4px 10px' }}>
              None
            </button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px' }}>
          {filtered.map(s => (
            <label
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px',
                cursor: 'pointer', borderRadius: 'var(--radius-sm)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>{s.email}</span>
            </label>
          ))}
          {filtered.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: 16 }}>
              No subscribers found.
            </p>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {selected.size} of {active.length} selected
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={addBtnStyle}>Cancel</button>
            <button
              onClick={() => onConfirm(Array.from(selected))}
              disabled={selected.size === 0}
              style={{
                background: selected.size === 0 ? 'var(--text-tertiary)' : '#ef4444',
                color: '#fff', border: 'none',
                borderRadius: 'var(--radius-md)', padding: '8px 16px', fontSize: 13,
                fontWeight: 500, cursor: selected.size === 0 ? 'default' : 'pointer',
                fontFamily: 'var(--font-body)',
              }}
            >
              Send to {selected.size} subscriber{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---- Main DigestComposer ---- */
export function DigestComposer() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  const [date, setDate] = useState(defaultDateStr())
  const datePickerRef = useRef<HTMLInputElement>(null)
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null)
  const [blocks, setBlocks] = useState<DigestBlock[]>([])
  const [scheduledFor, setScheduledFor] = useState('')
  const [subject, setSubject] = useState('')
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: bundle } = useDayBundle(date)
  const { data: drafts } = useDigestDrafts()
  const { data: draft } = useDigestDraft(selectedDraftId)
  const { data: preview } = useDigestPreview(selectedDraftId)
  const { data: subCount } = useSubscriberCount()
  const [showSubs, setShowSubs] = useState(false)
  const [showSendConfirm, setShowSendConfirm] = useState(false)
  const [subSearch, setSubSearch] = useState('')
  const { data: subscribers } = useSubscribers(showSubs || showSendConfirm)
  const [showDraftsModal, setShowDraftsModal] = useState(false)
  const [showTopicSelector, setShowTopicSelector] = useState(false)
  const [tweetSelectorTopicId, setTweetSelectorTopicId] = useState<number | null>(null)

  const createDraft = useCreateDigestDraft()
  const updateDraft = useUpdateDigestDraft()
  const deleteDraft = useDeleteDigestDraft()
  const sendTest = useSendTestDigest()
  const sendDigest = useSendDigest()
  const sendLog = useDraftSendLog(draft?.status === 'sent' ? selectedDraftId : null)
  const retryFailed = useRetryFailedSends()
  const [retrySelection, setRetrySelection] = useState<Set<number>>(new Set())
  const [showFailedDetail, setShowFailedDetail] = useState(false)

  // --- Auto-save ---
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const scheduledForRef = useRef(scheduledFor)
  scheduledForRef.current = scheduledFor
  const subjectRef = useRef(subject)
  subjectRef.current = subject
  const selectedDraftIdRef = useRef(selectedDraftId)
  selectedDraftIdRef.current = selectedDraftId
  const dateRef = useRef(date)
  dateRef.current = date

  const triggerAutoSave = useCallback(() => {
    setSaveStatus('idle')
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      const currentBlocks = blocksRef.current.map(b => ({ ...b }))
      const currentDraftId = selectedDraftIdRef.current
      if (currentDraftId) {
        setSaveStatus('saving')
        try {
          await updateDraft.mutateAsync({
            id: currentDraftId,
            content_blocks: currentBlocks,
            scheduled_for: scheduledForRef.current || null,
            subject: subjectRef.current || undefined,
          })
          setSaveStatus('saved')
        } catch {
          setSaveStatus('idle')
        }
      } else if (currentBlocks.length > 0) {
        setSaveStatus('saving')
        try {
          const created = await createDraft.mutateAsync({
            date: dateRef.current,
            content_blocks: currentBlocks,
          })
          setSelectedDraftId(created.id)
          setSaveStatus('saved')
        } catch {
          setSaveStatus('idle')
        }
      }
    }, 800)
  }, [updateDraft, createDraft])

  // Flush pending autosave on page unload to prevent data loss
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!saveTimeoutRef.current) return
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
      const currentDraftId = selectedDraftIdRef.current
      if (!currentDraftId) return
      const currentBlocks = blocksRef.current.map(b => ({ ...b }))
      const body = JSON.stringify({
        content_blocks: currentBlocks,
        scheduled_for: scheduledForRef.current || null,
        subject: subjectRef.current || undefined,
      })
      fetch(`/api/digest/drafts/${currentDraftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Load draft data when a *different* draft is selected (not on every auto-save update)
  const loadedDraftIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (draft && draft.id !== loadedDraftIdRef.current) {
      loadedDraftIdRef.current = draft.id
      setBlocks(draft.content_blocks || [])
      setScheduledFor(draft.scheduled_for ? normalizeDateTime(draft.scheduled_for) : '')
      setSubject(draft.subject || defaultSubject(draft.date))
      setDate(draft.date)
    }
  }, [draft])

  // Auto-select existing draft for this date (draft or scheduled)
  useEffect(() => {
    if (!drafts) return
    const existing = drafts.find((d) => d.date === date && (d.status === 'draft' || d.status === 'scheduled'))
    if (existing) {
      setSelectedDraftId(existing.id)
    }
  }, [drafts, date])

  const topics = sortTopics(bundle?.topics || [])

  // Set of topic IDs already used in blocks
  const usedTopicIds = new Set(
    blocks.filter((b) => b.type === 'topic-header' && b.topic_id).map((b) => b.topic_id!)
  )

  // Set of tweet IDs already used in standalone tweet blocks
  const usedTweetIds = new Set(
    blocks.filter((b) => b.type === 'tweet' && b.tweet_id).map((b) => b.tweet_id!)
  )

  const updateBlock = useCallback((id: string, patch: Partial<DigestBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }, [])

  const deleteBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
    triggerAutoSave()
  }, [triggerAutoSave])

  const addTextBlock = useCallback((atIndex?: number) => {
    const newBlock = { id: nextBlockId(), type: 'text' as const, content: '' }
    setBlocks((prev) => atIndex !== undefined
      ? [...prev.slice(0, atIndex), newBlock, ...prev.slice(atIndex)]
      : [...prev, newBlock]
    )
    triggerAutoSave()
  }, [triggerAutoSave])

  const addTopicHeaderBlock = useCallback((topicId: number, atIndex?: number) => {
    const newBlock = { id: nextBlockId(), type: 'topic-header' as const, topic_id: topicId }
    setBlocks((prev) => atIndex !== undefined
      ? [...prev.slice(0, atIndex), newBlock, ...prev.slice(atIndex)]
      : [...prev, newBlock]
    )
    triggerAutoSave()
  }, [triggerAutoSave])

  const addTweetBlock = useCallback((tweetId: number, atIndex?: number) => {
    const newBlock = { id: nextBlockId(), type: 'tweet' as const, tweet_id: tweetId }
    setBlocks((prev) => atIndex !== undefined
      ? [...prev.slice(0, atIndex), newBlock, ...prev.slice(atIndex)]
      : [...prev, newBlock]
    )
    triggerAutoSave()
  }, [triggerAutoSave])

  const addDividerBlock = useCallback((atIndex?: number) => {
    const newBlock = { id: nextBlockId(), type: 'divider' as const }
    setBlocks((prev) => atIndex !== undefined
      ? [...prev.slice(0, atIndex), newBlock, ...prev.slice(atIndex)]
      : [...prev, newBlock]
    )
    triggerAutoSave()
  }, [triggerAutoSave])

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setBlocks((prev) => {
      const oldIndex = prev.findIndex((b) => b.id === active.id)
      const newIndex = prev.findIndex((b) => b.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
    triggerAutoSave()
  }, [triggerAutoSave])

  const generateTemplate = useGenerateTemplate()

  const generateTemplateBlocks = useCallback(async (orderedIds: number[]): Promise<DigestBlock[]> => {
    const orderedSet = new Set(orderedIds)
    const featured = orderedIds.map(id => topics.find(t => t.id === id)).filter((t): t is TopicBundle => t !== undefined)
    const rest = sortTopics(topics).filter(t => !orderedSet.has(t.id))

    const d = new Date(date + 'T00:00:00')
    const formattedDate = `${d.getMonth() + 1}/${d.getDate()}`

    // Call backend for AI content
    const templateData = await generateTemplate.mutateAsync({
      date,
      topic_ids: featured.map(t => t.id),
    })

    const newBlocks: DigestBlock[] = []

    // Intro
    newBlocks.push({
      id: nextBlockId(),
      type: 'text',
      content: `# ${featured.length} topic${featured.length !== 1 ? 's' : ''} from ${formattedDate} tech discourse`,
    })

    let isFirstTopic = true
    for (const topicData of templateData.topics) {
      if (topicData.category_groups.length === 0) continue

      // Divider before topic (except first)
      if (!isFirstTopic) {
        newBlocks.push({ id: nextBlockId(), type: 'divider' })
      }
      isFirstTopic = false

      // Topic header
      newBlocks.push({ id: nextBlockId(), type: 'topic-header', topic_id: topicData.topic_id })

      // Summary text block
      if (topicData.summary) {
        newBlocks.push({ id: nextBlockId(), type: 'text', content: `*${topicData.summary}*` })
      }

      // Tweet blocks grouped by category
      let isFirstGroup = true
      for (const group of topicData.category_groups) {
        // Category transition text
        if (!isFirstGroup && group.transition) {
          newBlocks.push({ id: nextBlockId(), type: 'text', content: group.transition })
        }
        isFirstGroup = false

        // Individual tweet blocks
        for (const tweetId of group.tweet_ids) {
          newBlocks.push({ id: nextBlockId(), type: 'tweet', tweet_id: tweetId })
        }
      }
    }

    // "More on the timeline" section
    if (rest.length > 0) {
      newBlocks.push({ id: nextBlockId(), type: 'divider' })
      const sorted2 = sortTopics(topics)
      const links = rest.map(t => {
        const topicNum = sorted2.indexOf(t) + 1
        return `- [${t.title}](https://abridged.tech/app/${date}/${topicNum})`
      }).join('\n')
      newBlocks.push({
        id: nextBlockId(),
        type: 'text',
        content: `**More on the timeline**\n\n${links}`,
      })
    }

    return newBlocks
  }, [topics, date, generateTemplate])

  const [isGenerating, setIsGenerating] = useState(false)

  const handleCreateFromTemplate = useCallback(async (orderedIds: number[]) => {
    setIsGenerating(true)
    setShowTopicSelector(false)
    try {
      const newBlocks = await generateTemplateBlocks(orderedIds)
      setBlocks(newBlocks)
      triggerAutoSave()
    } catch {
      showStatus('Failed to generate template', 'error')
    } finally {
      setIsGenerating(false)
    }
  }, [generateTemplateBlocks, triggerAutoSave])

  const showStatus = (text: string, type: 'success' | 'error') => {
    setStatusMessage({ text, type })
    setTimeout(() => setStatusMessage(null), 4000)
  }

  const handleSendTest = async () => {
    if (!selectedDraftId) return
    try {
      const result = await sendTest.mutateAsync(selectedDraftId)
      showStatus(`Test email sent to ${result.to}`, 'success')
    } catch {
      showStatus('Failed to send test email', 'error')
    }
  }

  const handleSendNow = () => {
    if (!selectedDraftId) return
    setShowSendConfirm(true)
  }

  const handleSendConfirm = async (subscriberIds: number[]) => {
    if (!selectedDraftId) return
    setShowSendConfirm(false)
    try {
      const result = await sendDigest.mutateAsync({ draftId: selectedDraftId, subscriberIds })
      showStatus(`Sent to ${result.sent_count} of ${result.total_subscribers} subscribers`, 'success')
    } catch {
      showStatus('Failed to send digest', 'error')
    }
  }

  const handleDelete = async () => {
    if (!selectedDraftId) return
    if (!window.confirm('Delete this draft?')) return
    try {
      await deleteDraft.mutateAsync(selectedDraftId)
      setSelectedDraftId(null)
      setBlocks([])
      setScheduledFor('')
      setSubject('')
      showStatus('Draft deleted', 'success')
    } catch {
      showStatus('Failed to delete draft', 'error')
    }
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Admin access required
      </div>
    )
  }

  const isSent = draft?.status === 'sent'
  const isBusy = createDraft.isPending || updateDraft.isPending || sendTest.isPending || sendDigest.isPending || isGenerating
  const blockIds = blocks.map((b) => b.id)
  const topicCount = blocks.filter((b) => b.type === 'topic-header').length

  return (
    <div style={{ height: '100dvh', overflowY: 'auto', background: 'var(--bg-base)' }}>
      {/* Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'var(--bg-base)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            maxWidth: 800,
            margin: '0 auto',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <button
            onClick={() => navigate('/app')}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)',
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            &#8592; Back
          </button>

          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Digest Composer
          </h1>

          <button
            onClick={() => setShowDraftsModal(true)}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)',
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            Drafts{drafts ? ` (${drafts.length})` : ''}
          </button>

          {saveStatus === 'saving' && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span style={{ fontSize: 12, color: '#4ade80' }}>Saved</span>
          )}

          <div style={{ flex: 1 }} />

          {subCount && (
            <button
              onClick={() => setShowSubs(true)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 12,
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-body)',
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
            >
              {subCount.count} subscriber{subCount.count !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </header>

      {/* Status message */}
      {statusMessage && (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px' }}>
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              background: statusMessage.type === 'success' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
              color: statusMessage.type === 'success' ? '#4ade80' : 'var(--error)',
              border: `1px solid ${statusMessage.type === 'success' ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)'}`,
            }}
          >
            {statusMessage.text}
          </div>
        </div>
      )}

      {/* Content */}
      <main
        style={{
          maxWidth: 800,
          margin: '0 auto',
          padding: '24px 24px 80px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Date selector strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          {recentDates(7).reverse().map(d => {
            const dateObj = new Date(d + 'T00:00:00')
            const isSelected = d === date
            const isToday = d === formatDateStr(new Date())
            const dayAbbr = dateObj.toLocaleDateString('en-US', { weekday: 'narrow' })
            const dayNum = dateObj.getDate()
            // Check if this date has an existing draft
            const hasDraft = drafts?.some(dr => dr.date === d)

            return (
              <button
                key={d}
                onClick={() => {
                  setDate(d)
                  setSelectedDraftId(null)
                  setBlocks([])
                }}
                style={{
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 10,
                  padding: '6px 0',
                  width: 40,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  transition: 'background 0.15s ease',
                  position: 'relative',
                }}
              >
                <span style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                }}>
                  {dayAbbr}
                </span>
                <span style={{
                  fontSize: 15,
                  fontWeight: isSelected || isToday ? 700 : 400,
                  lineHeight: 1,
                }}>
                  {dayNum}
                </span>
                {/* Dot indicators */}
                <div style={{ height: 4, display: 'flex', gap: 3, marginTop: 1 }}>
                  {isToday && !isSelected && (
                    <span style={{
                      width: 4, height: 4, borderRadius: '50%',
                      background: 'var(--accent)',
                    }} />
                  )}
                  {hasDraft && !isSelected && (
                    <span style={{
                      width: 4, height: 4, borderRadius: '50%',
                      background: 'var(--text-tertiary)',
                    }} />
                  )}
                </div>
              </button>
            )
          })}

          {/* Calendar picker for other dates */}
          <div style={{ position: 'relative', marginLeft: 4 }}>
            <input
              ref={datePickerRef}
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setSelectedDraftId(null)
                setBlocks([])
              }}
              style={{
                position: 'absolute', opacity: 0, width: 0, height: 0,
                top: '100%', left: 0, pointerEvents: 'none',
              }}
            />
            <button
              onClick={() => datePickerRef.current?.showPicker()}
              title="Pick any date"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-tertiary)',
                fontSize: 11,
                padding: '8px 6px',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
            >
              &#8943;
            </button>
          </div>

          {/* Spacer to push draft selector to right */}
          <div style={{ flex: 1 }} />

          {/* Draft selector inline */}
          {selectedDraftId && drafts && drafts.length > 0 && (
            <select
              value={selectedDraftId ?? ''}
              onChange={(e) => {
                setSelectedDraftId(e.target.value ? Number(e.target.value) : null)
                if (!e.target.value) setBlocks([])
              }}
              style={{
                ...inputStyle,
                fontSize: 12,
                padding: '5px 8px',
                maxWidth: 220,
              }}
            >
              <option value="">New draft</option>
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.date} ({d.status}){d.sent_at ? ' - Last used' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {isSent && (
          <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 500, marginTop: -8 }}>
            Last sent {draft!.sent_at ? new Date(draft!.sent_at).toLocaleString() : ''} ({draft!.recipient_count} recipients)
          </div>
        )}

        {/* New Draft from Topics button */}
        {blocks.length === 0 && !selectedDraftId && topics.length > 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <button
              onClick={() => setShowTopicSelector(true)}
              disabled={isGenerating}
              style={{
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: 'var(--radius-md)', padding: '10px 20px', fontSize: 14,
                fontWeight: 500, cursor: isGenerating ? 'default' : 'pointer', fontFamily: 'var(--font-body)',
                opacity: isGenerating ? 0.6 : 1,
              }}
            >
              {isGenerating ? 'Generating...' : 'New Draft from Topics'}
            </button>
          </div>
        )}

        {/* Generating indicator when blocks are being assembled */}
        {isGenerating && blocks.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
            Generating template with AI summaries...
          </div>
        )}

        {/* Inline draft list when no draft selected */}
        {!selectedDraftId && (() => {
          const activeDrafts = (drafts || []).filter(d => d.status !== 'sent').sort((a, b) => b.date.localeCompare(a.date))
          const sentDrafts = (drafts || []).filter(d => d.status === 'sent').sort((a, b) => b.date.localeCompare(a.date))

          const draftRow = (d: (typeof activeDrafts)[number]) => {
            const topicCount = (d.content_blocks || []).filter(
              (b: any) => b.type === 'topic-header' || b.type === 'topic'
            ).length
            const isSentRow = d.status === 'sent'
            return (
              <div
                key={d.id}
                onClick={() => setSelectedDraftId(d.id)}
                style={{
                  padding: '12px 20px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--border)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div>
                  <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {d.subject || d.date}
                  </span>
                  {d.subject && (
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                      {d.date}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                    {topicCount} topic{topicCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isSentRow && d.sent_at && (
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {d.recipient_count} recipients &middot; {new Date(d.sent_at).toLocaleDateString()}
                    </span>
                  )}
                  {!isSentRow && d.status === 'scheduled' && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                      scheduled
                    </span>
                  )}
                </div>
              </div>
            )
          }

          return (
            <>
              <div
                style={{
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Drafts
                  </h3>
                </div>
                {activeDrafts.length === 0 ? (
                  <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    No drafts yet. Create one from topics above.
                  </div>
                ) : (
                  <div>{activeDrafts.map(draftRow)}</div>
                )}
              </div>

              {sentDrafts.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{
                    cursor: 'pointer', fontSize: 13, color: 'var(--text-tertiary)',
                    padding: '8px 0', userSelect: 'none' as const,
                  }}>
                    Sent ({sentDrafts.length})
                  </summary>
                  <div
                    style={{
                      background: 'var(--bg-raised)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-lg)',
                      overflow: 'hidden',
                      marginTop: 4,
                    }}
                  >
                    {sentDrafts.map(draftRow)}
                  </div>
                </details>
              )}
            </>
          )
        })()}

        {/* Block List — no overflow:hidden so dropdowns can escape */}
        {selectedDraftId && (
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={sectionTitleStyle}>Content Blocks</h3>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
                {blocks.length} block{blocks.length !== 1 ? 's' : ''} &middot; {topicCount} topic{topicCount !== 1 ? 's' : ''}
              </p>
            </div>
            {selectedDraftId && !isSent && (
              <button
                onClick={handleDelete}
                disabled={isBusy}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  fontSize: 12,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontFamily: 'var(--font-body)',
                  padding: '4px 0',
                }}
              >
                Delete draft
              </button>
            )}
          </div>

          <div style={{ padding: '16px 20px' }}>
            {blocks.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                No blocks yet. Add blocks below or create from topics.
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
                  {blocks.map((block, idx) => (
                    <React.Fragment key={block.id}>
                      <BlockInsertRow
                        index={idx}
                        topics={topics}
                        usedTopicIds={usedTopicIds}
                        usedTweetIds={usedTweetIds}
                        onAddText={addTextBlock}
                        onAddTopic={addTopicHeaderBlock}
                        onAddTweet={addTweetBlock}
                        onAddDivider={addDividerBlock}
                      />
                      <SortableBlock
                        block={block}
                        topics={topics}
                        isSent={false}
                        onUpdateBlock={updateBlock}
                        onDeleteBlock={deleteBlock}
                        onAutoSave={triggerAutoSave}
                        onOpenTweetSelector={setTweetSelectorTopicId}
                      />
                    </React.Fragment>
                  ))}
                </SortableContext>
              </DndContext>
            )}

            {/* Add block buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => addTextBlock()} style={addBtnStyle}>
                  + Text
                </button>
                <TopicPicker
                  topics={topics}
                  usedTopicIds={usedTopicIds}
                  onSelect={(topicId) => addTopicHeaderBlock(topicId)}
                />
                <TweetPicker
                  topics={topics}
                  usedTweetIds={usedTweetIds}
                  onSelect={(tweetId) => addTweetBlock(tweetId)}
                />
                <button onClick={() => addDividerBlock()} style={addBtnStyle}>
                  + Divider
                </button>
              </div>
          </div>
        </div>
        )}

        {/* Schedule */}
        {selectedDraftId && (
          <div
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '16px 20px',
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {scheduledFor ? (
              <>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Scheduled for {new Date(scheduledFor).toLocaleString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => {
                    setScheduledFor(e.target.value)
                    triggerAutoSave()
                  }}
                  style={{ ...inputStyle, fontSize: 12, padding: '4px 8px', width: 'auto' }}
                />
                <button
                  onClick={() => {
                    setScheduledFor('')
                    triggerAutoSave()
                  }}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border)',
                    color: '#ef4444',
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '5px 12px',
                    borderRadius: 'var(--radius-md)',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  Cancel Schedule
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setScheduledFor(defaultScheduleTime(date))
                  triggerAutoSave()
                }}
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                Schedule Send
              </button>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {selectedDraftId && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={handleSendTest}
              disabled={isBusy}
              style={buttonStyle('transparent', true)}
            >
              {sendTest.isPending ? 'Sending...' : 'Send Test'}
            </button>

            <button
              onClick={handleSendNow}
              disabled={isBusy}
              style={buttonStyle('#ef4444')}
            >
              {sendDigest.isPending ? 'Sending...' : 'Send Now'}
            </button>

          </div>
        )}

        {/* Send Status */}
        {isSent && sendLog.data && sendLog.data.length > 0 && (() => {
          const logs = sendLog.data
          // Deduplicate: for each subscriber, use latest attempt
          const latestBySubscriber = new Map<number, typeof logs[0]>()
          for (const log of logs) {
            const existing = latestBySubscriber.get(log.subscriber_id)
            if (!existing || new Date(log.attempted_at) > new Date(existing.attempted_at)) {
              latestBySubscriber.set(log.subscriber_id, log)
            }
          }
          const latest = Array.from(latestBySubscriber.values())
          const sentCount = latest.filter(l => l.status === 'sent').length
          const failedLogs = latest.filter(l => l.status === 'failed')
          const failedCount = failedLogs.length
          const totalCount = latest.length
          const allSuccess = failedCount === 0

          return (
            <div
              style={{
                background: 'var(--bg-raised)',
                border: `1px solid ${allSuccess ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)'}`,
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}
            >
              {/* Status bar */}
              <div
                style={{
                  padding: '12px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: allSuccess ? '#4ade80' : '#f87171',
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                    Sent to {sentCount}/{totalCount}
                  </span>
                  {failedCount > 0 && (
                    <span style={{ fontSize: 13, color: '#f87171' }}>
                      &middot; {failedCount} failed
                    </span>
                  )}
                </div>
                {failedCount > 0 && (
                  <button
                    onClick={() => {
                      setShowFailedDetail(!showFailedDetail)
                      setRetrySelection(new Set())
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-tertiary)',
                      fontSize: 12,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    {showFailedDetail ? 'Hide' : 'Show'} details
                  </button>
                )}
              </div>

              {/* Failed detail */}
              {showFailedDetail && failedCount > 0 && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  {failedLogs.map(log => (
                    <div
                      key={log.id}
                      style={{
                        padding: '8px 20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 13,
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={retrySelection.has(log.subscriber_id)}
                        onChange={() => {
                          const next = new Set(retrySelection)
                          if (next.has(log.subscriber_id)) next.delete(log.subscriber_id)
                          else next.add(log.subscriber_id)
                          setRetrySelection(next)
                        }}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span style={{ color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                        {log.email}
                      </span>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 12, marginLeft: 'auto', flexShrink: 0 }}>
                        {log.error_message || 'Unknown error'}
                      </span>
                    </div>
                  ))}

                  {/* Retry buttons */}
                  <div style={{ padding: '10px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    {retrySelection.size > 0 && (
                      <button
                        onClick={async () => {
                          await retryFailed.mutateAsync({
                            draftId: selectedDraftId!,
                            subscriberIds: Array.from(retrySelection),
                          })
                          setRetrySelection(new Set())
                          setShowFailedDetail(false)
                        }}
                        disabled={retryFailed.isPending}
                        style={{
                          background: 'none',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--text-secondary)',
                          padding: '6px 14px',
                          fontSize: 12,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-body)',
                        }}
                      >
                        {retryFailed.isPending ? 'Retrying...' : `Retry Selected (${retrySelection.size})`}
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        await retryFailed.mutateAsync({ draftId: selectedDraftId! })
                        setRetrySelection(new Set())
                        setShowFailedDetail(false)
                      }}
                      disabled={retryFailed.isPending}
                      style={{
                        background: '#f87171',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        color: '#fff',
                        padding: '6px 14px',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-body)',
                        opacity: retryFailed.isPending ? 0.6 : 1,
                      }}
                    >
                      {retryFailed.isPending ? 'Retrying...' : `Retry All Failed (${failedCount})`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* Email Preview — always visible when a draft exists */}
        {selectedDraftId && (
          <div
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h3 style={{ ...sectionTitleStyle, margin: 0 }}>Email Preview</h3>
                {preview && (
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {preview.recipient_count} recipient{preview.recipient_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>Subject:</span>
                <input
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value)
                    triggerAutoSave()
                  }}
                  placeholder={defaultSubject(date)}
                  style={{
                    ...inputStyle,
                    fontSize: 12,
                    padding: '4px 8px',
                    flex: 1,
                  }}
                />
              </div>
            </div>
            <div style={{ padding: 0, minHeight: 200 }}>
              {preview ? (
                <iframe
                  srcDoc={preview.html}
                  title="Email preview"
                  style={{
                    width: '100%',
                    minHeight: 600,
                    border: 'none',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 40 }}>
                  Loading preview...
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      {/* Topic selector modal */}
      {showTopicSelector && (
        <TopicSelectorModal
          topics={topics}
          date={date}
          onConfirm={handleCreateFromTemplate}
          onClose={() => setShowTopicSelector(false)}
        />
      )}

      {/* Tweet selector side panel */}
      {tweetSelectorTopicId && (() => {
        const topic = topics.find(t => t.id === tweetSelectorTopicId)
        if (!topic) return null
        const includedTweetIds = new Set(
          blocks
            .filter(b => b.type === 'tweet' && topic.tweets.some(t => t.id === b.tweet_id))
            .map(b => b.tweet_id!)
        )
        return (
          <TweetSelectorPanel
            topic={topic}
            includedTweetIds={includedTweetIds}
            onToggleTweet={(tweetId, include) => {
              if (include) {
                // Find the last block that belongs to this topic's section
                const topicHeaderIdx = blocks.findIndex(
                  b => b.type === 'topic-header' && b.topic_id === tweetSelectorTopicId
                )
                // Find last tweet/text block before next topic-header or divider
                let insertIdx = topicHeaderIdx + 1
                for (let i = topicHeaderIdx + 1; i < blocks.length; i++) {
                  if (blocks[i].type === 'topic-header' || blocks[i].type === 'divider') break
                  insertIdx = i + 1
                }
                const newBlock: DigestBlock = {
                  id: nextBlockId(),
                  type: 'tweet',
                  tweet_id: tweetId,
                }
                setBlocks(prev => [
                  ...prev.slice(0, insertIdx),
                  newBlock,
                  ...prev.slice(insertIdx),
                ])
                triggerAutoSave()
              } else {
                // Remove the tweet block
                setBlocks(prev => prev.filter(b => !(b.type === 'tweet' && b.tweet_id === tweetId)))
                triggerAutoSave()
              }
            }}
            onClose={() => setTweetSelectorTopicId(null)}
          />
        )
      })()}

      {/* Drafts modal */}
      {showDraftsModal && drafts && (
        <DraftsModal
          drafts={drafts}
          selectedDraftId={selectedDraftId}
          onSelect={(id) => setSelectedDraftId(id)}
          onClose={() => setShowDraftsModal(false)}
          onCreate={(newDate) => {
            setDate(newDate)
            setSelectedDraftId(null)
            setBlocks([])
            setShowTopicSelector(true)
          }}
        />
      )}

      {/* Send confirm modal */}
      {showSendConfirm && subscribers && (
        <SendConfirmModal
          subscribers={subscribers}
          onConfirm={handleSendConfirm}
          onClose={() => setShowSendConfirm(false)}
        />
      )}

      {/* Subscribers modal */}
      {showSubs && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => { setShowSubs(false); setSubSearch('') }}
        >
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              width: 420,
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                  Subscribers{subscribers ? ` (${subscribers.filter(s => !s.unsubscribed_at).length})` : ''}
                </h3>
                <button
                  onClick={() => { setShowSubs(false); setSubSearch('') }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 18, cursor: 'pointer' }}
                >
                  &times;
                </button>
              </div>
              <input
                type="text"
                placeholder="Search subscribers..."
                value={subSearch}
                onChange={(e) => setSubSearch(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                  fontFamily: 'var(--font-body)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px' }}>
              {!subscribers ? (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 20 }}>Loading...</div>
              ) : (
                subscribers
                  .filter(s => s.email.toLowerCase().includes(subSearch.toLowerCase()))
                  .map(s => (
                    <div
                      key={s.id}
                      style={{
                        padding: '8px 10px',
                        fontSize: 13,
                        color: s.unsubscribed_at ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderRadius: 'var(--radius-sm)',
                        textDecoration: s.unsubscribed_at ? 'line-through' : 'none',
                      }}
                    >
                      <span>{s.email}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {new Date(s.subscribed_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



const inputStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 12px',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: 'var(--font-body)',
  outline: 'none',
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--text-primary)',
  margin: 0,
}

const markdownTextareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '12px 14px',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace',
  resize: 'vertical',
  outline: 'none',
  lineHeight: 1.7,
  letterSpacing: '-0.01em',
}

const addBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px dashed var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  transition: 'all 0.15s ease',
}

const smallBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px dashed var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-tertiary)',
  padding: '2px 8px',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  lineHeight: '18px',
}

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  marginBottom: 4,
  background: 'var(--bg-raised)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  zIndex: 100,
  padding: 4,
  minWidth: 220,
  maxHeight: 300,
  overflowY: 'auto',
}

const dropdownItemStyle: React.CSSProperties = {
  padding: '8px 12px',
  cursor: 'pointer',
  borderRadius: 6,
  fontSize: 13,
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

function buttonStyle(bg: string, outline = false): React.CSSProperties {
  return {
    background: outline ? 'transparent' : bg,
    color: outline ? 'var(--text-secondary)' : '#fff',
    border: outline ? '1px solid var(--border)' : 'none',
    borderRadius: 'var(--radius-md)',
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    transition: 'opacity 0.15s ease',
  }
}
