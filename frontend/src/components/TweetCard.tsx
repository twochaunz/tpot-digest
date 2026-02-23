import { useState, useRef, useCallback } from 'react'
import { toPng } from 'html-to-image'
import type { Tweet } from '../api/tweets'

interface TweetCardProps {
  tweet: Tweet
  selected: boolean
  onToggle: (id: number) => void
  selectable?: boolean
  onTweetClick?: (tweet: Tweet) => void
  showEngagement?: boolean
}

function screenshotUrl(path: string | null): string | null {
  if (!path) return null
  return `/api/screenshots/${path}`
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function isLegacyTweet(tweet: Tweet): boolean {
  return !tweet.author_avatar_url && !!tweet.screenshot_path
}

export function TweetCard({
  tweet,
  selected,
  onToggle,
  selectable = true,
  onTweetClick,
  showEngagement = true,
}: TweetCardProps) {
  const [hovered, setHovered] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const handleDownload = useCallback(async () => {
    if (!cardRef.current) return
    try {
      const dataUrl = await toPng(cardRef.current, { cacheBust: true })
      const link = document.createElement('a')
      link.download = `tweet-${tweet.tweet_id || tweet.id}.png`
      link.href = dataUrl
      link.click()
    } catch {
      // silently fail
    }
  }, [tweet.tweet_id, tweet.id])

  const legacy = isLegacyTweet(tweet)

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 280,
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
        } else if (selectable) {
          onToggle(tweet.id)
        }
      }}
    >
      {legacy ? (
        <LegacyCard tweet={tweet} />
      ) : (
        <NativeCard tweet={tweet} showEngagement={showEngagement} />
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

/* Native card: structured tweet display using X API data */
function NativeCard({ tweet, showEngagement }: { tweet: Tweet; showEngagement: boolean }) {
  return (
    <div style={{ padding: '12px 14px' }}>
      {/* Author row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {/* Avatar */}
        {tweet.author_avatar_url ? (
          <img
            src={tweet.author_avatar_url}
            alt={tweet.author_handle}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--bg-elevated)',
              flexShrink: 0,
            }}
          />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                fontSize: 13,
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
              <span
                style={{
                  color: 'var(--accent)',
                  fontSize: 12,
                  flexShrink: 0,
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
              fontSize: 11,
              color: 'var(--text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            @{tweet.author_handle}
          </div>
        </div>
      </div>

      {/* Tweet text */}
      <div
        style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
          marginBottom: 8,
        }}
      >
        {tweet.text}
      </div>

      {/* Media thumbnails */}
      {tweet.media_urls && tweet.media_urls.length > 0 && (
        <MediaGrid media={tweet.media_urls} authorHandle={tweet.author_handle} />
      )}

      {/* Engagement stats */}
      {showEngagement && tweet.engagement && (
        <div
          style={{
            display: 'flex',
            gap: 14,
            paddingTop: 8,
            borderTop: '1px solid var(--border)',
          }}
        >
          <EngagementStat icon="\u2665" value={tweet.engagement.likes} />
          <EngagementStat icon="\u21BB" value={tweet.engagement.retweets} />
          <EngagementStat icon="\u2709" value={tweet.engagement.replies} />
        </div>
      )}
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
  const imgHeight = images.length === 1 ? 140 : 80

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        gap: 4,
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        marginBottom: 8,
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

function EngagementStat({ icon, value }: { icon: string; value: number }) {
  return (
    <span
      style={{
        fontSize: 11,
        color: 'var(--text-tertiary)',
        display: 'flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      <span style={{ fontSize: 12 }}>{icon}</span>
      {formatCount(value)}
    </span>
  )
}
