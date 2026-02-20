import { useParams, Link } from 'react-router-dom'
import { useTopic } from '../api/topics'
import { LifecycleBadge } from '../components/LifecycleBadge'
import { SubTopicPanel } from '../components/SubTopicPanel'

export function TopicDetail() {
  const { topicId } = useParams<{ topicId: string }>()
  const { data: topic, isLoading, error } = useTopic(Number(topicId))

  if (isLoading) return <p style={{ color: 'var(--text-secondary)' }}>Loading topic...</p>
  if (error) return <p style={{ color: 'var(--negative)' }}>Error: {String(error)}</p>
  if (!topic) return <p style={{ color: 'var(--text-secondary)' }}>Topic not found.</p>

  return (
    <div>
      <Link to="/" style={{ color: 'var(--text-secondary)', fontSize: '13px', textDecoration: 'none', transition: 'color 0.15s' }}>
        &larr; Back to Feed
      </Link>

      <div style={{ marginTop: '16px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>{topic.title}</h2>
          <LifecycleBadge status={topic.lifecycle_status} />
        </div>
        {topic.summary && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{topic.summary}</p>
        )}
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '8px', fontFamily: 'var(--font-mono)' }}>
          <span>Date: {topic.date}</span>
          <span>Rank: #{topic.rank}</span>
          {topic.sentiment && <span>Sentiment: {topic.sentiment}</span>}
        </div>
      </div>

      <h3 style={{ fontSize: '16px', marginBottom: '12px', color: 'var(--text-primary)' }}>
        Sub-Topics ({topic.subtopics.length})
      </h3>

      {topic.subtopics.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)' }}>No subtopics identified yet.</p>
      ) : (
        topic.subtopics.map(st => (
          <div key={st.id} style={{
            backgroundColor: 'var(--bg-raised)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            marginBottom: '12px',
          }}>
            <SubTopicPanel subtopic={st} />
          </div>
        ))
      )}
    </div>
  )
}
