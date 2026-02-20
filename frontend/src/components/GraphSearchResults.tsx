import { useNavigate } from 'react-router-dom'
import { LifecycleBadge } from './LifecycleBadge'
import type { GraphNode } from '../api/graph'

interface GraphSearchResultsProps {
  results: GraphNode[]
  isLoading: boolean
  query: string
}

export function GraphSearchResults({ results, isLoading, query }: GraphSearchResultsProps) {
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <div style={{ padding: '12px', color: '#999', fontSize: '13px' }}>
        Searching for "{query}"…
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div style={{ padding: '12px', color: '#999', fontSize: '13px' }}>
        No results found for "{query}".
      </div>
    )
  }

  return (
    <div
      style={{
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        overflow: 'hidden',
        marginBottom: '16px',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          background: '#f5f5f5',
          fontSize: '12px',
          color: '#666',
          fontWeight: 600,
          borderBottom: '1px solid #e0e0e0',
        }}
      >
        {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
      </div>
      {results.map(node => (
        <div
          key={node.id}
          onClick={() => navigate(`/topic/${node.id}`)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 16px',
            borderBottom: '1px solid #f0f0f0',
            cursor: 'pointer',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLDivElement).style.background = '#f9f9f9'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLDivElement).style.background = 'transparent'
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: '#1976d2',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {node.title}
            </div>
            <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
              {node.date}
            </div>
          </div>
          <LifecycleBadge status={node.lifecycle_status} />
        </div>
      ))}
    </div>
  )
}
