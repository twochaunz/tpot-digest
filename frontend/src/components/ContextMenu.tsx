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

export function ContextMenu({ x, y, tweet, topicId, onClose, onDelete, onMoveToDate, onSetOg, ogTweetId, onSetCategory }: ContextMenuProps) {
  const [showCalendar, setShowCalendar] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
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

  // Close on outside click or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

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
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => {
                    onSetCategory(tweet.id, topicId, cat.key)
                    onClose()
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                  style={{
                    ...itemStyle,
                    fontWeight: tweet.category === cat.key ? 600 : 400,
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
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                    style={{ ...itemStyle, color: 'var(--text-tertiary)' }}
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
