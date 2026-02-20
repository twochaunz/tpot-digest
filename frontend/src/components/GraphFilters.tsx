import { useState } from 'react'

export interface GraphFilterValues {
  date_from: string
  date_to: string
  entity: string
  search: string
}

interface GraphFiltersProps {
  onApply: (filters: GraphFilterValues) => void
}

const EMPTY_FILTERS: GraphFilterValues = {
  date_from: '',
  date_to: '',
  entity: '',
  search: '',
}

export function GraphFilters({ onApply }: GraphFiltersProps) {
  const [local, setLocal] = useState<GraphFilterValues>(EMPTY_FILTERS)

  function handleChange(key: keyof GraphFilterValues, value: string) {
    setLocal(prev => ({ ...prev, [key]: value }))
  }

  function handleApply() {
    onApply(local)
  }

  function handleReset() {
    setLocal(EMPTY_FILTERS)
    onApply(EMPTY_FILTERS)
  }

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '13px',
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    outline: 'none',
    fontFamily: 'var(--font-body)',
  }

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    fontWeight: 500,
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '16px',
        alignItems: 'flex-end',
        padding: '16px',
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-md)',
        marginBottom: '16px',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <label style={labelStyle}>
        Date From
        <input
          type="date"
          value={local.date_from}
          onChange={e => handleChange('date_from', e.target.value)}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Date To
        <input
          type="date"
          value={local.date_to}
          onChange={e => handleChange('date_to', e.target.value)}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Entity
        <input
          type="text"
          placeholder="e.g. Apple"
          value={local.entity}
          onChange={e => handleChange('entity', e.target.value)}
          style={{ ...inputStyle, minWidth: '140px' }}
        />
      </label>

      <label style={labelStyle}>
        Search
        <input
          type="text"
          placeholder="Search topics…"
          value={local.search}
          onChange={e => handleChange('search', e.target.value)}
          style={{ ...inputStyle, minWidth: '180px' }}
        />
      </label>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleApply}
          style={{
            padding: '6px 16px',
            background: 'var(--accent)',
            color: 'var(--text-inverse)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
          }}
        >
          Apply
        </button>
        <button
          onClick={handleReset}
          style={{
            padding: '6px 16px',
            background: 'var(--bg-raised)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
          }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
