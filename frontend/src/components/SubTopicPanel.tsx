import type { SubTopic } from '../api/topics'

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  neutral: 'var(--neutral)',
  mixed: 'var(--mixed)',
}

export function SubTopicPanel({ subtopic }: { subtopic: SubTopic }) {
  return (
    <div style={{
      padding: '10px 0',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: SENTIMENT_COLORS[subtopic.sentiment || 'neutral'] || 'var(--neutral)',
          display: 'inline-block',
        }} />
        <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{subtopic.title}</strong>
        {subtopic.sentiment && (
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>({subtopic.sentiment})</span>
        )}
      </div>
      {subtopic.summary && (
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 0 16px' }}>
          {subtopic.summary}
        </p>
      )}
    </div>
  )
}
