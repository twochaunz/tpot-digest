import { useState } from 'react'
import { useGraph, useGraphSearch } from '../api/graph'
import { GraphCanvas } from '../components/GraphCanvas'
import { GraphFilters, type GraphFilterValues } from '../components/GraphFilters'
import { GraphSearchResults } from '../components/GraphSearchResults'

export function GraphExplorer() {
  const [filters, setFilters] = useState<GraphFilterValues>({
    date_from: '',
    date_to: '',
    entity: '',
    search: '',
  })

  const graphParams = {
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
    entity: filters.entity || undefined,
  }

  const { data: graphData, isLoading: graphLoading, error: graphError } = useGraph(graphParams)
  const { data: searchResults, isLoading: searchLoading } = useGraphSearch(filters.search)

  const isSearchActive = filters.search.trim().length > 0

  function handleApply(newFilters: GraphFilterValues) {
    setFilters(newFilters)
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
        }}
      >
        <h2 style={{ margin: 0 }}>Graph Explorer</h2>
        {graphData && !isSearchActive && (
          <span style={{ fontSize: '13px', color: '#999' }}>
            {graphData.nodes.length} node{graphData.nodes.length !== 1 ? 's' : ''},&nbsp;
            {graphData.edges.length} edge{graphData.edges.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <GraphFilters onApply={handleApply} />

      {isSearchActive ? (
        <GraphSearchResults
          results={searchResults || []}
          isLoading={searchLoading}
          query={filters.search}
        />
      ) : (
        <>
          {graphLoading && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '14px' }}>
              Loading graph…
            </div>
          )}
          {graphError && (
            <p style={{ color: 'red', fontSize: '14px' }}>
              Error loading graph: {String(graphError)}
            </p>
          )}
          {!graphLoading && !graphError && graphData && (
            <GraphCanvas nodes={graphData.nodes} edges={graphData.edges} />
          )}
        </>
      )}
    </div>
  )
}
