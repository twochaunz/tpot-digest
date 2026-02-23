import { Tweet } from 'react-tweet'
import type { Tweet as TweetData } from '../api/tweets'

interface EmbeddedTweetProps {
  tweet: TweetData
  onTweetClick?: (tweet: TweetData) => void
  onContextMenu?: (e: React.MouseEvent, tweet: TweetData) => void
  onDelete?: (id: number) => void
}

export function EmbeddedTweet({ tweet, onTweetClick, onContextMenu, onDelete }: EmbeddedTweetProps) {
  return (
    <div
      className="embedded-tweet-wrapper"
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
      }}
    >
      <div data-theme="dark" className="react-tweet-container">
        <Tweet id={tweet.tweet_id} />
      </div>

      {/* Hover actions overlay */}
      <div className="embedded-tweet-actions">
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
      </div>
    </div>
  )
}
