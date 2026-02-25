import { useState, useRef, useEffect } from 'react'
import type { Topic } from '../api/topics'
import { CATEGORIES } from '../constants/categories'

interface AssignDropdownProps {
  topics: Topic[]
  onAssign: (topicId: number, category?: string) => void
  disabled?: boolean
}

export function AssignDropdown({ topics, onAssign, disabled }: AssignDropdownProps) {
  const [open, setOpen] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<number | null>(null)
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSelectedTopic(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const btnStyle: React.CSSProperties = {
    background: disabled
      ? 'var(--bg-elevated)'
      : hovered
        ? 'var(--accent-hover)'
        : 'var(--accent)',
    color: disabled ? 'var(--text-tertiary)' : '#fff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: 'var(--font-body)',
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        style={btnStyle}
        onClick={() => !disabled && setOpen(!open)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        disabled={disabled}
      >
        Assign selected to... {open ? '\u25B4' : '\u25BE'}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow)',
            minWidth: 220,
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          {selectedTopic === null ? (
            // Step 1: pick a topic
            <>
              <div
                style={{
                  padding: '8px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                Select Topic
              </div>
              {topics.length === 0 && (
                <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                  No topics yet. Create one first.
                </div>
              )}
              {topics.map((t) => (
                <DropdownItem
                  key={t.id}
                  label={t.title}
                  color={t.color}
                  onClick={() => {
                    if (CATEGORIES.length === 0) {
                      onAssign(t.id)
                      setOpen(false)
                      setSelectedTopic(null)
                    } else {
                      setSelectedTopic(t.id)
                    }
                  }}
                />
              ))}
            </>
          ) : (
            // Step 2: pick a category (optional)
            <>
              <div
                style={{
                  padding: '8px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <button
                  onClick={() => setSelectedTopic(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: 0,
                  }}
                >
                  &#8249;
                </button>
                Select Category
              </div>
              <DropdownItem
                label="No category"
                onClick={() => {
                  onAssign(selectedTopic)
                  setOpen(false)
                  setSelectedTopic(null)
                }}
              />
              {CATEGORIES.map((c) => (
                <DropdownItem
                  key={c.key}
                  label={c.label}
                  color={c.color}
                  onClick={() => {
                    onAssign(selectedTopic!, c.key)
                    setOpen(false)
                    setSelectedTopic(null)
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DropdownItem({
  label,
  color,
  onClick,
  onDelete,
}: {
  label: string
  color?: string | null
  onClick: () => void
  onDelete?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 12px',
        background: hovered ? 'var(--bg-hover)' : 'transparent',
        border: 'none',
        color: 'var(--text-primary)',
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s ease',
        fontFamily: 'var(--font-body)',
      }}
    >
      {color && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            flexShrink: 0,
          }}
        />
      )}
      <span style={{ flex: 1 }}>{label}</span>
      {onDelete && hovered && (
        <span
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 14,
            cursor: 'pointer',
            lineHeight: 1,
          }}
          title="Delete category"
        >
          &times;
        </span>
      )}
    </button>
  )
}
