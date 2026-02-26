import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useGenerateScript, useGenerateDayScripts, AVAILABLE_MODELS } from '../api/scripts'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import type { Tweet } from '../api/tweets'
import { useCreateTopic, useDeleteTopic, useUpdateTopic } from '../api/topics'
import { useDayBundle, useOptimisticAssign, useOptimisticUnassign, useOptimisticDeleteTweet, useOptimisticPatchTweet } from '../api/dayBundle'
import { useUndo } from '../hooks/useUndo'
import { UnsortedSection } from './UnsortedSection'
import { TopicSectionWithData } from './TopicSection'
import { CreateTopicForm } from './CreateTopicForm'
import { UndoToast } from './UndoToast'
import { DragOverlayCard } from './DragOverlayCard'
import { ContextMenu, TopicContextMenu } from './ContextMenu'
import { sortTopics, isKekTopic } from '../utils/topics'

interface DayFeedPanelProps {
  date: string
  search: string
  isActive: boolean
  activeDragTweet: Tweet | null
  setActiveDragTweet: (tweet: Tweet | null) => void
  genPanelOpen: boolean
  onGenPanelClose: () => void
}

export function DayFeedPanel({
  date,
  search,
  isActive,
  activeDragTweet,
  setActiveDragTweet,
  genPanelOpen,
  onGenPanelClose,
}: DayFeedPanelProps) {
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tweet: Tweet; topicId?: number; ogTweetId?: number | null } | null>(null)
  const [topicContextMenu, setTopicContextMenu] = useState<{ x: number; y: number; topicId: number; title: string } | null>(null)

  // Data fetching — single bundle query replaces N+1 queries
  const bundleQuery = useDayBundle(date)
  const bundle = bundleQuery.data

  // Derive topics and unsorted from bundle, with client-side search filtering
  const topics = bundle?.topics ?? []
  const unsortedTweets = useMemo(() => {
    const list = bundle?.unsorted ?? []
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter((t) =>
      t.text.toLowerCase().includes(q) ||
      t.author_handle.toLowerCase().includes(q) ||
      (t.author_display_name?.toLowerCase().includes(q) ?? false)
    )
  }, [bundle?.unsorted, search])

  // Mutations
  const assignMutation = useOptimisticAssign()
  const unassignMutation = useOptimisticUnassign()
  const createTopicMutation = useCreateTopic()
  const deleteTweetMutation = useOptimisticDeleteTweet()
  const deleteTopicMutation = useDeleteTopic()
  const updateTopicMutation = useUpdateTopic()
  const patchTweetMutation = useOptimisticPatchTweet()

  // Undo
  const undo = useUndo(date)

  // Script generation
  const generateAll = useGenerateDayScripts()
  const generateScript = useGenerateScript()
  const [genModel, setGenModel] = useState<string>(AVAILABLE_MODELS[0].id)
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(new Set())

  // Reset selection to all when modal opens
  useEffect(() => {
    if (genPanelOpen) {
      setSelectedTopicIds(new Set(topics.map((t) => t.id)))
    }
  }, [genPanelOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const allSelected = selectedTopicIds.size === topics.length && topics.length > 0
  const toggleTopicId = useCallback((id: number) => {
    setSelectedTopicIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // DnD sensors: 8px activation distance so clicks still work
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  )

  const handleAssign = useCallback(
    (tweetIds: number[], topicId: number, category?: string | null) => {
      assignMutation.mutate({ tweet_ids: tweetIds, topic_id: topicId, category })
      undo.push({
        label: `${tweetIds.length} tweet${tweetIds.length > 1 ? 's' : ''} assigned`,
        undo: () => unassignMutation.mutate({ tweet_ids: tweetIds, topic_id: topicId }),
      })
    },
    [assignMutation, unassignMutation, undo],
  )

  const handleUnassign = useCallback(
    (tweetIds: number[], topicId: number) => {
      unassignMutation.mutate({ tweet_ids: tweetIds, topic_id: topicId })
      undo.push({
        label: `${tweetIds.length} tweet${tweetIds.length > 1 ? 's' : ''} unassigned`,
        undo: () => assignMutation.mutate({ tweet_ids: tweetIds, topic_id: topicId }),
      })
    },
    [unassignMutation, assignMutation, undo],
  )

  const handleCreateTopic = useCallback(
    (title: string, color: string) => {
      createTopicMutation.mutate({ title, date, color })
    },
    [createTopicMutation, date],
  )

  const handleDeleteTweet = useCallback(
    (tweetId: number) => {
      deleteTweetMutation.mutate(tweetId)
    },
    [deleteTweetMutation],
  )

  const handleDeleteTopic = useCallback(
    (topicId: number) => {
      deleteTopicMutation.mutate(topicId)
    },
    [deleteTopicMutation],
  )

  const handleUpdateTopicTitle = useCallback(
    (topicId: number, title: string) => {
      updateTopicMutation.mutate({ id: topicId, title })
    },
    [updateTopicMutation],
  )

  const handleSetOg = useCallback(
    (topicId: number, tweetId: number | null) => {
      updateTopicMutation.mutate({ id: topicId, og_tweet_id: tweetId })
    },
    [updateTopicMutation],
  )

  const handleSetCategory = useCallback(
    (tweetId: number, topicId: number, category: string | null) => {
      assignMutation.mutate({ tweet_ids: [tweetId], topic_id: topicId, category })
    },
    [assignMutation],
  )

  const handleMoveToTopic = useCallback(
    (tweetId: number, fromTopicId: number, toTopicId: number) => {
      if (fromTopicId) {
        unassignMutation.mutate({ tweet_ids: [tweetId], topic_id: fromTopicId })
      }
      if (toTopicId) {
        assignMutation.mutate({ tweet_ids: [tweetId], topic_id: toTopicId })
      }
      undo.push({
        label: 'Tweet moved',
        undo: () => {
          if (toTopicId) unassignMutation.mutate({ tweet_ids: [tweetId], topic_id: toTopicId })
          if (fromTopicId) assignMutation.mutate({ tweet_ids: [tweetId], topic_id: fromTopicId })
        },
      })
    },
    [assignMutation, unassignMutation, undo],
  )

  const handleCreateTopicAndMove = useCallback(
    (tweetId: number, fromTopicId: number, title: string) => {
      createTopicMutation.mutate({ title, date }, {
        onSuccess: (newTopic: { id: number }) => {
          if (fromTopicId) {
            unassignMutation.mutate({ tweet_ids: [tweetId], topic_id: fromTopicId })
          }
          assignMutation.mutate({ tweet_ids: [tweetId], topic_id: newTopic.id })
        },
      })
    },
    [createTopicMutation, assignMutation, unassignMutation, date],
  )

  const handleContextMenu = useCallback((e: React.MouseEvent, tweet: Tweet, topicId?: number, ogTweetId?: number | null) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, tweet, topicId, ogTweetId })
  }, [])

  const handleTopicContextMenu = useCallback((e: React.MouseEvent, topicId: number, title: string) => {
    e.preventDefault()
    setTopicContextMenu({ x: e.clientX, y: e.clientY, topicId, title })
  }, [])

  const handleTopicMoveToDate = useCallback(
    (topicId: number, targetDate: string) => {
      updateTopicMutation.mutate({ id: topicId, date: targetDate })
      undo.push({
        label: 'Topic moved to ' + targetDate,
        undo: () => updateTopicMutation.mutate({ id: topicId, date }),
      })
    },
    [updateTopicMutation, undo, date],
  )

  const handleTopicGenerateScript = useCallback(
    (topicId: number) => {
      generateScript.mutate({ topicId, model: genModel })
    },
    [generateScript, genModel],
  )

  const handleMoveToDate = useCallback(
    (tweetId: number, targetDate: string) => {
      const originalDate = date
      patchTweetMutation.mutate({ id: tweetId, saved_at: `${targetDate}T12:00:00` })
      undo.push({
        label: 'Tweet moved to ' + targetDate,
        undo: () => patchTweetMutation.mutate({ id: tweetId, saved_at: `${originalDate}T12:00:00` }),
      })
    },
    [patchTweetMutation, undo, date],
  )

  // Drag handlers
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const tweet = event.active.data.current?.tweet as Tweet | undefined
      if (tweet) setActiveDragTweet(tweet)
    },
    [setActiveDragTweet],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragTweet(null)

      const { active, over } = event
      if (!over) return

      const tweet = active.data.current?.tweet as Tweet | undefined
      const sourceTopicId = active.data.current?.sourceTopicId as number | null
      if (!tweet) return

      const overId = over.id as string

      if (overId === 'droppable-unsorted') {
        if (sourceTopicId === null) return
        handleUnassign([tweet.id], sourceTopicId)
      } else if (overId.startsWith('droppable-topic-')) {
        const targetTopicId = parseInt(overId.replace('droppable-topic-', ''), 10)

        if (sourceTopicId === null) {
          handleAssign([tweet.id], targetTopicId)
        } else if (sourceTopicId === targetTopicId) {
          return
        } else {
          unassignMutation.mutate({ tweet_ids: [tweet.id], topic_id: sourceTopicId })
          assignMutation.mutate({ tweet_ids: [tweet.id], topic_id: targetTopicId })
          undo.push({
            label: 'Tweet reassigned',
            undo: () => {
              unassignMutation.mutate({ tweet_ids: [tweet.id], topic_id: targetTopicId })
              assignMutation.mutate({ tweet_ids: [tweet.id], topic_id: sourceTopicId })
            },
          })
        }
      }
    },
    [handleAssign, handleUnassign, assignMutation, unassignMutation, undo, setActiveDragTweet],
  )

  const isLoading = bundleQuery.isLoading

  return (
    <div
      data-active-feed={isActive ? 'true' : undefined}
      style={{
        overflowY: 'auto',
        height: '100%',
        padding: '0 16px 80px',
      }}
    >
      {/* Loading state */}
      {isLoading && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '60px 0',
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: 'var(--text-tertiary)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 14,
                border: '2px solid var(--border-strong)',
                borderTopColor: 'var(--accent)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            Loading...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Content when loaded */}
      {!isLoading && (
        <>
        {/* Generating indicator */}
        {generateAll.isPending && (
          <div style={{ padding: '8px 0', marginBottom: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
            Generating scripts...
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* Empty state */}
          {unsortedTweets.length === 0 && topics.length === 0 && !search && (
            <div
              style={{
                textAlign: 'center',
                padding: '80px 0 40px',
              }}
            >
              <div
                style={{
                  fontSize: 36,
                  marginBottom: 16,
                  opacity: 0.3,
                }}
              >
                &#9776;
              </div>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  marginBottom: 8,
                }}
              >
                No tweets for this day
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-tertiary)', maxWidth: 360, margin: '0 auto' }}>
                Save tweets from Twitter using the Chrome extension, and they will appear here.
              </p>
            </div>
          )}

          {/* Unsorted section */}
          <UnsortedSection
            tweets={unsortedTweets}
            onDelete={handleDeleteTweet}
            onContextMenu={handleContextMenu}
          />

          {/* Topic sections (vertical feed) */}
          {topics.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {sortTopics(topics).map((topic) => {
                const filteredTweets = search
                  ? topic.tweets.filter((t) =>
                      t.text.toLowerCase().includes(search.toLowerCase()) ||
                      t.author_handle.toLowerCase().includes(search.toLowerCase()) ||
                      (t.author_display_name?.toLowerCase().includes(search.toLowerCase()) ?? false)
                    )
                  : topic.tweets
                return (
                  <TopicSectionWithData
                    key={topic.id}
                    topicId={topic.id}
                    title={topic.title}
                    color={topic.color}
                    date={date}
                    search=""
                    ogTweetId={topic.og_tweet_id}
                    tweets={filteredTweets}
                    onUpdateTitle={handleUpdateTopicTitle}
                    onContextMenu={handleContextMenu}
                    onTopicContextMenu={handleTopicContextMenu}
                  />
                )
              })}
            </div>
          )}

          {/* Create topic form (only if active) */}
          {isActive && (
            <div style={{ marginTop: 16, maxWidth: 600 }}>
              <CreateTopicForm
                onSubmit={handleCreateTopic}
                loading={createTopicMutation.isPending}
                topicCount={topics.length}
              />
            </div>
          )}

          {/* Drag overlay */}
          <DragOverlay>
            {activeDragTweet ? <DragOverlayCard tweet={activeDragTweet} /> : null}
          </DragOverlay>
        </DndContext>
        </>
      )}

      {/* Tweet context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tweet={contextMenu.tweet}
          topicId={contextMenu.topicId}
          onClose={() => setContextMenu(null)}
          onDelete={handleDeleteTweet}
          onMoveToDate={handleMoveToDate}
          onSetOg={contextMenu.topicId ? handleSetOg : undefined}
          ogTweetId={contextMenu.ogTweetId ?? null}
          onSetCategory={contextMenu.topicId && !topics.find(t => t.id === contextMenu.topicId && isKekTopic(t.title)) ? handleSetCategory : undefined}
          topics={topics}
          onMoveToTopic={handleMoveToTopic}
          onCreateTopicAndMove={handleCreateTopicAndMove}
        />
      )}

      {/* Topic context menu */}
      {topicContextMenu && (
        <TopicContextMenu
          x={topicContextMenu.x}
          y={topicContextMenu.y}
          topicId={topicContextMenu.topicId}
          topicTitle={topicContextMenu.title}
          onClose={() => setTopicContextMenu(null)}
          onDelete={handleDeleteTopic}
          onMoveToDate={handleTopicMoveToDate}
          onGenerateScript={handleTopicGenerateScript}
        />
      )}

      {/* Undo toast */}
      <UndoToast
        action={undo.toast}
        onUndo={undo.undoLast}
        onDismiss={undo.dismissToast}
      />

      {/* Generate scripts modal */}
      {genPanelOpen && topics.length > 0 && (
        <GenerateScriptsModal
          topics={sortTopics(topics)}
          selectedTopicIds={selectedTopicIds}
          allSelected={allSelected}
          genModel={genModel}
          isPending={generateAll.isPending}
          onToggleTopic={toggleTopicId}
          onToggleAll={() => {
            if (allSelected) setSelectedTopicIds(new Set())
            else setSelectedTopicIds(new Set(topics.map((t) => t.id)))
          }}
          onModelChange={setGenModel}
          onGenerate={() => {
            generateAll.mutate({
              date,
              model: genModel,
              topicIds: allSelected ? undefined : Array.from(selectedTopicIds),
            })
            onGenPanelClose()
          }}
          onClose={onGenPanelClose}
        />
      )}
    </div>
  )
}

