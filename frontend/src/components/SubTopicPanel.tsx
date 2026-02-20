import type { SubTopic } from '../api/topics'

const SENTIMENT_COLORS: Record<string, string> = {
  positive: '#4caf50',
  negative: '#f44336',
  neutral: '#9e9e9e',
  mixed: '#ff9800',
}

export function SubTopicPanel({ subtopic }: { subtopic: SubTopic }) {
  return (
    <div style={{
      padding: '10px 0',
      borderBottom: '1px solid #f0f0f0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: SENTIMENT_COLORS[subtopic.sentiment || 'neutral'] || '#9e9e9e',
          display: 'inline-block',
        }} />
        <strong style={{ fontSize: '14px' }}>{subtopic.title}</strong>
        {subtopic.sentiment && (
          <span style={{ fontSize: '11px', color: '#999' }}>({subtopic.sentiment})</span>
        )}
      </div>
      {subtopic.summary && (
        <p style={{ fontSize: '13px', color: '#666', margin: '0 0 0 16px' }}>
          {subtopic.summary}
        </p>
      )}
    </div>
  )
}
