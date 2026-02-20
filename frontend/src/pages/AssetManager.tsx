import { useState, useMemo } from 'react'
import { useAssetDates, useAssetBrowse, downloadAssets } from '../api/assets'
import { FolderBrowser } from '../components/FolderBrowser'
import { AssetGrid } from '../components/AssetGrid'

export function AssetManager() {
  const { data: dates } = useAssetDates()
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedSubTopic, setSelectedSubTopic] = useState<string | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  const activeDateStr = selectedDate || (dates?.[0] || '')
  const { data: topics } = useAssetBrowse(activeDateStr ?
    `${activeDateStr.slice(0,4)}-${activeDateStr.slice(4,6)}-${activeDateStr.slice(6,8)}` : '')

  const currentFiles = useMemo(() => {
    if (!topics || !selectedSubTopic) return []
    for (const topic of topics) {
      for (const st of topic.subtopics_detail) {
        if (st.path === selectedSubTopic) {
          return [...st.tweets, ...st.articles]
        }
      }
    }
    return []
  }, [topics, selectedSubTopic])

  const toggleSelect = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleDownload = async () => {
    if (selectedPaths.size > 0) {
      await downloadAssets(Array.from(selectedPaths))
    }
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)' }}>
      <FolderBrowser
        dates={dates || []}
        selectedDate={activeDateStr}
        onDateChange={setSelectedDate}
        topics={topics || []}
        onSelectSubTopic={setSelectedSubTopic}
        selectedSubTopic={selectedSubTopic}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #e0e0e0' }}>
          <h2 style={{ fontSize: '16px', margin: 0 }}>Assets</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '13px', color: '#666' }}>{selectedPaths.size} selected</span>
            <button onClick={handleDownload} disabled={selectedPaths.size === 0}
              style={{
                padding: '6px 16px', fontSize: '13px', border: 'none', borderRadius: '4px',
                backgroundColor: selectedPaths.size > 0 ? '#1a73e8' : '#ccc',
                color: '#fff', cursor: selectedPaths.size > 0 ? 'pointer' : 'default',
              }}>
              Download ZIP
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          <AssetGrid files={currentFiles} selectedPaths={selectedPaths} onToggleSelect={toggleSelect} />
        </div>
      </div>
    </div>
  )
}
