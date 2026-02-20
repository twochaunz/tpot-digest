import { useState, useCallback } from 'react'

interface DatePickerProps {
  value: string // YYYY-MM-DD
  onChange: (date: string) => void
}

function formatDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const arrowBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  fontSize: 16,
  transition: 'all 0.15s ease',
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const [hovered, setHovered] = useState<'prev' | 'next' | null>(null)

  const goPrev = useCallback(() => onChange(shiftDate(value, -1)), [value, onChange])
  const goNext = useCallback(() => onChange(shiftDate(value, 1)), [value, onChange])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        onClick={goPrev}
        onMouseEnter={() => setHovered('prev')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...arrowBtn,
          borderColor: hovered === 'prev' ? 'var(--border-strong)' : 'var(--border)',
          color: hovered === 'prev' ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
        aria-label="Previous day"
      >
        &#8249;
      </button>

      <span
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--text-primary)',
          minWidth: 160,
          textAlign: 'center',
          letterSpacing: '-0.01em',
        }}
      >
        {formatDisplay(value)}
      </span>

      <button
        onClick={goNext}
        onMouseEnter={() => setHovered('next')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...arrowBtn,
          borderColor: hovered === 'next' ? 'var(--border-strong)' : 'var(--border)',
          color: hovered === 'next' ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
        aria-label="Next day"
      >
        &#8250;
      </button>
    </div>
  )
}
