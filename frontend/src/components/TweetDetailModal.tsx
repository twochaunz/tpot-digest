import { useEffect, useRef, useState } from 'react'
import type { Tweet } from '../api/tweets'
import { useTweets } from '../api/tweets'
import { CropTool } from './CropTool'

interface TweetDetailModalProps {
  tweet: Tweet
  onClose: () => void
}

function screenshotUrl(path: string | null): string | null {
  if (!path) return null
  return `/api/screenshots/${path}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function ThreadList({ threadId, currentTweetId }: { threadId: string; currentTweetId: number }) {
  const { data: threadTweets } = useTweets({ thread_id: threadId })

  if (!threadTweets || threadTweets.length <= 1) return null

  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 12,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-secondary)',
          marginBottom: 10,
        }}
      >
        Thread ({threadTweets.length} tweets)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {threadTweets.map((t) => (
          <div
            key={t.id}
            style={{
              fontSize: 12,
              color:
                t.id === currentTweetId
                  ? 'var(--accent-hover)'
                  : 'var(--text-tertiary)',
              padding: '4px 8px',
              background:
                t.id === currentTweetId
                  ? 'var(--accent-muted)'
                  : 'transparent',
              borderRadius: 'var(--radius-sm)',
              lineHeight: 1.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t.thread_position != null && (
              <span style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>
                #{t.thread_position}
              </span>
            )}
            {t.text.slice(0, 100)}
            {t.text.length > 100 ? '...' : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

export function TweetDetailModal({ tweet, onClose }: TweetDetailModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [showCrop, setShowCrop] = useState(false)

  const ssUrl = screenshotUrl(tweet.screenshot_path)

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Prevent body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Click outside to close
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  const engagement = tweet.engagement

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
        padding: 24,
      }}
    >
      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          maxWidth: 720,
          width: '100%',
          maxHeight: 'calc(100vh - 48px)',
          overflow: 'auto',
          position: 'relative',
          boxShadow: 'var(--shadow)',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'sticky',
            top: 0,
            float: 'right',
            zIndex: 10,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            fontSize: 16,
            margin: '12px 12px 0 0',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = 'var(--text-primary)')
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = 'var(--text-secondary)')
          }
          aria-label="Close"
        >
          &#10005;
        </button>

        {/* Content */}
        <div style={{ padding: '20px 24px 24px' }}>
          {/* Author info */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}
            >
              {tweet.author_display_name || `@${tweet.author_handle}`}
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                marginTop: 2,
              }}
            >
              @{tweet.author_handle}
            </div>
          </div>

          {/* Tweet text */}
          <div
            style={{
              fontSize: 14,
              color: 'var(--text-primary)',
              lineHeight: 1.6,
              marginBottom: 16,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {tweet.text}
          </div>

          {/* Engagement stats */}
          {engagement && (
            <div
              style={{
                display: 'flex',
                gap: 20,
                marginBottom: 16,
                padding: '10px 0',
                borderTop: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <Stat label="Likes" value={engagement.likes} />
              <Stat label="Retweets" value={engagement.retweets} />
              <Stat label="Replies" value={engagement.replies} />
            </div>
          )}

          {/* Metadata row */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 20,
              fontSize: 12,
              color: 'var(--text-tertiary)',
            }}
          >
            <span>Saved {formatDate(tweet.saved_at)}</span>
            {tweet.is_quote_tweet && (
              <span
                style={{
                  background: 'var(--bg-elevated)',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Quote Tweet
              </span>
            )}
            {tweet.is_reply && (
              <span
                style={{
                  background: 'var(--bg-elevated)',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Reply
              </span>
            )}
            {tweet.feed_source && (
              <span
                style={{
                  background: 'var(--bg-elevated)',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {tweet.feed_source}
              </span>
            )}
          </div>

          {/* Thread */}
          {tweet.thread_id && (
            <div style={{ marginBottom: 20 }}>
              <ThreadList
                threadId={tweet.thread_id}
                currentTweetId={tweet.id}
              />
            </div>
          )}

          {/* Screenshot */}
          {ssUrl && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Screenshot
                </span>
                <button
                  onClick={() => setShowCrop((v) => !v)}
                  style={{
                    background: showCrop
                      ? 'var(--accent-muted)'
                      : 'var(--bg-elevated)',
                    border: `1px solid ${showCrop ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)',
                    color: showCrop
                      ? 'var(--accent-hover)'
                      : 'var(--text-secondary)',
                    padding: '5px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {showCrop ? 'Hide Crop Tool' : 'Crop'}
                </button>
              </div>

              {showCrop ? (
                <CropTool imageUrl={ssUrl} />
              ) : (
                <img
                  src={ssUrl}
                  alt={`Screenshot of tweet by @${tweet.author_handle}`}
                  style={{
                    width: '100%',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                    display: 'block',
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        {formatCount(value)}
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-tertiary)',
          marginTop: 1,
        }}
      >
        {label}
      </div>
    </div>
  )
}