function GenerateScriptsModal({
  topics,
  selectedTopicIds,
  allSelected,
  genModel,
  isPending,
  onToggleTopic,
  onToggleAll,
  onModelChange,
  onGenerate,
  onClose,
}: {
  topics: { id: number; title: string; color: string | null }[]
  selectedTopicIds: Set<number>
  allSelected: boolean
  genModel: string
  isPending: boolean
  onToggleTopic: (id: number) => void
  onToggleAll: () => void
  onModelChange: (model: string) => void
  onGenerate: () => void
  onClose: () => void
}) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          minWidth: 340,
          maxWidth: 440,
          width: '100%',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Generate Scripts
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-tertiary)',
              fontSize: 18,
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Select/Deselect All */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            padding: '6px 8px',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 4,
            color: 'var(--text-primary)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleAll}
            style={{ accentColor: 'var(--accent)' }}
          />
          {allSelected ? 'Deselect All' : 'Select All'}
        </label>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 0 4px' }} />

        {/* Topic list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16, maxHeight: 320, overflowY: 'auto' }}>
          {topics.map((topic) => {
            const isSelected = selectedTopicIds.has(topic.id)
            return (
              <label
                key={topic.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleTopic(topic.id)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: topic.color || 'var(--text-tertiary)',
                    flexShrink: 0,
                  }}
                />
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--text-primary)',
                }}>
                  {topic.title}
                </span>
              </label>
            )
          })}
        </div>

        {/* Model + Generate */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={genModel}
            onChange={(e) => onModelChange(e.target.value)}
            style={{
              flex: 1,
              fontSize: 12,
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
            }}
          >
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            onClick={onGenerate}
            disabled={selectedTopicIds.size === 0 || isPending}
            style={{
              fontSize: 13,
              padding: '6px 16px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: selectedTopicIds.size === 0 || isPending ? 'var(--bg-elevated)' : 'var(--accent)',
              color: selectedTopicIds.size === 0 || isPending ? 'var(--text-tertiary)' : '#fff',
              cursor: selectedTopicIds.size === 0 || isPending ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {`Generate ${allSelected ? 'All' : selectedTopicIds.size} Script${allSelected || selectedTopicIds.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
