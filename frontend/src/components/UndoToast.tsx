import type { UndoAction } from '../hooks/useUndo'

interface UndoToastProps {
  action: UndoAction | null
  onUndo: () => void
  onDismiss: () => void
}

export function UndoToast({ action, onUndo, onDismiss }: UndoToastProps) {
  if (!action) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: 'var(--shadow)',
        zIndex: 100,
        fontFamily: 'var(--font-body)',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
        {action.label}
      </span>
      <button
        onClick={onUndo}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--accent)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          padding: '2px 6px',
          fontFamily: 'var(--font-body)',
        }}
      >
        Undo
      </button>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-tertiary)',
          fontSize: 14,
          cursor: 'pointer',
          padding: '2px 4px',
          lineHeight: 1,
        }}
      >
        &times;
      </button>
    </div>
  )
}
