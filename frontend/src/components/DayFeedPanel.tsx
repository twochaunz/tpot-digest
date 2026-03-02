import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import ScriptPanel from './ScriptPanel'
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
import { useAuth } from '../contexts/AuthContext'
import { useMinWidth } from '../hooks/useMediaQuery'

interface DayFeedPanelProps {
  date: string
  search: string
  isActive: boolean
  activeDragTweet: Tweet | null
  setActiveDragTweet: (tweet: Tweet | null) => void
  genPanelOpen: boolean
  onGenPanelClose: () => void
  initialTopicNum?: number | null
  isRightOfActive?: boolean
}

export function DayFeedPanel({
  date,
  search,
  isActive,
  activeDragTweet,
  setActiveDragTweet,
  genPanelOpen,
  onGenPanelClose,
  initialTopicNum,
  isRightOfActive,
}: DayFeedPanelProps) {
  const { isAdmin } = useAuth()
  const isWide = useMinWidth(900)

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

  // Scroll to initial topic number (1-indexed, based on sorted order) on first load
  const didScrollToTopic = useRef(false)
  useEffect(() => {
    if (!initialTopicNum || didScrollToTopic.current || !bundle?.topics?.length) return
    const sorted = sortTopics(bundle.topics)
    const targetTopic = sorted[initialTopicNum - 1]
    if (!targetTopic) return
    didScrollToTopic.current = true
    requestAnimationFrame(() => {
      const el = document.getElementById(`toc-topic-${targetTopic.id}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [initialTopicNum, bundle?.topics])

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
    (tweetId: number, fromTopicId: number, toTopicId: number, category?: string) => {
      if (fromTopicId) {
        unassignMutation.mutate({ tweet_ids: [tweetId], topic_id: fromTopicId })
      }
      if (toTopicId) {
        assignMutation.mutate({ tweet_ids: [tweetId], topic_id: toTopicId, category: category ?? null })
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
        padding: isWide ? '0 16px 80px 40px' : '0 8px 80px 8px',
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
      {!isLoading && (() => {
        const feedContent = (
          <>
            {/* Empty state */}
            {unsortedTweets.length === 0 && topics.length === 0 && !search && (() => {
              const [y, m, d] = date.split('-').map(Number)
              const panelDate = new Date(y, m - 1, d)
              const formattedDate = `${panelDate.getMonth() + 1}/${panelDate.getDate()}`

              return (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '80px 0 40px',
                  }}
                >
                  {isRightOfActive ? (
                    <>
                      <h2
                        style={{
                          fontSize: 24,
                          fontWeight: 600,
                          color: 'var(--text-secondary)',
                          marginBottom: 24,
                        }}
                      >
                        {formattedDate}'s feed is empty.
                      </h2>
                      <p style={{ fontSize: 18, color: 'var(--text-tertiary)' }}>
                        lock in or go touch grass.
                      </p>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              )
            })()}

            {/* Unsorted section */}
            <UnsortedSection
              tweets={unsortedTweets}
              onDelete={handleDeleteTweet}
              onContextMenu={isAdmin ? handleContextMenu : undefined}
              isAdmin={isAdmin}
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
                      onContextMenu={isAdmin ? handleContextMenu : undefined}
                      onTopicContextMenu={isAdmin ? handleTopicContextMenu : undefined}
                      isAdmin={isAdmin}
                    />
                  )
                })}
              </div>
            )}

            {/* Create topic form (only if active and admin) */}
            {isAdmin && isActive && (
              <div style={{ marginTop: 16, maxWidth: 600 }}>
                <CreateTopicForm
                  onSubmit={handleCreateTopic}
                  loading={createTopicMutation.isPending}
                  topicCount={topics.length}
                />
              </div>
            )}

            {/* Drag overlay (admin only) */}
            {isAdmin && (
              <DragOverlay>
                {activeDragTweet ? <DragOverlayCard tweet={activeDragTweet} /> : null}
              </DragOverlay>
            )}
          </>
        )

        return isAdmin ? (
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {feedContent}
          </DndContext>
        ) : feedContent
      })()}

      {/* Tweet context menu (admin only) */}
      {isAdmin && contextMenu && (
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
          topics={topics.map(t => ({
            ...t,
            categories: [...new Set(t.tweets.map(tw => tw.category).filter(Boolean) as string[])],
          }))}
          onMoveToTopic={handleMoveToTopic}
          onCreateTopicAndMove={handleCreateTopicAndMove}
        />
      )}

      {/* Topic context menu (admin only) */}
      {isAdmin && topicContextMenu && (
        <TopicContextMenu
          x={topicContextMenu.x}
          y={topicContextMenu.y}
          topicId={topicContextMenu.topicId}
          topicTitle={topicContextMenu.title}
          onClose={() => setTopicContextMenu(null)}
          onDelete={handleDeleteTopic}
          onMoveToDate={handleTopicMoveToDate}
        />
      )}

      {/* Undo toast (admin only) */}
      {isAdmin && (
        <UndoToast
          action={undo.toast}
          onUndo={undo.undoLast}
          onDismiss={undo.dismissToast}
        />
      )}

      {/* Unified script panel */}
      {genPanelOpen && topics.length > 0 && (
        <ScriptPanel date={date} topics={topics} onClose={onGenPanelClose} />
      )}
    </div>
  )
}
