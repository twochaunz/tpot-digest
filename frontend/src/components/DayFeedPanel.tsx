import { useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { useTweets, useAssignTweets, useUnassignTweets, useDeleteTweet, usePatchTweet } from '../api/tweets'
import type { Tweet } from '../api/tweets'
import { useTopics, useCreateTopic, useDeleteTopic, useUpdateTopic } from '../api/topics'
import { useUndo } from '../hooks/useUndo'
import { UnsortedSection } from './UnsortedSection'
import { TopicSectionWithData } from './TopicSection'
import { CreateTopicForm } from './CreateTopicForm'
import { UndoToast } from './UndoToast'
import { DragOverlayCard } from './DragOverlayCard'
import { ContextMenu } from './ContextMenu'
import { sortTopics, isKekTopic } from '../utils/topics'

interface DayFeedPanelProps {
  date: string
  search: string
  isActive: boolean
  onTweetClick: (tweet: Tweet) => void
  activeDragTweet: Tweet | null
  setActiveDragTweet: (tweet: Tweet | null) => void
}

export function DayFeedPanel({
  date,
  search,
  isActive,
  onTweetClick,
  activeDragTweet,
  setActiveDragTweet,
}: DayFeedPanelProps) {
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tweet: Tweet; topicId?: number; ogTweetId?: number | null } | null>(null)

  // Data fetching
  const topicsQuery = useTopics(date)
  const unsortedQuery = useTweets({ date, unassigned: true, q: search || undefined })

  const topics = topicsQuery.data ?? []
  const unsortedTweets = unsortedQuery.data ?? []

  // Mutations
  const assignMutation = useAssignTweets()
  const unassignMutation = useUnassignTweets()
  const createTopicMutation = useCreateTopic()
  const deleteTweetMutation = useDeleteTweet()
  const deleteTopicMutation = useDeleteTopic()
  const updateTopicMutation = useUpdateTopic()
  const patchTweetMutation = usePatchTweet()

  // Undo
  const undo = useUndo(date)

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

  const handleContextMenu = useCallback((e: React.MouseEvent, tweet: Tweet, topicId?: number, ogTweetId?: number | null) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, tweet, topicId, ogTweetId })
  }, [])

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

  const isLoading = topicsQuery.isLoading || unsortedQuery.isLoading

  return (
    <div
      data-active-feed={isActive ? 'true' : undefined}
      style={{
        overflowY: 'auto',
        height: '100%',
        padding: '20px 16px 80px',
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
            onTweetClick={onTweetClick}
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
              {sortTopics(topics).map((topic) => (
                <TopicSectionWithData
                  key={topic.id}
                  topicId={topic.id}
                  title={topic.title}
                  color={topic.color}
                  date={date}
                  search={search}
                  ogTweetId={topic.og_tweet_id}
                  onDelete={handleDeleteTopic}
                  onUpdateTitle={handleUpdateTopicTitle}
                  onSetOg={handleSetOg}
                  onTweetClick={onTweetClick}
                  onContextMenu={handleContextMenu}
                />
              ))}
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
      )}

      {/* Context menu */}
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
        />
      )}

      {/* Undo toast */}
      <UndoToast
        action={undo.toast}
        onUndo={undo.undoLast}
        onDismiss={undo.dismissToast}
      />
    </div>
  )
}
