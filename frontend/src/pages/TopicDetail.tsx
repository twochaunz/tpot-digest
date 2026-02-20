import { useParams, Link } from 'react-router-dom'
import { useTopic } from '../api/topics'
import { LifecycleBadge } from '../components/LifecycleBadge'
import { SubTopicPanel } from '../components/SubTopicPanel'

export function TopicDetail() {
  const { topicId } = useParams<{ topicId: string }>()
  const { data: topic, isLoading, error } = useTopic(Number(topicId))

  if (isLoading) return <p>Loading topic...</p>
  if (error) return <p style={{ color: 'red' }}>Error: {String(error)}</p>
  if (!topic) return <p>Topic not found.</p>

  return (
    <div>
      <Link to="/" style={{ color: '#666', fontSize: '13px', textDecoration: 'none' }}>
        &larr; Back to Feed
      </Link>

      <div style={{ marginTop: '16px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <h2 style={{ margin: 0 }}>{topic.title}</h2>
          <LifecycleBadge status={topic.lifecycle_status} />
        </div>
        {topic.summary && (
          <p style={{ color: '#666', fontSize: '14px' }}>{topic.summary}</p>
        )}
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#999', marginTop: '8px' }}>
          <span>Date: {topic.date}</span>
          <span>Rank: #{topic.rank}</span>
          {topic.sentiment && <span>Sentiment: {topic.sentiment}</span>}
        </div>
      </div>

      <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>
        Sub-Topics ({topic.subtopics.length})
      </h3>

      {topic.subtopics.length === 0 ? (
        <p style={{ color: '#999' }}>No subtopics identified yet.</p>
      ) : (
        topic.subtopics.map(st => (
          <div key={st.id} style={{
            backgroundColor: '#fff',
            border: '1px solid #e0e0e0',
            borderRadius: '8px',
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
