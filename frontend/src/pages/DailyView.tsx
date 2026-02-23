import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Tweet } from '../api/tweets'
import { useEngagementToggle } from '../hooks/useEngagementToggle'
import { DatePicker } from '../components/DatePicker'
import { DayCarousel } from '../components/DayCarousel'
import { TweetDetailModal } from '../components/TweetDetailModal'

function todayStr(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function DailyView() {
  const navigate = useNavigate()
  const [date, setDate] = useState(todayStr)
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [detailTweet, setDetailTweet] = useState<Tweet | null>(null)
  const { showEngagement, toggle: toggleEngagement } = useEngagementToggle()

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
          {/* Left: search */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search tweets..."
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
            </div>
          </div>

          {/* Center: date picker */}
          <DatePicker value={date} onChange={setDate} />

          {/* Right: engagement toggle + settings */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            <button
              onClick={toggleEngagement}
              style={{
                background: showEngagement ? 'var(--accent-muted)' : 'none',
                border: `1px solid ${showEngagement ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '5px 10px',
                cursor: 'pointer',
                color: showEngagement ? 'var(--accent-hover)' : 'var(--text-secondary)',
                fontSize: 12,
                fontFamily: 'var(--font-body)',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
              title={showEngagement ? 'Hide engagement stats' : 'Show engagement stats'}
            >
              {showEngagement ? 'Stats ON' : 'Stats OFF'}
            </button>

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

      {/* Tweet detail modal */}
      {detailTweet && (
        <TweetDetailModal
          tweet={detailTweet}
          onClose={() => setDetailTweet(null)}
          showEngagement={showEngagement}
        />
      )}
    </div>
  )
}
