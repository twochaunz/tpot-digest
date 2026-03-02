import { useEffect, useRef } from 'react'
import { useDayBundle } from '../api/dayBundle'
import { sortTopics } from '../utils/topics'
import { useIsMobile } from '../hooks/useMediaQuery'

interface TableOfContentsProps {
  date: string
  search: string
  onClose: () => void
}

export function TableOfContents({ date, search, onClose }: TableOfContentsProps) {
  const isMobile = useIsMobile()
  const overlayRef = useRef<HTMLDivElement>(null)
  const bundleQuery = useDayBundle(date)
  const bundle = bundleQuery.data

  const topics = bundle?.topics ?? []
  const unsortedTweets = bundle?.unsorted ?? []

  // Client-side search filtering (counts only)
  const q = search?.toLowerCase() || ''
  const filteredUnsorted = q
    ? unsortedTweets.filter((t) =>
        t.text.toLowerCase().includes(q) ||
        t.author_handle.toLowerCase().includes(q) ||
        (t.author_display_name?.toLowerCase().includes(q) ?? false)
      )
    : unsortedTweets

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  const scrollToSection = (id: string) => {
    onClose()
    // Small delay so overlay unmounts before scroll
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      if (!el) return
      // Scroll within the feed panel to avoid pushing the page header off screen
      const feedPanel = el.closest<HTMLElement>('[data-active-feed]')
        ?? document.querySelector<HTMLElement>('[data-active-feed="true"]')
      if (feedPanel) {
        const panelTop = feedPanel.getBoundingClientRect().top
        feedPanel.scrollTo({
          top: feedPanel.scrollTop + el.getBoundingClientRect().top - panelTop,
          behavior: 'smooth',
        })
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 0',
          minWidth: isMobile ? undefined : 360,
          maxWidth: isMobile ? 400 : 520,
          width: '90vw',
          maxHeight: '80vh',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px 12px',
            borderBottom: '1px solid var(--border)',
            marginBottom: 8,
          }}
        >
          <span style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            Table of Contents
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-tertiary)',
              fontSize: 18,
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Entries */}
        <div key={date} style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Unsorted entry (only if tweets exist) */}
          {filteredUnsorted.length > 0 && (
            <TOCEntry
              label="Unsorted"
              count={filteredUnsorted.length}
              onClick={() => scrollToSection('toc-unsorted')}
              wrap={isMobile}
            />
          )}

          {/* Topic entries */}
          {sortTopics(topics).map((topic) => {
            const count = q
              ? topic.tweets.filter((t) =>
                  t.text.toLowerCase().includes(q) ||
                  t.author_handle.toLowerCase().includes(q) ||
                  (t.author_display_name?.toLowerCase().includes(q) ?? false)
                ).length
              : topic.tweets.length
            return (
              <TOCEntry
                key={topic.id}
                label={topic.title}
                color={topic.color}
                count={count}
                onClick={() => scrollToSection(`toc-topic-${topic.id}`)}
                wrap={isMobile}
              />
            )
          })}

          {/* Empty state */}
          {filteredUnsorted.length === 0 && topics.length === 0 && (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--text-tertiary)',
            }}>
              No sections for this day
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TOCEntry({
  label,
  count,
  color,
  onClick,
  wrap,
}: {
  label: string
  count?: number
  color?: string | null
  onClick: () => void
  wrap?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: wrap ? 'flex-start' : 'center',
        gap: 10,
        width: '100%',
        padding: wrap ? '12px 20px' : '10px 20px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        color: 'var(--text-primary)',
        fontSize: 14,
        fontFamily: 'var(--font-body)',
        transition: 'background 0.1s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'none'
      }}
    >
      {/* Color dot with count */}
      {count !== undefined && (
        <span style={{
          minWidth: 20,
          height: 20,
          borderRadius: 10,
          background: color || 'var(--accent)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: '#fff',
          padding: '0 5px',
          marginTop: wrap ? 1 : 0,
        }}>
          {count}
        </span>
      )}
      <span
        title={label}
        style={{
          flex: 1,
          overflow: wrap ? undefined : 'hidden',
          textOverflow: wrap ? undefined : 'ellipsis',
          whiteSpace: wrap ? 'normal' : 'nowrap',
          lineHeight: wrap ? 1.4 : undefined,
        }}
      >
        {label}
      </span>
    </button>
  )
}
