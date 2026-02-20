import { ColorPicker } from './ColorPicker'

export type ToolType = 'highlight' | 'box' | 'freehand' | 'select'

interface Props {
  activeTool: ToolType
  onToolChange: (tool: ToolType) => void
  color: string
  onColorChange: (color: string) => void
  opacity: number
  onOpacityChange: (opacity: number) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onExport: () => void
}

export function Toolbar({
  activeTool, onToolChange, color, onColorChange,
  opacity, onOpacityChange,
  canUndo, canRedo, onUndo, onRedo, onClear, onExport,
}: Props) {
  const tools: { type: ToolType; label: string }[] = [
    { type: 'highlight', label: 'Highlight' },
    { type: 'box', label: 'Box' },
    { type: 'freehand', label: 'Draw' },
  ]

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '8px 16px',
      backgroundColor: 'var(--bg-raised)',
      borderBottom: '1px solid var(--border-subtle)',
      flexWrap: 'wrap',
    }}>
      {tools.map(t => (
        <button
          key={t.type}
          onClick={() => onToolChange(t.type)}
          style={{
            padding: '6px 12px',
            fontSize: '13px',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: activeTool === t.type ? 'var(--accent-muted)' : 'var(--bg-elevated)',
            color: activeTool === t.type ? 'var(--accent)' : 'var(--text-secondary)',
            fontWeight: activeTool === t.type ? 600 : 400,
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
          }}
        >
          {t.label}
        </button>
      ))}

      <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-strong)' }} />

      <ColorPicker color={color} onChange={onColorChange} />

      <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-strong)' }} />

      <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
        Opacity
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.1"
          value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          style={{ width: '60px' }}
        />
      </label>

      <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-strong)' }} />

      <button onClick={onUndo} disabled={!canUndo} style={{ padding: '4px 8px', fontSize: '13px', cursor: canUndo ? 'pointer' : 'default', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
        Undo
      </button>
      <button onClick={onRedo} disabled={!canRedo} style={{ padding: '4px 8px', fontSize: '13px', cursor: canRedo ? 'pointer' : 'default', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
        Redo
      </button>
      <button onClick={onClear} style={{ padding: '4px 8px', fontSize: '13px', cursor: 'pointer', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
        Clear
      </button>

      <div style={{ flex: 1 }} />

      <button onClick={onExport} style={{
        padding: '6px 16px',
        fontSize: '13px',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: 'var(--accent)',
        color: 'var(--text-inverse)',
        cursor: 'pointer',
        fontWeight: 600,
        fontFamily: 'var(--font-body)',
      }}>
        Export PNG
      </button>
    </div>
  )
}
