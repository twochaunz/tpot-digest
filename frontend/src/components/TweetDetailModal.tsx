import { useEffect, useRef, useState, useCallback } from 'react'
import { toPng } from 'html-to-image'
import type { Tweet } from '../api/tweets'
import { useTweets, usePatchTweet } from '../api/tweets'
import { useGrokContext } from '../hooks/useGrokContext'
import { CropTool } from './CropTool'

interface TweetDetailModalProps {
  tweet: Tweet
  onClose: () => void
  showEngagement?: boolean
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

function isLegacyTweet(tweet: Tweet): boolean {
  return !tweet.author_avatar_url && !!tweet.screenshot_path
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

export function TweetDetailModal({ tweet, onClose, showEngagement = true }: TweetDetailModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const cleanRef = useRef<HTMLDivElement>(null)
  const [showCrop, setShowCrop] = useState(false)
  const [memo, setMemo] = useState(tweet.memo || '')

  const patchTweet = usePatchTweet()
  const grokMutation = useGrokContext()

  const ssUrl = screenshotUrl(tweet.screenshot_path)
  const legacy = isLegacyTweet(tweet)

  const grokContext = grokMutation.data?.grok_context ?? tweet.grok_context

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

  // Save memo on blur
  const handleMemoBlur = useCallback(() => {
    if (memo !== (tweet.memo || '')) {
      patchTweet.mutate({ id: tweet.id, memo: memo || null })
    }
  }, [memo, tweet.memo, tweet.id, patchTweet])

  const handleDownload = useCallback(async () => {
    if (!cleanRef.current) return
    try {
      const dataUrl = await toPng(cleanRef.current, { cacheBust: true })
      const link = document.createElement('a')
      link.download = `tweet-${tweet.tweet_id || tweet.id}.png`
      link.href = dataUrl
      link.click()
    } catch {
      // silently fail
    }
  }, [tweet.tweet_id, tweet.id])

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
        {/* Top action buttons */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 6,
            padding: '12px 12px 0 0',
          }}
        >
          {/* Download button */}
          <button
            onClick={handleDownload}
            style={{
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
              fontSize: 14,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = 'var(--text-primary)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = 'var(--text-secondary)')
            }
            aria-label="Download as PNG"
            title="Download as PNG"
          >
            &#8595;
          </button>

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
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
        </div>

        {/* Content */}
        <div style={{ padding: '4px 24px 24px' }}>
          {/* 1. Tweet card display */}
          <div style={{ marginBottom: 20 }}>
            {/* Author info with avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              {tweet.author_avatar_url ? (
                <img
                  src={tweet.author_avatar_url}
                  alt={tweet.author_handle}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'var(--bg-elevated)',
                    flexShrink: 0,
                  }}
                />
              )}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {tweet.author_display_name || `@${tweet.author_handle}`}
                  </span>
                  {tweet.author_verified && (
                    <span
                      style={{
                        color: 'var(--accent)',
                        fontSize: 14,
                        lineHeight: 1,
                      }}
                      title="Verified"
                    >
                      &#10003;
                    </span>
                  )}
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

            {/* Media images (new tweets only) */}
            {!legacy && tweet.media_urls && tweet.media_urls.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: tweet.media_urls.length === 1 ? '1fr' : '1fr 1fr',
                    gap: 8,
                    borderRadius: 'var(--radius-md)',
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
                        alt={`Media from @${tweet.author_handle}`}
                        style={{
                          width: '100%',
                          maxHeight: 400,
                          objectFit: 'contain',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--border)',
                          display: 'block',
                          background: 'var(--bg-elevated)',
                        }}
                      />
                    ))}
                </div>
              </div>
            )}

            {/* Engagement stats */}
            {showEngagement && engagement && (
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
          </div>

          {/* 2. Memo section */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--text-secondary)',
                marginBottom: 8,
              }}
            >
              Memo
            </div>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onBlur={handleMemoBlur}
              placeholder="Add notes about this tweet..."
              style={{
                width: '100%',
                minHeight: 80,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                color: 'var(--text-primary)',
                fontSize: 13,
                lineHeight: 1.5,
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'var(--font-body)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
            />
          </div>

          {/* 3. Grok context section */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                }}
              >
                Grok Context
              </div>
              <button
                onClick={() => grokMutation.mutate({ id: tweet.id, force: !!grokContext })}
                disabled={grokMutation.isPending}
                style={{
                  background: grokMutation.isPending ? 'var(--bg-elevated)' : 'var(--accent-muted)',
                  border: `1px solid ${grokMutation.isPending ? 'var(--border)' : 'var(--accent)'}`,
                  borderRadius: 'var(--radius-md)',
                  color: grokMutation.isPending ? 'var(--text-tertiary)' : 'var(--accent-hover)',
                  padding: '5px 12px',
                  fontSize: 12,
                  cursor: grokMutation.isPending ? 'default' : 'pointer',
                  fontFamily: 'var(--font-body)',
                  transition: 'all 0.15s ease',
                }}
              >
                {grokMutation.isPending
                  ? 'Loading...'
                  : grokContext
                    ? 'Refresh'
                    : 'Get Grok Context'}
              </button>
            </div>

            {grokMutation.isError && (
              <div
                style={{
                  fontSize: 12,
                  color: '#ef4444',
                  marginBottom: 8,
                }}
              >
                Failed to fetch Grok context. Make sure XAI_API_KEY is configured.
              </div>
            )}

            {grokContext && (
              <div
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {grokContext}
              </div>
            )}
          </div>

          {/* 4. Metadata row */}
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
            {tweet.created_at && (
              <span>Posted {formatDate(tweet.created_at)}</span>
            )}
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
            {tweet.url && (
              <a
                href={tweet.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent)',
                  textDecoration: 'none',
                  fontSize: 12,
                }}
              >
                View on X &#8599;
              </a>
            )}
          </div>

          {/* 5. Thread */}
          {tweet.thread_id && (
            <div style={{ marginBottom: 20 }}>
              <ThreadList
                threadId={tweet.thread_id}
                currentTweetId={tweet.id}
              />
            </div>
          )}

          {/* 6. Screenshot + crop (legacy tweets only) */}
          {legacy && ssUrl && (
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

      {/* Hidden clean card for PNG download */}
      {!legacy && (
        <div
          ref={cleanRef}
          style={{
            position: 'absolute',
            left: -9999,
            top: -9999,
            width: 550,
            background: '#15202b',
            borderRadius: 16,
            padding: '20px 24px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          {/* Author row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {tweet.author_avatar_url ? (
              <img
                src={tweet.author_avatar_url}
                alt={tweet.author_handle}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: '#253341',
                }}
              />
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#e7e9ea' }}>
                  {tweet.author_display_name || tweet.author_handle}
                </span>
                {tweet.author_verified && (
                  <span style={{ color: '#1d9bf0', fontSize: 14 }}>&#10003;</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#71767b' }}>@{tweet.author_handle}</div>
            </div>
          </div>

          {/* Full text */}
          <div
            style={{
              fontSize: 15,
              color: '#e7e9ea',
              lineHeight: 1.5,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
              marginBottom: 12,
            }}
          >
            {tweet.text}
          </div>

          {/* Media */}
          {tweet.media_urls && tweet.media_urls.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {tweet.media_urls
                .filter((m) => m.type === 'photo' || m.type === 'animated_gif')
                .slice(0, 4)
                .map((img, i) => (
                  <img
                    key={i}
                    src={img.url}
                    alt=""
                    style={{
                      width: '100%',
                      borderRadius: 12,
                      marginBottom: 4,
                      display: 'block',
                    }}
                  />
                ))}
            </div>
          )}

          {/* Timestamp */}
          {tweet.created_at && (
            <div style={{ fontSize: 13, color: '#71767b', marginBottom: showEngagement ? 10 : 0 }}>
              {formatDate(tweet.created_at)}
            </div>
          )}

          {/* Engagement */}
          {showEngagement && engagement && (
            <div
              style={{
                display: 'flex',
                gap: 20,
                paddingTop: 10,
                borderTop: '1px solid #2f3336',
              }}
            >
              <span style={{ fontSize: 13, color: '#71767b' }}>
                <span style={{ fontWeight: 700, color: '#e7e9ea' }}>{formatCount(engagement.likes)}</span> Likes
              </span>
              <span style={{ fontSize: 13, color: '#71767b' }}>
                <span style={{ fontWeight: 700, color: '#e7e9ea' }}>{formatCount(engagement.retweets)}</span> Retweets
              </span>
              <span style={{ fontSize: 13, color: '#71767b' }}>
                <span style={{ fontWeight: 700, color: '#e7e9ea' }}>{formatCount(engagement.replies)}</span> Replies
              </span>
            </div>
          )}
        </div>
      )}
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
