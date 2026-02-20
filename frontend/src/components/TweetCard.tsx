import { useState } from 'react'
import type { Tweet } from '../api/tweets'

interface TweetCardProps {
  tweet: Tweet
  selected: boolean
  onToggle: (id: number) => void
  selectable?: boolean
  onTweetClick?: (tweet: Tweet) => void
}

function screenshotUrl(path: string | null): string | null {
  if (!path) return null
  return `/api/screenshots/${path}`
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '...'
}

export function TweetCard({ tweet, selected, onToggle, selectable = true, onTweetClick }: TweetCardProps) {
  const [imgError, setImgError] = useState(false)
  const [hovered, setHovered] = useState(false)

  const ssUrl = screenshotUrl(tweet.screenshot_path)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 164,
        background: hovered ? 'var(--bg-hover)' : 'var(--bg-raised)',
        border: selected
          ? '1.5px solid var(--accent)'
          : `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        cursor: selectable ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
        flexShrink: 0,
      }}
      onClick={() => {
        if (onTweetClick) {
          onTweetClick(tweet)
        } else if (selectable) {
          onToggle(tweet.id)
        }
      }}
    >
      {/* Screenshot thumbnail */}
      <div
        style={{
          width: '100%',
          height: 120,
          background: 'var(--bg-elevated)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {ssUrl && !imgError ? (
          <img
            src={ssUrl}
            alt={`Tweet by ${tweet.author_handle}`}
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
            }}
          >
            no screenshot
          </div>
        )}

        {/* Checkbox overlay */}
        {selectable && (
          <div
            onClick={(e) => {
              e.stopPropagation()
              onToggle(tweet.id)
            }}
            style={{
              position: 'absolute',
              top: 6,
              left: 6,
              width: 18,
              height: 18,
              borderRadius: 'var(--radius-sm)',
              border: selected ? 'none' : '1.5px solid rgba(255,255,255,0.4)',
              background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: '#fff',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {selected && '\u2713'}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '8px 10px' }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-primary)',
            marginBottom: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          @{tweet.author_handle}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {truncate(tweet.text, 80)}
        </div>
      </div>
    </div>
  )
}
