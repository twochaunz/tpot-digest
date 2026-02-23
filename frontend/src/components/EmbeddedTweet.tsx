import { useState } from 'react'
import type { Tweet as TweetData } from '../api/tweets'

interface EmbeddedTweetProps {
  tweet: TweetData
  onTweetClick?: (tweet: TweetData) => void
  onContextMenu?: (e: React.MouseEvent, tweet: TweetData) => void
  onDelete?: (id: number) => void
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function EmbeddedTweet({ tweet, onTweetClick, onContextMenu, onDelete }: EmbeddedTweetProps) {
  const [hovered, setHovered] = useState(false)

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
        padding: '14px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Author row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        {tweet.author_avatar_url ? (
          <img
            src={tweet.author_avatar_url}
            alt={tweet.author_handle}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--bg-elevated)',
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tweet.author_display_name || tweet.author_handle}
          </span>
          {tweet.author_verified && (
            <span style={{ color: 'var(--accent)', fontSize: 13, flexShrink: 0 }} title="Verified">
              &#10003;
            </span>
          )}
          <span style={{ fontSize: 13, color: 'var(--text-tertiary)', flexShrink: 0 }}>
            @{tweet.author_handle}
          </span>
          {tweet.created_at && (
            <>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>·</span>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                {formatRelativeTime(tweet.created_at)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Tweet text */}
      <div
        style={{
          fontSize: 15,
          color: 'var(--text-primary)',
          lineHeight: 1.6,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {tweet.text}
      </div>

      {/* Media images */}
      {tweet.media_urls && tweet.media_urls.length > 0 && (
        <div
          style={{
            marginTop: 10,
            display: 'grid',
            gridTemplateColumns: tweet.media_urls.length === 1 ? '1fr' : '1fr 1fr',
            gap: 4,
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {tweet.media_urls
            .filter((m) => m.type === 'photo' || m.type === 'animated_gif')
            .slice(0, 4)
            .map((media, i) => (
              <img
                key={i}
                src={media.url}
                alt=""
                style={{
                  width: '100%',
                  maxHeight: 300,
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
            ))}
        </div>
      )}

      {/* Hover actions */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 0,
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
