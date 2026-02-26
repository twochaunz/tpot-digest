import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Tweet } from '../api/tweets'
import { CATEGORIES, getCategoryDef } from '../constants/categories'

interface ContextMenuProps {
  x: number
  y: number
  tweet: Tweet
  topicId?: number
  onClose: () => void
  onDelete: (tweetId: number) => void
  onMoveToDate: (tweetId: number, date: string) => void
  onSetOg?: (topicId: number, tweetId: number | null) => void
  ogTweetId?: number | null
  onSetCategory?: (tweetId: number, topicId: number, category: string | null) => void
  topics?: { id: number; title: string; color: string | null }[]
  onMoveToTopic?: (tweetId: number, fromTopicId: number, toTopicId: number) => void
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}
function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

function MiniCalendar({ onPick }: { onPick: (date: string) => void }) {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [hoveredDay, setHoveredDay] = useState<number | null>(null)

  const totalDays = daysInMonth(viewYear, viewMonth)
  const startDay = firstDayOfWeek(viewYear, viewMonth)

  const todayYear = now.getFullYear()
  const todayMonth = now.getMonth()
  const todayDay = now.getDate()

  const goPrev = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) { setViewYear((y) => y - 1); return 11 }
      return m - 1
    })
  }, [])
  const goNext = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) { setViewYear((y) => y + 1); return 0 }
      return m + 1
    })
  }, [])

  return (
    <div style={{ padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <button
          onClick={goPrev}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}
        >
          &#8249;
        </button>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', userSelect: 'none' }}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          onClick={goNext}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}
        >
          &#8250;
        </button>
      </div>
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, marginBottom: 2 }}>
        {DAY_HEADERS.map((d) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', padding: '2px 0', userSelect: 'none' }}>
            {d}
          </div>
        ))}
      </div>
      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0 }}>
        {Array.from({ length: startDay }).map((_, i) => (
          <div key={`e-${i}`} style={{ width: 28, height: 28 }} />
        ))}
        {Array.from({ length: totalDays }).map((_, i) => {
          const day = i + 1
          const isToday = viewYear === todayYear && viewMonth === todayMonth && day === todayDay
          const isHovered = hoveredDay === day
          let bg = 'transparent'
          if (isHovered) bg = 'var(--bg-hover)'
          else if (isToday) bg = 'var(--bg-elevated)'

          return (
            <div
              key={day}
              onClick={() => {
                const mm = String(viewMonth + 1).padStart(2, '0')
                const dd = String(day).padStart(2, '0')
                onPick(`${viewYear}-${mm}-${dd}`)
              }}
              onMouseEnter={() => setHoveredDay(day)}
              onMouseLeave={() => setHoveredDay(null)}
              style={{
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                fontSize: 11,
                fontWeight: isToday ? 600 : 400,
                color: 'var(--text-primary)',
                background: bg,
                cursor: 'pointer',
                transition: 'background 0.1s ease',
                userSelect: 'none',
              }}
            >
              {day}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ContextMenu({ x, y, tweet, topicId, onClose, onDelete, onMoveToDate, onSetOg, ogTweetId, onSetCategory, topics, onMoveToTopic }: ContextMenuProps) {
  const [showCalendar, setShowCalendar] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [focusedCatIndex, setFocusedCatIndex] = useState(-1)
  const [showTopics, setShowTopics] = useState(false)
  const [focusedTopicIndex, setFocusedTopicIndex] = useState(-1)
  const menuRef = useRef<HTMLDivElement>(null)

  // Position with edge detection
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let nx = x, ny = y
    if (x + rect.width > window.innerWidth - 8) nx = window.innerWidth - rect.width - 8
    if (y + rect.height > window.innerHeight - 8) ny = window.innerHeight - rect.height - 8
    if (nx < 8) nx = 8
    if (ny < 8) ny = 8
    setPos({ x: nx, y: ny })
  }, [x, y, showCalendar])

  // Reset focused index when submenu opens/closes
  useEffect(() => {
    if (showCategories) {
      const currentIdx = CATEGORIES.findIndex((c) => c.key === tweet.category)
      setFocusedCatIndex(currentIdx >= 0 ? currentIdx : 0)
    } else {
      setFocusedCatIndex(-1)
    }
  }, [showCategories, tweet.category])

  useEffect(() => {
    if (showTopics) {
      setFocusedTopicIndex(0)
    } else {
      setFocusedTopicIndex(-1)
    }
  }, [showTopics])

  // Total items in category submenu (categories + optional "Remove" item)
  const catItemCount = CATEGORIES.length + (tweet.category ? 1 : 0)

  // Filtered topics for move submenu (exclude current topic)
  const filteredTopics = (topics ?? []).filter((t) => t.id !== topicId)
  const showMoveToTopic = !!(onMoveToTopic && filteredTopics.length + (topicId ? 1 : 0) > 0)
  // Total items: filtered topics + optional "Move to unsorted"
  const topicItemCount = filteredTopics.length + (topicId ? 1 : 0)

  // Close on outside click or Escape; arrow/enter for category submenu
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showCategories) {
          setShowCategories(false)
          e.stopPropagation()
        } else if (showTopics) {
          setShowTopics(false)
          e.stopPropagation()
        } else {
          onClose()
        }
        return
      }

      if (showCategories) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setFocusedCatIndex((i) => (i + 1) % catItemCount)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusedCatIndex((i) => (i - 1 + catItemCount) % catItemCount)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (focusedCatIndex >= 0 && focusedCatIndex < CATEGORIES.length) {
            onSetCategory?.(tweet.id, topicId!, CATEGORIES[focusedCatIndex].key)
            onClose()
          } else if (focusedCatIndex === CATEGORIES.length && tweet.category) {
            onSetCategory?.(tweet.id, topicId!, null)
            onClose()
          }
        }
      }

      if (showTopics) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setFocusedTopicIndex((i) => (i + 1) % topicItemCount)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusedTopicIndex((i) => (i - 1 + topicItemCount) % topicItemCount)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (focusedTopicIndex >= 0 && focusedTopicIndex < filteredTopics.length) {
            onMoveToTopic?.(tweet.id, topicId ?? 0, filteredTopics[focusedTopicIndex].id)
            onClose()
          } else if (focusedTopicIndex === filteredTopics.length && topicId) {
            onMoveToTopic?.(tweet.id, topicId, 0)
            onClose()
          }
        }
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose, showCategories, catItemCount, focusedCatIndex, showTopics, topicItemCount, focusedTopicIndex, filteredTopics, tweet.id, tweet.category, topicId, onSetCategory, onMoveToTopic])

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '7px 12px',
    background: 'none',
    border: 'none',
    color: 'var(--text-primary)',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'var(--font-body)',
    borderRadius: 'var(--radius-sm)',
    transition: 'background 0.1s ease',
  }

  const menu = (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 100,
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        padding: 4,
        minWidth: 180,
      }}
    >
      {/* Move to date */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowCalendar((v) => !v) }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
        style={itemStyle}
      >
        <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>&#128197;</span>
        Move to date...
      </button>

      {showCalendar && (
        <MiniCalendar
          onPick={(date) => {
            onMoveToDate(tweet.id, date)
            onClose()
          }}
        />
      )}

      {/* Set / Remove OG Post */}
      {onSetOg && topicId && (
        <button
          onClick={() => {
            onSetOg(topicId, ogTweetId === tweet.id ? null : tweet.id)
            onClose()
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
          style={{ ...itemStyle, color: '#F59E0B' }}
        >
          <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>{ogTweetId === tweet.id ? '\u2716' : '\u2B50'}</span>
          {ogTweetId === tweet.id ? 'Remove OG' : 'Set as OG Post'}
        </button>
      )}

      {/* Move to topic */}
      {showMoveToTopic && (
        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setShowTopics(true)}
          onMouseLeave={() => setShowTopics(false)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setShowTopics((v) => !v) }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
            style={{ ...itemStyle, justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>&#128194;</span>
              Move to topic
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>&#9654;</span>
          </button>

          {showTopics && (
            <div
              style={{
                position: 'absolute',
                left: '100%',
                top: 0,
                zIndex: 101,
                background: 'var(--bg-raised)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                padding: 4,
                minWidth: 160,
              }}
            >
              {filteredTopics.map((topic, idx) => (
                <button
                  key={topic.id}
                  onClick={() => {
                    onMoveToTopic!(tweet.id, topicId ?? 0, topic.id)
                    onClose()
                  }}
                  onMouseEnter={() => setFocusedTopicIndex(idx)}
                  onMouseLeave={() => setFocusedTopicIndex(-1)}
                  style={{
                    ...itemStyle,
                    background: focusedTopicIndex === idx ? 'var(--bg-hover)' : 'none',
                  }}
                >
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: topic.color ?? 'var(--text-tertiary)',
                    flexShrink: 0,
                  }} />
                  {topic.title}
                </button>
              ))}

              {/* Move to unsorted option */}
              {topicId && (
                <>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
                  <button
                    onClick={() => {
                      onMoveToTopic!(tweet.id, topicId, 0)
                      onClose()
                    }}
                    onMouseEnter={() => setFocusedTopicIndex(filteredTopics.length)}
                    onMouseLeave={() => setFocusedTopicIndex(-1)}
                    style={{
                      ...itemStyle,
                      color: 'var(--text-tertiary)',
                      background: focusedTopicIndex === filteredTopics.length ? 'var(--bg-hover)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>&#10005;</span>
                    Move to unsorted
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Set Category */}
      {onSetCategory && topicId && (
        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setShowCategories(true)}
          onMouseLeave={() => setShowCategories(false)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setShowCategories((v) => !v) }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
            style={{ ...itemStyle, justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>&#9776;</span>
              {tweet.category ? getCategoryDef(tweet.category).label : 'Set Category'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>&#9654;</span>
          </button>

          {showCategories && (
            <div
              style={{
                position: 'absolute',
                left: '100%',
                top: 0,
                zIndex: 101,
                background: 'var(--bg-raised)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                padding: 4,
                minWidth: 160,
              }}
            >
              {CATEGORIES.map((cat, idx) => (
                <button
                  key={cat.key}
                  onClick={() => {
                    onSetCategory(tweet.id, topicId, cat.key)
                    onClose()
                  }}
                  onMouseEnter={() => setFocusedCatIndex(idx)}
                  onMouseLeave={() => setFocusedCatIndex(-1)}
                  style={{
                    ...itemStyle,
                    fontWeight: tweet.category === cat.key ? 600 : 400,
                    background: focusedCatIndex === idx ? 'var(--bg-hover)' : 'none',
                  }}
                >
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: cat.color,
                    flexShrink: 0,
                  }} />
                  {cat.label}
                </button>
              ))}

              {/* Remove category option */}
              {tweet.category && (
                <>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
                  <button
                    onClick={() => {
                      onSetCategory(tweet.id, topicId, null)
                      onClose()
                    }}
                    onMouseEnter={() => setFocusedCatIndex(CATEGORIES.length)}
                    onMouseLeave={() => setFocusedCatIndex(-1)}
                    style={{
                      ...itemStyle,
                      color: 'var(--text-tertiary)',
                      background: focusedCatIndex === CATEGORIES.length ? 'var(--bg-hover)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>&#10005;</span>
                    Remove Category
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />

      {/* Open on X */}
      {tweet.url && (
        <button
          onClick={() => { window.open(tweet.url!, '_blank', 'noopener,noreferrer'); onClose() }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
          style={itemStyle}
        >
          <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>&#8599;</span>
          Open on X
        </button>
      )}

      {/* Delete */}
      <button
        onClick={() => { onDelete(tweet.id); onClose() }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
        style={{ ...itemStyle, color: 'var(--danger, #e53e3e)' }}
      >
        <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>&#128465;</span>
        Delete
      </button>
    </div>
  )

  return createPortal(menu, document.body)
}
