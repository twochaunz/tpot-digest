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
      <div style={{ padding: '12px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
        Searching for "{query}"…
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div style={{ padding: '12px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
        No results found for "{query}".
      </div>
    )
  }

  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        marginBottom: '16px',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          background: 'var(--bg-elevated)',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          fontWeight: 600,
          borderBottom: '1px solid var(--border-subtle)',
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
            borderBottom: '1px solid var(--border-subtle)',
            cursor: 'pointer',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'
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
                color: 'var(--accent)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {node.title}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              {node.date}
            </div>
          </div>
          <LifecycleBadge status={node.lifecycle_status} />
        </div>
      ))}
    </div>
  )
}
