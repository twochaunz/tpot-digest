import { useState, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { TopicBundle } from '../api/dayBundle'
import { sortTopics } from '../utils/topics'
import { TopicManagerView } from './TopicManagerView'
import { ScriptMirrorView } from './ScriptMirrorView'

interface ScriptPanelProps {
  date: string
  topics: TopicBundle[]
  onClose: () => void
}

export default function ScriptPanel({ date, topics, onClose }: ScriptPanelProps) {
  // Active view: topics manager vs script mirror
  const [activeView, setActiveView] = useState<'topics' | 'script'>('topics')

  // Selected topic IDs — default to top 3 by tweet count (sortTopics sorts by count desc)
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(() => {
    const sorted = sortTopics(topics)
    return new Set(sorted.slice(0, 3).map(t => t.id))
  })

  // Ordered topic IDs — initialized from sorted topics
  const [orderedTopicIds, setOrderedTopicIds] = useState<number[]>(() =>
    sortTopics(topics).map(t => t.id)
  )

  // Sync orderedTopicIds when topics are added/removed
  useEffect(() => {
    const currentIds = new Set(topics.map(t => t.id))
    const orderedSet = new Set(orderedTopicIds)

    // Check if sets differ
    if (currentIds.size !== orderedSet.size || [...currentIds].some(id => !orderedSet.has(id))) {
      setOrderedTopicIds(prev => {
        // Keep existing order for topics that still exist, append new ones
        const kept = prev.filter(id => currentIds.has(id))
        const newIds = topics.filter(t => !orderedSet.has(t.id)).map(t => t.id)
        return [...kept, ...newIds]
      })
    }
  }, [topics]) // eslint-disable-line react-hooks/exhaustive-deps

  // Topic map for resolving IDs to TopicBundle
  const topicMap = useMemo(() => new Map(topics.map(t => [t.id, t])), [topics])

  // Computed: ordered + filtered to selected IDs
  const selectedTopics = useMemo(() =>
    orderedTopicIds
      .filter(id => selectedTopicIds.has(id))
      .map(id => topicMap.get(id))
      .filter((t): t is TopicBundle => !!t),
    [orderedTopicIds, selectedTopicIds, topicMap],
  )

  // Callbacks for child views
  const toggleTopic = useCallback((id: number) => {
    setSelectedTopicIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedTopicIds(new Set(topics.map(t => t.id)))
  }, [topics])

  const deselectAll = useCallback(() => {
    setSelectedTopicIds(new Set())
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Skip if focused on an input element
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'g') {
        e.preventDefault()
        setActiveView(prev => prev === 'topics' ? 'script' : 'topics')
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return createPortal(
    <div style={{
      position: 'fixed',
      top: 66,
      left: 0,
      width: '100vw',
      height: 'calc(100vh - 66px)',
      zIndex: 60,
      background: 'var(--bg-raised)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {/* Back button */}
        <button onClick={onClose} style={{
          background: 'none',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
          fontSize: 12,
          cursor: 'pointer',
          padding: '4px 14px',
          borderRadius: 'var(--radius-sm)',
        }}>
          Back
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />

        {/* Tab buttons */}
        <button
          onClick={() => setActiveView('topics')}
          style={{
            background: 'none',
            border: 'none',
            color: activeView === 'topics' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            padding: '4px 10px',
            borderBottom: activeView === 'topics' ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >
          Topics
        </button>
        <button
          onClick={() => setActiveView('script')}
          style={{
            background: 'none',
            border: 'none',
            color: activeView === 'script' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            padding: '4px 10px',
            borderBottom: activeView === 'script' ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >
          Script
        </button>

      </div>

      {/* Child views — both always mounted, toggled with display for instant switching */}
      <div style={{
        display: activeView === 'topics' ? 'flex' : 'none',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        <TopicManagerView
          date={date}
          topics={topics}
          orderedTopicIds={orderedTopicIds}
          setOrderedTopicIds={setOrderedTopicIds}
          selectedTopicIds={selectedTopicIds}
          toggleTopic={toggleTopic}
          selectAll={selectAll}
          deselectAll={deselectAll}
        />
      </div>

      <div style={{
        display: activeView === 'script' ? 'flex' : 'none',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        <ScriptMirrorView topics={selectedTopics} />
      </div>
    </div>,
    document.body,
  )
}
