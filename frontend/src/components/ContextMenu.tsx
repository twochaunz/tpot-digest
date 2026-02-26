import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Tweet } from '../api/tweets'
import { CATEGORIES } from '../constants/categories'

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
  topics?: { id: number; title: string; color: string | null; categories?: string[] }[]
  onMoveToTopic?: (tweetId: number, fromTopicId: number, toTopicId: number, category?: string) => void
  onCreateTopicAndMove?: (tweetId: number, fromTopicId: number, title: string) => void
}

export interface TopicContextMenuProps {
  x: number
  y: number
  topicId: number
  topicTitle: string
  onClose: () => void
  onDelete: (topicId: number) => void
  onMoveToDate: (topicId: number, date: string) => void
  onGenerateScript: (topicId: number) => void
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

const menuContainerStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 100,
  background: 'var(--bg-raised)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
  padding: 4,
  minWidth: 180,
}

const iconStyle: React.CSSProperties = { fontSize: 14, width: 18, textAlign: 'center' }

function useMenuPosition(x: number, y: number, menuRef: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, ...deps])
  return pos
}

function useMenuClose(menuRef: React.RefObject<HTMLDivElement | null>, onClose: () => void, onKey?: (e: KeyboardEvent) => void) {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      onKey?.(e)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  })
}

function HoverButton({ style, onClick, children }: { style?: React.CSSProperties; onClick?: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
      style={{ ...itemStyle, ...style }}
    >
      {children}
    </button>
  )
}

// ── Tweet Context Menu ──

