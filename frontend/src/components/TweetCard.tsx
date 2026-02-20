import type { Tweet } from '../api/tweets'

export function TweetCard({ tweet, onClick }: { tweet: Tweet; onClick?: () => void }) {
  const engagement = tweet.engagement || {}

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px',
        border: '1px solid #e8e8e8',
        borderRadius: '8px',
        backgroundColor: '#fff',
        cursor: onClick ? 'pointer' : 'default',
        marginBottom: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <strong style={{ fontSize: '14px' }}>@{tweet.author_handle}</strong>
        <span style={{ fontSize: '11px', color: '#999' }}>
          {tweet.posted_at ? new Date(tweet.posted_at).toLocaleDateString() : ''}
        </span>
      </div>
      <p style={{ fontSize: '13px', lineHeight: '1.5', margin: '0 0 8px' }}>
        {tweet.text}
      </p>
      <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#888' }}>
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
