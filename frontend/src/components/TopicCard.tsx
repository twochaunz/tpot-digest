import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LifecycleBadge } from './LifecycleBadge'
import { SubTopicPanel } from './SubTopicPanel'
import type { Topic } from '../api/topics'

export function TopicCard({ topic }: { topic: Topic }) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()

  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: '8px',
      border: '1px solid #e0e0e0',
      marginBottom: '12px',
      overflow: 'hidden',
    }}>
      <div
        style={{
          padding: '16px 20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={{ fontSize: '14px', color: '#999', fontWeight: 600 }}>
              #{topic.rank}
            </span>
            <h3 style={{ fontSize: '16px', margin: 0 }}>{topic.title}</h3>
            <LifecycleBadge status={topic.lifecycle_status} />
          </div>
          {topic.summary && (
            <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>
              {topic.summary}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: '#999' }}>
            {topic.subtopics.length} subtopic{topic.subtopics.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/topic/${topic.id}`) }}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              backgroundColor: '#fff',
              cursor: 'pointer',
            }}
          >
            Detail
          </button>
          <span style={{ fontSize: '18px', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            &#9662;
          </span>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid #eee', padding: '12px 20px' }}>
          {topic.subtopics.length === 0 ? (
            <p style={{ color: '#999', fontSize: '13px' }}>No subtopics yet.</p>
          ) : (
            topic.subtopics.map(st => (
              <SubTopicPanel key={st.id} subtopic={st} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
