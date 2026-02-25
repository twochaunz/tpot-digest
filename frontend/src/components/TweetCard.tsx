import { useState, useRef, useCallback } from 'react'
import { toPng } from 'html-to-image'
import { Tweet as ReactTweet } from 'react-tweet'
import type { Tweet } from '../api/tweets'

interface TweetCardProps {
  tweet: Tweet
  selected?: boolean
  onToggle?: (id: number) => void
  selectable?: boolean
  onTweetClick?: (tweet: Tweet) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
  onDelete?: (id: number) => void
  /** Override the default width (defaults to 100%) */
  width?: number | string
  /** When true, renders a minimal card suitable for drag overlays */
  overlay?: boolean
}

function screenshotUrl(path: string | null): string | null {
  if (!path) return null
  return `/api/screenshots/${path}`
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isLegacyTweet(tweet: Tweet): boolean {
  return !tweet.author_avatar_url && !!tweet.screenshot_path
}

export function TweetCard({
  tweet,
  selected = false,
  onToggle,
  selectable = true,
  onTweetClick,
  onContextMenu,
  onDelete,
  width = '100%',
  overlay = false,
}: TweetCardProps) {
  const [hovered, setHovered] = useState(false)
  const cleanRef = useRef<HTMLDivElement>(null)

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

  const legacy = isLegacyTweet(tweet)

  // Overlay mode: minimal card for drag previews
  if (overlay) {
    return (
      <div
        style={{
          width,
          maxWidth: 600,
          background: 'var(--bg-raised)',
          border: '2px solid var(--accent)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
          opacity: 0.92,
          cursor: 'grabbing',
          overflow: 'hidden',
        }}
      >
        {legacy ? (
          <LegacyCard tweet={tweet} />
        ) : (
          <NativeCard tweet={tweet} />
        )}
      </div>
    )
  }

  return (
    <>
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
        style={{
          width,
          maxWidth: 600,
          margin: '0 auto',
          background: hovered ? 'var(--bg-hover)' : 'var(--bg-raised)',
          border: selected
            ? '1.5px solid var(--accent)'
            : `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          cursor: selectable ? 'pointer' : 'default',
          transition: 'all 0.15s ease',
          flexShrink: 0,
          position: 'relative',
        }}
        onClick={() => {
          if (onTweetClick) {
            onTweetClick(tweet)
          } else if (selectable && onToggle) {
            onToggle(tweet.id)
          }
        }}
      >
        {legacy ? (
          <LegacyCard tweet={tweet} />
        ) : (
          <NativeCard tweet={tweet} />
        )}

        {/* Checkbox overlay */}
        {selectable && onToggle && (
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
              zIndex: 2,
            }}
          >
            {selected && '\u2713'}
          </div>
        )}

        {/* Hover actions */}
        {hovered && (
          <div
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              display: 'flex',
              gap: 4,
              zIndex: 2,
            }}
          >
            {/* Delete button */}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(tweet.id)
                }}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(0,0,0,0.5)',
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

            {/* Download button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDownload()
              }}
              style={{
                width: 24,
                height: 24,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(0,0,0,0.5)',
                border: 'none',
                color: '#fff',
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Download as PNG"
            >
              &#8595;
            </button>

            {/* External link */}
            {tweet.url && (
              <a
                href={tweet.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(0,0,0,0.5)',
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

      {/* Hidden clean card for PNG download (no UI chrome) */}
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
            <div style={{ fontSize: 13, color: '#71767b' }}>
              {formatTimestamp(tweet.created_at)}
            </div>
          )}
        </div>
      )}
    </>
  )
}

/* Legacy card: screenshot thumbnail (for tweets without X API data) */
function LegacyCard({ tweet }: { tweet: Tweet }) {
  const [imgError, setImgError] = useState(false)
  const ssUrl = screenshotUrl(tweet.screenshot_path)

  return (
    <>
      <div
        style={{
          width: '100%',
          height: 160,
          background: 'var(--bg-elevated)',
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
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 2,
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
          {tweet.text}
        </div>
      </div>
    </>
  )
}

/** Render tweet text with clickable links. Strips trailing t.co URLs when media or quoted tweet is present. */
function TweetText({ text, hasMedia, hasQuotedTweet }: { text: string; hasMedia: boolean; hasQuotedTweet: boolean }) {
  // Strip trailing t.co URLs if media is shown or quoted tweet is embedded (they're just links to the attachment)
  let cleaned = text
  if (hasMedia || hasQuotedTweet) {
    cleaned = cleaned.replace(/\s*https:\/\/t\.co\/\w+\s*$/, '')
  }

  // Split on URLs and render as links
  const parts = cleaned.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'var(--accent)', textDecoration: 'none' }}
          >
            {part.startsWith('https://t.co/') ? part.replace('https://t.co/', 't.co/') : part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

/* Native card: X.com-style two-column layout (avatar | content) */
function NativeCard({ tweet }: { tweet: Tweet }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '12px 16px' }}>
      {/* Left column: avatar */}
      {tweet.author_avatar_url ? (
        <img
          src={tweet.author_avatar_url}
          alt={tweet.author_handle}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            objectFit: 'cover',
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'var(--bg-elevated)',
            flexShrink: 0,
          }}
        />
      )}

      {/* Right column: name + text + media */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tweet.author_display_name || tweet.author_handle}
          </span>
          {tweet.author_verified && (
            <svg viewBox="0 0 22 22" width="16" height="16" style={{ flexShrink: 0 }}>
              <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.141.27.587.7 1.086 1.24 1.44s1.167.551 1.813.568c.647-.017 1.277-.213 1.817-.567s.972-.854 1.245-1.44c.604.223 1.26.27 1.894.14.634-.132 1.22-.438 1.69-.884.445-.47.75-1.055.88-1.69.131-.634.084-1.292-.139-1.899.584-.273 1.084-.704 1.438-1.244.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="#1d9bf0" />
            </svg>
          )}
          <span style={{ fontSize: 13, color: 'var(--text-tertiary)', flexShrink: 0 }}>
            @{tweet.author_handle}
          </span>
          {tweet.created_at && (
            <>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>&middot;</span>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                {formatRelativeTime(tweet.created_at)}
              </span>
            </>
          )}
        </div>

        {/* Tweet text */}
        <div
          style={{
            fontSize: 15,
            color: 'var(--text-primary)',
            lineHeight: 1.5,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        >
          <TweetText text={tweet.text} hasMedia={!!(tweet.media_urls && tweet.media_urls.length > 0)} hasQuotedTweet={!!tweet.quoted_tweet_id} />
        </div>

        {/* Media thumbnails */}
        {tweet.media_urls && tweet.media_urls.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <MediaGrid media={tweet.media_urls} authorHandle={tweet.author_handle} />
          </div>
        )}

        {/* Quoted tweet embed */}
        {tweet.quoted_tweet_id && (
          <div
            data-theme="dark"
            onClick={(e) => e.stopPropagation()}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              marginTop: 10,
            }}
          >
            <ReactTweet id={tweet.quoted_tweet_id} />
          </div>
        )}
      </div>
    </div>
  )
}

function MediaGrid({
  media,
  authorHandle,
}: {
  media: { type: string; url: string; width?: number; height?: number }[]
  authorHandle: string
}) {
  const images = media.filter((m) => m.type === 'photo' || m.type === 'animated_gif')
  if (images.length === 0) return null

  const gridCols = images.length === 1 ? '1fr' : '1fr 1fr'
  const imgHeight = images.length === 1 ? 200 : 120

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        gap: 4,
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        marginBottom: 10,
      }}
    >
      {images.slice(0, 4).map((img, i) => (
        <img
          key={i}
          src={img.url}
          alt={`Media from @${authorHandle}`}
          style={{
            width: '100%',
            height: imgHeight,
            objectFit: 'cover',
            display: 'block',
            borderRadius: 'var(--radius-sm)',
          }}
        />
      ))}
    </div>
  )
}

