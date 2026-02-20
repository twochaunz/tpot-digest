const PRESET_COLORS = [
  { name: 'Yellow', value: '#FFEB3B' },
  { name: 'Red', value: '#F44336' },
  { name: 'Blue', value: '#2196F3' },
  { name: 'Green', value: '#4CAF50' },
  { name: 'Orange', value: '#FF9800' },
  { name: 'Purple', value: '#9C27B0' },
]

interface Props {
  color: string
  onChange: (color: string) => void
}

export function ColorPicker({ color, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      {PRESET_COLORS.map(c => (
        <button
          key={c.value}
          onClick={() => onChange(c.value)}
          title={c.name}
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            backgroundColor: c.value,
            border: color === c.value ? '2px solid #333' : '2px solid transparent',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  )
}
