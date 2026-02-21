import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTweets, useAssignTweets, useUnassignTweets, useDeleteTweet } from '../api/tweets'
import type { Tweet } from '../api/tweets'
import { useTopics, useCreateTopic, useDeleteTopic } from '../api/topics'
import { useCategories, useCreateCategory, useDeleteCategory } from '../api/categories'
import { useUndo } from '../hooks/useUndo'
import { DatePicker } from '../components/DatePicker'
import { UnsortedSection } from '../components/UnsortedSection'
import { TopicSectionWithData } from '../components/TopicSection'
import { CreateTopicForm } from '../components/CreateTopicForm'
import { TweetDetailModal } from '../components/TweetDetailModal'
import { UndoToast } from '../components/UndoToast'

function todayStr(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function DailyView() {
  const navigate = useNavigate()
  const [date, setDate] = useState(todayStr)
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [detailTweet, setDetailTweet] = useState<Tweet | null>(null)

  // Data fetching
  const topicsQuery = useTopics(date)
  const categoriesQuery = useCategories()
  const unsortedQuery = useTweets({ date, unassigned: true, q: search || undefined })

  const topics = topicsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const unsortedTweets = unsortedQuery.data ?? []

  // Mutations
  const assignMutation = useAssignTweets()
  const unassignMutation = useUnassignTweets()
  const createTopicMutation = useCreateTopic()
  const deleteTweetMutation = useDeleteTweet()
  const deleteTopicMutation = useDeleteTopic()
  const createCategoryMutation = useCreateCategory()
  const deleteCategoryMutation = useDeleteCategory()

  // Undo
  const undo = useUndo(date)

  const handleAssign = useCallback(
    (tweetIds: number[], topicId: number, categoryId?: number) => {
      assignMutation.mutate({ tweet_ids: tweetIds, topic_id: topicId, category_id: categoryId })
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

  const handleCreateCategory = useCallback(
    (name: string, color: string) => {
      createCategoryMutation.mutate({ name, color })
    },
    [createCategoryMutation],
  )

  const handleDeleteCategory = useCallback(
    (id: number) => {
      deleteCategoryMutation.mutate(id)
    },
    [deleteCategoryMutation],
  )

  const handleTweetClick = useCallback((tweet: Tweet) => {
    setDetailTweet(tweet)
  }, [])

  const isLoading =
    topicsQuery.isLoading || categoriesQuery.isLoading || unsortedQuery.isLoading

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
      }}
    >
      {/* Date Bar */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'var(--bg-base)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: '0 auto',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <DatePicker value={date} onChange={setDate} />

          <div style={{ flex: 1 }} />

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search tweets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={{
                width: searchFocused || search ? 240 : 180,
                background: 'var(--bg-raised)',
                border: `1px solid ${searchFocused ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '7px 12px 7px 32px',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
                transition: 'all 0.2s ease',
                fontFamily: 'var(--font-body)',
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-tertiary)',
                fontSize: 14,
                pointerEvents: 'none',
              }}
            >
              &#8981;
            </span>
          </div>

          {/* Settings */}
          <button
            onClick={() => navigate('/settings')}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 16,
              transition: 'all 0.15s ease',
            }}
            aria-label="Settings"
          >
            &#9881;
          </button>
        </div>
      </header>

      {/* Main content */}
      <main
        style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: '24px 24px 80px',
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
              topics={topics}
              categories={categories}
              onAssign={handleAssign}
              onDelete={handleDeleteTweet}
              onTweetClick={handleTweetClick}
              onCreateCategory={handleCreateCategory}
              onDeleteCategory={handleDeleteCategory}
            />

            {/* Kanban topic columns */}
            {topics.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  overflowX: 'auto',
                  paddingBottom: 16,
                  minHeight: 300,
                }}
              >
                {topics.map((topic) => (
                  <TopicSectionWithData
                    key={topic.id}
                    topicId={topic.id}
                    title={topic.title}
                    color={topic.color}
                    date={date}
                    search={search}
                    onUnassign={handleUnassign}
                    onDelete={handleDeleteTopic}
                    onTweetClick={handleTweetClick}
                  />
                ))}

                {/* Create topic card at end of row */}
                <div style={{ width: 280, flexShrink: 0 }}>
                  <CreateTopicForm
                    onSubmit={handleCreateTopic}
                    loading={createTopicMutation.isPending}
                    topicCount={topics.length}
                  />
                </div>
              </div>
            )}

            {/* If no topics yet, show create form standalone */}
            {topics.length === 0 && (
              <div style={{ marginTop: 24 }}>
                <CreateTopicForm
                  onSubmit={handleCreateTopic}
                  loading={createTopicMutation.isPending}
                  topicCount={0}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* Tweet detail modal */}
      {detailTweet && (
        <TweetDetailModal
          tweet={detailTweet}
          onClose={() => setDetailTweet(null)}
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
