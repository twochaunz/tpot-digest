import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Tweet } from '../api/tweets'
import { DatePicker } from '../components/DatePicker'
import { DayCarousel } from '../components/DayCarousel'
import { TweetDetailModal } from '../components/TweetDetailModal'
import { TableOfContents } from '../components/TableOfContents'

function defaultDateStr(): string {
  // Use PST (UTC-8) to determine time of day
  const now = new Date()
  const pstHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).getHours()
  // Before noon PST, default to yesterday
  const d = pstHour < 12 ? new Date(now.getTime() - 86400000) : now
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function DailyView() {
  const navigate = useNavigate()
  const [date, setDate] = useState(defaultDateStr)
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [detailTweet, setDetailTweet] = useState<Tweet | null>(null)
  const [tocOpen, setTocOpen] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA'

      if ((e.key === 't' || e.key === 'T') && !isInput) {
        e.preventDefault()
        setTocOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur()
      }

      // Return / Shift+Return: navigate between topic sections
      if (e.key === 'Enter' && !isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const topics = Array.from(document.querySelectorAll<HTMLElement>('[id^="toc-topic-"]'))
        if (topics.length === 0) return

        // Find the scrollable parent (DayFeedPanel's overflow container)
        const scrollParent = topics[0].closest<HTMLElement>('[style*="overflow"]') || topics[0].parentElement?.parentElement
        if (!scrollParent) return

        const parentRect = scrollParent.getBoundingClientRect()
        const threshold = parentRect.top + 60 // offset past header

        if (e.shiftKey) {
          // Shift+Return: go to previous topic
          // Find the last topic whose top is above the current scroll position
          for (let i = topics.length - 1; i >= 0; i--) {
            const rect = topics[i].getBoundingClientRect()
            if (rect.top < threshold - 10) {
              topics[i].scrollIntoView({ behavior: 'smooth', block: 'start' })
              e.preventDefault()
              return
            }
          }
        } else {
          // Return: go to next topic
          // Find the first topic whose top is below the current scroll position
          for (const topic of topics) {
            const rect = topic.getBoundingClientRect()
            if (rect.top > threshold + 10) {
              topic.scrollIntoView({ behavior: 'smooth', block: 'start' })
              e.preventDefault()
              return
            }
          }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleTweetClick = useCallback((tweet: Tweet) => {
    setDetailTweet(tweet)
  }, [])

  return (
    <div
      style={{
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg-base)',
        display: 'flex',
        flexDirection: 'column' as const,
      }}
    >
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
            maxWidth: 1400,
            margin: '0 auto',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {/* Left: empty for balance */}
          <div style={{ flex: 1 }} />

          {/* Center: date picker */}
          <DatePicker value={date} onChange={setDate} />

          {/* Right: search + settings */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search tweets"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                style={{
                  width: searchFocused || search ? 240 : 180,
                  background: 'var(--bg-raised)',
                  border: `1px solid ${searchFocused ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '7px 12px 7px 32px',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  fontFamily: 'var(--font-body)',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-tertiary)',
                  fontSize: 14,
                  pointerEvents: 'none',
                }}
              >
                &#8981;
              </span>
              {/* Cmd+K hint badge */}
              {!searchFocused && !search && (
                <span
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-tertiary)',
                    fontSize: 10,
                    fontFamily: 'var(--font-body)',
                    background: 'var(--bg-elevated)',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    pointerEvents: 'none',
                    border: '1px solid var(--border)',
                  }}
                >
                  &#8984;K
                </span>
              )}
            </div>

            <button
              onClick={() => navigate('/app/settings')}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                width: 34,
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: 16,
                transition: 'all 0.15s ease',
              }}
              aria-label="Settings"
            >
              &#9881;
            </button>
          </div>
        </div>
      </header>

      {/* Day carousel */}
      <DayCarousel
        date={date}
        onDateChange={setDate}
        search={search}
        onTweetClick={handleTweetClick}
      />

      {/* TOC FAB button */}
      {!tocOpen && (
        <button
          onClick={() => setTocOpen(true)}
          aria-label="Table of Contents"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 20,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 50,
            transition: 'all 0.15s ease',
          }}
        >
          &#9776;
        </button>
      )}

      {/* TOC overlay */}
      {tocOpen && (
        <TableOfContents
          date={date}
          search={search}
          onClose={() => setTocOpen(false)}
        />
      )}

      {/* Tweet detail modal */}
      {detailTweet && (
        <TweetDetailModal
          tweet={detailTweet}
          onClose={() => setDetailTweet(null)}
        />
      )}
    </div>
  )
}
