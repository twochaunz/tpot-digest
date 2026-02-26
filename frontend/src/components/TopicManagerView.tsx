import { useState, useCallback, useMemo } from 'react'
import type { TopicBundle } from '../api/dayBundle'
import { useUpdateTopic } from '../api/topics'
import { AVAILABLE_MODELS, useTopicScript, useGenerateDayScripts } from '../api/scripts'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface TopicManagerViewProps {
  date: string
  topics: TopicBundle[]
  orderedTopicIds: number[]
  setOrderedTopicIds: React.Dispatch<React.SetStateAction<number[]>>
  selectedTopicIds: Set<number>
  toggleTopic: (topicId: number) => void
  selectAll: () => void
  deselectAll: () => void
}

/* ---- Script status badge (per-topic) ---- */
function ScriptStatusBadge({ topicId }: { topicId: number }) {
  const { data, isLoading, isError } = useTopicScript(topicId)

  if (isLoading) {
    return (
      <span style={{
        fontSize: 11,
        color: 'var(--text-tertiary)',
        padding: '2px 6px',
      }}>
        ...
      </span>
    )
  }

  if (isError || !data) {
    return (
      <span style={{
        fontSize: 11,
        color: 'var(--text-tertiary)',
        padding: '2px 6px',
      }}>
        No script
      </span>
    )
  }

  return (
    <span style={{
      fontSize: 11,
      color: '#22c55e',
      padding: '2px 6px',
      fontWeight: 500,
    }}>
      &#10003; Script
    </span>
  )
}

/* ---- Sortable topic row ---- */
function SortableTopicRow({ topicId, topic, isSelected, onToggle }: {
  topicId: number
  topic: TopicBundle
  isSelected: boolean
  onToggle: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: topicId })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 16px',
    background: isSelected ? 'var(--bg-elevated)' : 'transparent',
    borderBottom: '1px solid var(--border)',
    cursor: 'default',
  }

  return (
    <div ref={setNodeRef} style={style}>
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        style={{ cursor: 'pointer', flexShrink: 0 }}
      />

      {/* Color dot */}
      <span style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: topic.color || 'var(--text-tertiary)',
        flexShrink: 0,
      }} />

      {/* Title */}
      <span style={{
        fontSize: 14,
        fontWeight: 500,
        color: 'var(--text-primary)',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {topic.title}
      </span>

      {/* Tweet count */}
      <span style={{
        fontSize: 12,
        color: 'var(--text-tertiary)',
        flexShrink: 0,
      }}>
        {topic.tweet_count} tweet{topic.tweet_count !== 1 ? 's' : ''}
      </span>

      {/* Script status badge */}
      <ScriptStatusBadge topicId={topicId} />

      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        style={{
          cursor: 'grab',
          color: 'var(--text-tertiary)',
          fontSize: 14,
          lineHeight: 1,
          padding: '2px 4px',
          userSelect: 'none',
          touchAction: 'none',
          flexShrink: 0,
        }}
        title="Drag to reorder"
      >
        &#10303;
      </span>
    </div>
  )
}

/* ---- Main TopicManagerView ---- */
export function TopicManagerView({
  date,
  topics,
  orderedTopicIds,
  setOrderedTopicIds,
  selectedTopicIds,
  toggleTopic,
  selectAll,
  deselectAll,
}: TopicManagerViewProps) {
  const topicMap = useMemo(() => new Map(topics.map(t => [t.id, t])), [topics])
  const updateTopicMutation = useUpdateTopic()
  const generateDayScripts = useGenerateDayScripts()

  const [model, setModel] = useState<string>(AVAILABLE_MODELS[0].id)

  const allSelected = topics.length > 0 && selectedTopicIds.size === topics.length
  const selectedCount = selectedTopicIds.size

  // Selected topic IDs as array (for mutation)
  const selectedIdArray = useMemo(
    () => orderedTopicIds.filter(id => selectedTopicIds.has(id)),
    [orderedTopicIds, selectedTopicIds],
  )

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setOrderedTopicIds(prev => {
      const oldIndex = prev.indexOf(active.id as number)
      const newIndex = prev.indexOf(over.id as number)
      const newOrder = arrayMove(prev, oldIndex, newIndex)

      // Persist position updates
      newOrder.forEach((id, idx) => {
        const topic = topicMap.get(id)
        if (topic && topic.position !== idx) {
          updateTopicMutation.mutate({ id, position: idx })
        }
      })

      return newOrder
    })
  }, [topicMap, updateTopicMutation, setOrderedTopicIds])

  const handleGenerate = useCallback(() => {
    if (selectedIdArray.length === 0 || generateDayScripts.isPending) return
    generateDayScripts.mutate({
      date,
      model,
      topicIds: selectedIdArray,
    })
  }, [date, model, selectedIdArray, generateDayScripts])

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Top toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <button
          onClick={allSelected ? deselectAll : selectAll}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>

        <span style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
        }}>
          {selectedCount} of {topics.length} selected
        </span>
      </div>

      {/* Topic list (scrollable) */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
      }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={orderedTopicIds} strategy={verticalListSortingStrategy}>
            {orderedTopicIds.map(id => {
              const topic = topicMap.get(id)
              if (!topic) return null
              return (
                <SortableTopicRow
                  key={id}
                  topicId={id}
                  topic={topic}
                  isSelected={selectedTopicIds.has(id)}
                  onToggle={() => toggleTopic(id)}
                />
              )
            })}
          </SortableContext>
        </DndContext>
      </div>

      {/* Bottom toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {/* Model picker */}
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 8px',
            fontSize: 12,
          }}
        >
          {AVAILABLE_MODELS.map(m => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.provider})
            </option>
          ))}
        </select>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={selectedCount === 0 || generateDayScripts.isPending}
          style={{
            background: selectedCount === 0 || generateDayScripts.isPending
              ? 'var(--text-tertiary)' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: selectedCount === 0 || generateDayScripts.isPending
              ? 'not-allowed' : 'pointer',
            opacity: selectedCount === 0 || generateDayScripts.isPending ? 0.6 : 1,
          }}
        >
          {generateDayScripts.isPending
            ? 'Generating...'
            : `Generate Scripts (${selectedCount})`
          }
        </button>
      </div>
    </div>
  )
}
