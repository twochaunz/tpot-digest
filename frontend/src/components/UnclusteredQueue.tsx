import { useUnclusteredTweets, useTriggerClustering } from '../api/ingest'

export function UnclusteredQueue() {
  const { data: tweets, isLoading } = useUnclusteredTweets()
  const clustering = useTriggerClustering()

  if (isLoading || !tweets || tweets.length === 0) return null

  return (
    <div style={{
      background: 'var(--bg-raised)',
      border: '1px dashed var(--border-strong)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
      marginBottom: '16px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
            {tweets.length}
          </span>
          {' '}tweets awaiting clustering
        </div>
        <button
          onClick={() => clustering.mutate()}
          disabled={clustering.isPending}
          style={{
            padding: '8px 16px',
            background: clustering.isPending ? 'var(--bg-active)' : 'var(--accent)',
            color: clustering.isPending ? 'var(--text-secondary)' : 'var(--text-inverse)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-body)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: clustering.isPending ? 'not-allowed' : 'pointer',
          }}
        >
          {clustering.isPending ? 'Clustering...' : 'Re-cluster Now'}
        </button>
      </div>
      <div style={{
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        paddingBottom: '4px',
      }}>
        {tweets.map((tweet) => (
          <div
            key={tweet.id}
            style={{
              width: '120px',
              height: '90px',
              flexShrink: 0,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              @{tweet.author_handle}
            </div>
            <div style={{
              fontSize: '10px',
              color: 'var(--text-tertiary)',
              lineHeight: 1.3,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical' as const,
            }}>
              {tweet.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
