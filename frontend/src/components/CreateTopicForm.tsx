import { useState } from 'react'

interface CreateTopicFormProps {
  onSubmit: (title: string, color: string) => void
  loading?: boolean
  topicCount: number
}

const PRESET_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#a855f7', // purple
]

export function CreateTopicForm({ onSubmit, loading, topicCount }: CreateTopicFormProps) {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[topicCount % PRESET_COLORS.length])
  const [btnHovered, setBtnHovered] = useState(false)

  const handleSubmit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    onSubmit(trimmed, color)
    setTitle('')
    setColor(PRESET_COLORS[(topicCount + 1) % PRESET_COLORS.length])
    setExpanded(false)
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        onMouseEnter={() => setBtnHovered(true)}
        onMouseLeave={() => setBtnHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: `1px dashed ${btnHovered ? 'var(--border-strong)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-lg)',
          padding: '14px 20px',
          width: '100%',
          cursor: 'pointer',
          color: btnHovered ? 'var(--text-secondary)' : 'var(--text-tertiary)',
          fontSize: 14,
          fontWeight: 500,
          transition: 'all 0.15s ease',
          fontFamily: 'var(--font-body)',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
        New Topic
      </button>
    )
  }

  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* Title input */}
        <input
          type="text"
          placeholder="Topic title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') {
              setExpanded(false)
              setTitle('')
            }
          }}
          autoFocus
          style={{
            flex: 1,
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            color: 'var(--text-primary)',
            fontSize: 14,
            outline: 'none',
            fontFamily: 'var(--font-body)',
            transition: 'border-color 0.15s ease',
          }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
        />

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!title.trim() || loading}
          style={{
            background: title.trim() ? 'var(--accent)' : 'var(--bg-elevated)',
            color: title.trim() ? '#fff' : 'var(--text-tertiary)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 500,
            cursor: title.trim() ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s ease',
            fontFamily: 'var(--font-body)',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Creating...' : 'Create'}
        </button>

        {/* Cancel */}
        <button
          onClick={() => {
            setExpanded(false)
            setTitle('')
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            fontSize: 13,
            padding: '8px 4px',
            fontFamily: 'var(--font-body)',
          }}
        >
          Cancel
        </button>
      </div>

      {/* Color picker */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginTop: 12,
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 4 }}>
          Color:
        </span>
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: c,
              border: color === c ? '2px solid var(--text-primary)' : '2px solid transparent',
              cursor: 'pointer',
              padding: 0,
              transition: 'border-color 0.1s ease',
            }}
            aria-label={`Color ${c}`}
          />
        ))}
      </div>
    </div>
  )
}
