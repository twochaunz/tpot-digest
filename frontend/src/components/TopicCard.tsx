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
      backgroundColor: 'var(--bg-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-subtle)',
      marginBottom: '12px',
      overflow: 'hidden',
      transition: 'border-color 0.15s var(--ease-out)',
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
            <span style={{ fontSize: '14px', color: 'var(--text-tertiary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              #{topic.rank}
            </span>
            <h3 style={{ fontSize: '16px', margin: 0, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>{topic.title}</h3>
            <LifecycleBadge status={topic.lifecycle_status} />
          </div>
          {topic.summary && (
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
              {topic.summary}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
            {topic.subtopics.length} subtopic{topic.subtopics.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/topic/${topic.id}`) }}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all 0.15s var(--ease-out)',
            }}
          >
            Detail
          </button>
          <span style={{ fontSize: '18px', color: 'var(--text-tertiary)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            &#9662;
          </span>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 20px' }}>
          {topic.subtopics.length === 0 ? (
            <p style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>No subtopics yet.</p>
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