export function ContextMenu({ x, y, tweet, topicId, onClose, onDelete, onMoveToDate, onSetOg, ogTweetId, onSetCategory, topics, onMoveToTopic, onCreateTopicAndMove }: ContextMenuProps) {
  const [showCalendar, setShowCalendar] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [focusedCatIndex, setFocusedCatIndex] = useState(-1)
  const [showTopics, setShowTopics] = useState(false)
  const [focusedTopicIndex, setFocusedTopicIndex] = useState(-1)
  const [topicSearch, setTopicSearch] = useState('')
  const [hoveredTopicId, setHoveredTopicId] = useState<number | null>(null)
  const topicInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const pos = useMenuPosition(x, y, menuRef, [showCalendar, showTopics])

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
      setTopicSearch('')
      setTimeout(() => topicInputRef.current?.focus(), 0)
    } else {
      setFocusedTopicIndex(-1)
      setTopicSearch('')
    }
  }, [showTopics])

  // Total items in category submenu (categories + optional "Remove" item)
  const catItemCount = CATEGORIES.length + (tweet.category ? 1 : 0)

  // Filtered topics for move submenu (exclude current topic, filter by search)
  const allFilteredTopics = (topics ?? []).filter((t) => t.id !== topicId)
  const searchFilteredTopics = topicSearch
    ? allFilteredTopics.filter((t) => t.title.toLowerCase().includes(topicSearch.toLowerCase()))
    : allFilteredTopics
  const showMoveToTopic = !!(onMoveToTopic && (allFilteredTopics.length + (topicId ? 1 : 0) > 0 || onCreateTopicAndMove))
  // Check if search matches any existing topic exactly (case-insensitive)
  const exactMatch = topicSearch && allFilteredTopics.some((t) => t.title.toLowerCase() === topicSearch.toLowerCase().trim())
  const showCreateOption = !!(topicSearch.trim() && !exactMatch && onCreateTopicAndMove)
  // Total items: filtered topics + optional "Create new" + optional "Move to unsorted"
  const topicItemCount = searchFilteredTopics.length + (showCreateOption ? 1 : 0) + (topicId && !topicSearch ? 1 : 0)

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
          setFocusedTopicIndex((i) => Math.min(i + 1, topicItemCount - 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusedTopicIndex((i) => Math.max(i - 1, 0))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (focusedTopicIndex >= 0 && focusedTopicIndex < searchFilteredTopics.length) {
            onMoveToTopic?.(tweet.id, topicId ?? 0, searchFilteredTopics[focusedTopicIndex].id)
            onClose()
          } else if (focusedTopicIndex === searchFilteredTopics.length && showCreateOption) {
            onCreateTopicAndMove?.(tweet.id, topicId ?? 0, topicSearch.trim())
            onClose()
          } else {
            const unsortedIdx = searchFilteredTopics.length + (showCreateOption ? 1 : 0)
            if (focusedTopicIndex === unsortedIdx && topicId) {
              onMoveToTopic?.(tweet.id, topicId, 0)
              onClose()
            }
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
  }, [onClose, showCategories, catItemCount, focusedCatIndex, showTopics, topicItemCount, focusedTopicIndex, searchFilteredTopics, showCreateOption, topicSearch, tweet.id, tweet.category, topicId, onSetCategory, onMoveToTopic, onCreateTopicAndMove])

  const submenuStyle: React.CSSProperties = {
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
  }

  const menu = (
    <div
      ref={menuRef}
      style={{ ...menuContainerStyle, left: pos.x, top: pos.y }}
    >
      {/* 1. Category */}
      {onSetCategory && topicId && (
        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setShowCategories(true)}
          onMouseLeave={() => setShowCategories(false)}
        >
          <HoverButton
            onClick={(e) => { e.stopPropagation(); setShowCategories((v) => !v) }}
            style={{ justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={iconStyle}>&#127991;</span>
              Category
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>&#9654;</span>
          </HoverButton>

          {showCategories && (
            <div style={submenuStyle}>
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
                    <span style={iconStyle}>&#10005;</span>
                    Remove Category
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. Topic */}
      {showMoveToTopic && (
        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setShowTopics(true)}
          onMouseLeave={() => setShowTopics(false)}
        >
          <HoverButton
            onClick={(e) => { e.stopPropagation(); setShowTopics((v) => !v) }}
            style={{ justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={iconStyle}>&#128194;</span>
              Topic
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>&#9654;</span>
          </HoverButton>

          {showTopics && (
            <div style={submenuStyle}>
              {/* Search / create input */}
              <div style={{ padding: '4px 4px 4px' }}>
                <input
                  ref={topicInputRef}
                  type="text"
                  placeholder="Search or create..."
                  value={topicSearch}
                  onChange={(e) => { setTopicSearch(e.target.value); setFocusedTopicIndex(0) }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '5px 8px',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    outline: 'none',
                    fontFamily: 'var(--font-body)',
                  }}
                />
              </div>

              {searchFilteredTopics.map((topic, idx) => (
                <div
                  key={topic.id}
                  style={{ position: 'relative' }}
                  onMouseEnter={() => { setFocusedTopicIndex(idx); setHoveredTopicId(topic.id) }}
                  onMouseLeave={() => { setFocusedTopicIndex(-1); setHoveredTopicId(null) }}
                >
                  <button
                    onClick={() => {
                      onMoveToTopic!(tweet.id, topicId ?? 0, topic.id)
                      onClose()
                    }}
                    style={{
                      ...itemStyle,
                      justifyContent: 'space-between',
                      background: focusedTopicIndex === idx ? 'var(--bg-hover)' : 'none',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: topic.color ?? 'var(--text-tertiary)',
                        flexShrink: 0,
                      }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topic.title}</span>
                    </span>
                    {topic.categories && topic.categories.length > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>&#9654;</span>
                    )}
                  </button>

                  {/* Nested category submenu */}
                  {hoveredTopicId === topic.id && topic.categories && topic.categories.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      left: '100%',
                      top: 0,
                      zIndex: 102,
                      background: 'var(--bg-raised)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 'var(--radius-lg)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                      padding: 4,
                      minWidth: 140,
                    }}>
                      {CATEGORIES.filter(c => topic.categories!.includes(c.key)).map((cat) => (
                        <button
                          key={cat.key}
                          onClick={() => {
                            onMoveToTopic!(tweet.id, topicId ?? 0, topic.id, cat.key)
                            onClose()
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                          style={itemStyle}
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
                    </div>
                  )}
                </div>
              ))}

              {/* Create new topic option */}
              {showCreateOption && (
                <>
                  {searchFilteredTopics.length > 0 && (
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
                  )}
                  <button
                    onClick={() => {
                      onCreateTopicAndMove!(tweet.id, topicId ?? 0, topicSearch.trim())
                      onClose()
                    }}
                    onMouseEnter={() => setFocusedTopicIndex(searchFilteredTopics.length)}
                    onMouseLeave={() => setFocusedTopicIndex(-1)}
                    style={{
                      ...itemStyle,
                      color: 'var(--accent)',
                      fontWeight: 500,
                      background: focusedTopicIndex === searchFilteredTopics.length ? 'var(--bg-hover)' : 'none',
                    }}
                  >
                    <span style={iconStyle}>+</span>
                    Create &ldquo;{topicSearch.trim()}&rdquo;
                  </button>
                </>
              )}

              {/* Move to unsorted option */}
              {topicId && !topicSearch && (
                <>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
                  <button
                    onClick={() => {
                      onMoveToTopic!(tweet.id, topicId, 0)
                      onClose()
                    }}
                    onMouseEnter={() => setFocusedTopicIndex(searchFilteredTopics.length + (showCreateOption ? 1 : 0))}
                    onMouseLeave={() => setFocusedTopicIndex(-1)}
                    style={{
                      ...itemStyle,
                      color: 'var(--text-tertiary)',
                      background: focusedTopicIndex === searchFilteredTopics.length + (showCreateOption ? 1 : 0) ? 'var(--bg-hover)' : 'none',
                    }}
                  >
                    <span style={iconStyle}>&#10005;</span>
                    Move to unsorted
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. Date (hover submenu) */}
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setShowCalendar(true)}
        onMouseLeave={() => setShowCalendar(false)}
      >
        <HoverButton
          onClick={(e) => { e.stopPropagation(); setShowCalendar((v) => !v) }}
          style={{ justifyContent: 'space-between' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={iconStyle}>&#128197;</span>
            Date
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>&#9654;</span>
        </HoverButton>

        {showCalendar && (
          <div style={{ ...submenuStyle, minWidth: 220 }}>
            <MiniCalendar
              onPick={(d) => {
                onMoveToDate(tweet.id, d)
                onClose()
              }}
            />
          </div>
        )}
      </div>

      {/* Set / Remove OG Post */}
      {onSetOg && topicId && (
        <HoverButton
          onClick={() => { onSetOg(topicId, ogTweetId === tweet.id ? null : tweet.id); onClose() }}
          style={{ color: '#F59E0B' }}
        >
          <span style={iconStyle}>{ogTweetId === tweet.id ? '\u2716' : '\u2B50'}</span>
          {ogTweetId === tweet.id ? 'Remove OG' : 'Set as OG Post'}
        </HoverButton>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />

      {/* Open on X */}
      {tweet.url && (
        <HoverButton onClick={() => { window.open(tweet.url!, '_blank', 'noopener,noreferrer'); onClose() }}>
          <span style={iconStyle}>&#8599;</span>
          Open on X
        </HoverButton>
      )}

      {/* Delete */}
      <HoverButton onClick={() => { onDelete(tweet.id); onClose() }} style={{ color: 'var(--danger, #e53e3e)' }}>
        <span style={iconStyle}>&#128465;&#65039;</span>
        Delete
      </HoverButton>
    </div>
  )

  return createPortal(menu, document.body)
}

// ── Topic Context Menu ──

export function TopicContextMenu({ x, y, topicId, topicTitle, onClose, onDelete, onMoveToDate, onGenerateScript }: TopicContextMenuProps) {
  const [showCalendar, setShowCalendar] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const pos = useMenuPosition(x, y, menuRef, [showCalendar])
  useMenuClose(menuRef, onClose)

  const menu = (
    <div
      ref={menuRef}
      style={{ ...menuContainerStyle, left: pos.x, top: pos.y }}
    >
      {/* Generate Script */}
      <HoverButton onClick={() => { onGenerateScript(topicId); onClose() }}>
        <span style={iconStyle}>&#9999;&#65039;</span>
        Generate Script
      </HoverButton>

      {/* Move to date (hover submenu) */}
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setShowCalendar(true)}
        onMouseLeave={() => setShowCalendar(false)}
      >
        <HoverButton
          onClick={(e) => { e.stopPropagation(); setShowCalendar((v) => !v) }}
          style={{ justifyContent: 'space-between' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={iconStyle}>&#128197;</span>
            Move to date
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>&#9654;</span>
        </HoverButton>

        {showCalendar && (
          <div style={{
            position: 'absolute',
            left: '100%',
            top: 0,
            zIndex: 101,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            padding: 4,
            minWidth: 220,
          }}>
            <MiniCalendar
              onPick={(date) => {
                onMoveToDate(topicId, date)
                onClose()
              }}
            />
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />

      {/* Delete */}
      <HoverButton
        onClick={() => {
          if (window.confirm(`Delete topic "${topicTitle}"? Tweets will be unassigned.`))
            onDelete(topicId)
          onClose()
        }}
        style={{ color: 'var(--danger, #e53e3e)' }}
      >
        <span style={iconStyle}>&#128465;&#65039;</span>
        Delete
      </HoverButton>
    </div>
  )

  return createPortal(menu, document.body)
}
