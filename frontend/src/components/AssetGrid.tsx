import type { AssetFile } from '../api/assets'

interface Props {
  files: AssetFile[]
  selectedPaths: Set<string>
  onToggleSelect: (path: string) => void
}

export function AssetGrid({ files, selectedPaths, onToggleSelect }: Props) {
  if (files.length === 0) {
    return <p style={{ color: '#999', fontSize: '13px', padding: '20px' }}>No assets in this folder.</p>
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: '12px',
      padding: '4px',
    }}>
      {files.map(file => {
        const isImage = /\.(png|jpg|jpeg|gif)$/i.test(file.name)
        const isSelected = selectedPaths.has(file.path)
        const isAnnotated = file.name.includes('_annotated')

        return (
          <div key={file.path} style={{
            border: isSelected ? '2px solid #1a73e8' : '1px solid #e0e0e0',
            borderRadius: '8px',
            overflow: 'hidden',
            backgroundColor: '#fff',
            cursor: 'pointer',
          }}
          onClick={() => onToggleSelect(file.path)}
          >
            {isImage ? (
              <div style={{ height: '150px', backgroundColor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <img src={`/api/assets/file?path=${encodeURIComponent(file.path)}`} alt={file.name}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              </div>
            ) : (
              <div style={{ height: '150px', backgroundColor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '24px' }}>FILE</span>
              </div>
            )}
            <div style={{ padding: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(file.path)} onClick={(e) => e.stopPropagation()} />
              <span style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {file.name}
              </span>
              {isAnnotated && (
                <span style={{ fontSize: '9px', padding: '1px 4px', backgroundColor: '#e8f5e9', borderRadius: '4px', color: '#2e7d32' }}>
                  annotated
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
