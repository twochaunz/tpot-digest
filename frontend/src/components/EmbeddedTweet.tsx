import { useState } from 'react'
import { Tweet } from 'react-tweet'
import type { Tweet as TweetData } from '../api/tweets'

interface EmbeddedTweetProps {
  tweet: TweetData
  onTweetClick?: (tweet: TweetData) => void
  onContextMenu?: (e: React.MouseEvent, tweet: TweetData) => void
  onDelete?: (id: number) => void
}

function FallbackCard({ tweet }: { tweet: TweetData }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {tweet.author_avatar_url ? (
          <img
            src={tweet.author_avatar_url}
            alt={tweet.author_handle}
            style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-elevated)' }} />
        )}
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {tweet.author_display_name || `@${tweet.author_handle}`}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>@{tweet.author_handle}</div>
        </div>
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {tweet.text}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
        Tweet unavailable — showing cached data
      </div>
    </div>
  )
}

export function EmbeddedTweet({ tweet, onTweetClick, onContextMenu, onDelete }: EmbeddedTweetProps) {
  const [hovered, setHovered] = useState(false)
  const [embedError, setEmbedError] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault()
              onContextMenu(e, tweet)
            }
          : undefined
      }
      onClick={() => onTweetClick?.(tweet)}
      style={{
        position: 'relative',
        cursor: onTweetClick ? 'pointer' : 'default',
        maxWidth: 550,
      }}
    >
      {!embedError ? (
        <div data-theme="dark">
          <Tweet
            id={tweet.tweet_id}
            onError={() => setEmbedError(true)}
          />
        </div>
      ) : (
        <FallbackCard tweet={tweet} />
      )}

      {hovered && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            gap: 4,
            zIndex: 2,
          }}
        >
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(tweet.id)
              }}
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(0,0,0,0.6)',
                border: 'none',
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Remove tweet"
            >
              &times;
            </button>
          )}
          {tweet.url && (
            <a
              href={tweet.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(0,0,0,0.6)',
                border: 'none',
                color: '#fff',
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
              }}
              title="Open on X"
            >
              &#8599;
            </a>
          )}
        </div>
      )}
    </div>
  )
}
