import { useUnclusteredTweets } from '../api/ingest'

export function ExtensionStatus() {
  const { data: unclustered } = useUnclusteredTweets()
  const count = unclustered?.length ?? 0

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 12px',
      background: 'var(--bg-elevated)',
      borderRadius: '20px',
      border: '1px solid var(--border-subtle)',
      fontSize: '13px',
      color: 'var(--text-secondary)',
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: 'var(--positive)',
      }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--accent)' }}>
        {count}
      </span>
      <span>unclustered</span>
    </div>
  )
}
