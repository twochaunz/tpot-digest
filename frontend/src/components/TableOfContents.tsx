import { useEffect, useRef } from 'react'
import { useTopics } from '../api/topics'
import { useTweets } from '../api/tweets'

interface TableOfContentsProps {
  date: string
  search: string
  onClose: () => void
}

export function TableOfContents({ date, search, onClose }: TableOfContentsProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const topicsQuery = useTopics(date)
  const unsortedQuery = useTweets({ date, unassigned: true, q: search || undefined })

  const topics = topicsQuery.data ?? []
  const unsortedTweets = unsortedQuery.data ?? []

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
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
          minWidth: 280,
          maxWidth: 400,
          maxHeight: '70vh',
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
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Unsorted entry (only if tweets exist) */}
          {unsortedTweets.length > 0 && (
            <TOCEntry
              label="Unsorted"
              count={unsortedTweets.length}
              onClick={() => scrollToSection('toc-unsorted')}
            />
          )}

          {/* Topic entries */}
          {topics.map((topic) => (
            <TopicTOCEntry
              key={topic.id}
              topic={topic}
              date={date}
              search={search}
              onClick={() => scrollToSection(`toc-topic-${topic.id}`)}
            />
          ))}

          {/* Empty state */}
          {unsortedTweets.length === 0 && topics.length === 0 && (
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

function TopicTOCEntry({
  topic,
  date,
  search,
  onClick,
}: {
  topic: { id: number; title: string; color: string | null }
  date: string
  search: string
  onClick: () => void
}) {
  const tweetsQuery = useTweets({ date, topic_id: topic.id, q: search || undefined })
  const count = tweetsQuery.data?.length ?? 0

  return (
    <TOCEntry
      label={topic.title}
      color={topic.color}
      count={count}
      onClick={onClick}
    />
  )
}

function TOCEntry({
  label,
  count,
  color,
  onClick,
}: {
  label: string
  count?: number
  color?: string | null
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '10px 20px',
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
      {/* Color dot for topics */}
      {color && (
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }} />
      )}
      <span style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {count !== undefined && (
        <span style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
          fontWeight: 500,
        }}>
          {count}
        </span>
      )}
    </button>
  )
}
