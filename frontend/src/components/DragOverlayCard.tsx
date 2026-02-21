import type { Tweet } from '../api/tweets'

export function DragOverlayCard({ tweet }: { tweet: Tweet }) {
  return (
    <div
      style={{
        width: 240,
        padding: '8px 12px',
        background: 'var(--bg-raised)',
        border: '2px solid var(--accent)',
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
        opacity: 0.92,
        cursor: 'grabbing',
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
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
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {tweet.text.slice(0, 80)}
      </div>
    </div>
  )
}
