import type { Tweet } from '../api/tweets'

export function TweetCard({ tweet, onClick }: { tweet: Tweet; onClick?: () => void }) {
  const engagement = tweet.engagement || {}

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        backgroundColor: 'var(--bg-raised)',
        cursor: onClick ? 'pointer' : 'default',
        marginBottom: '8px',
        transition: 'border-color 0.15s var(--ease-out)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <strong style={{ fontSize: '14px', color: 'var(--accent)' }}>@{tweet.author_handle}</strong>
        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {tweet.posted_at ? new Date(tweet.posted_at).toLocaleDateString() : ''}
        </span>
      </div>
      <p style={{ fontSize: '13px', lineHeight: '1.5', margin: '0 0 8px', color: 'var(--text-primary)' }}>
        {tweet.text}
      </p>
      <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        <span>{engagement.likes || 0} likes</span>
        <span>{engagement.retweets || 0} RTs</span>
        <span>{engagement.replies || 0} replies</span>
        {tweet.quality_score !== null && (
          <span>Score: {tweet.quality_score.toFixed(2)}</span>
        )}
      </div>
    </div>
  )
}
