import { useState, useEffect, useRef, useCallback } from 'react'
import type { TopicBundle } from '../api/dayBundle'
import { type ScriptBlock, type TopicScript, useTopicScript, useUpdateScript } from '../api/scripts'
import type { Tweet } from '../api/tweets'
import { ScriptTextBlock } from './DayScriptView'
import { TweetCard } from './TweetCard'
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

/* ---- Block gutter with drag handle, delete + swap controls ---- */
function BlockGutter({ block, blockIndex, script, tweets, onUpdateContent, dragHandleProps }: {
  block: ScriptBlock
  blockIndex: number
  script: TopicScript
  tweets: Tweet[]
  onUpdateContent: (content: ScriptBlock[]) => void
  dragHandleProps?: Record<string, unknown>
}) {
  const [swapOpen, setSwapOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  /* Close swap picker on click-outside */
  useEffect(() => {
    if (!swapOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSwapOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [swapOpen])

  /* Delete handler */
  const handleDelete = useCallback(() => {
    const newContent = script.content.filter((_, i) => i !== blockIndex)
    onUpdateContent(newContent)
  }, [script.content, blockIndex, onUpdateContent])

  /* Swap handler — replace tweet_id at this index */
  const handleSwap = useCallback((newTweetId: string) => {
    const newContent = script.content.map((b, i) =>
      i === blockIndex ? { ...b, tweet_id: newTweetId } : b
    )
    onUpdateContent(newContent)
    setSwapOpen(false)
  }, [script.content, blockIndex, onUpdateContent])

  /* Tweets in script (to exclude from swap picker) */
  const tweetIdsInScript = new Set(
    script.content.filter(b => b.type === 'tweet' && b.tweet_id).map(b => b.tweet_id!)
  )
  const availableTweets = tweets.filter(t => !tweetIdsInScript.has(t.tweet_id))

  return (
    <div style={{
      width: 32,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: 6,
      gap: 2,
      position: 'relative',
    }}>
      {/* Drag handle */}
      <span
        {...dragHandleProps}
        style={{
          cursor: 'grab',
          color: 'var(--text-tertiary)',
          fontSize: 14,
          lineHeight: 1,
          padding: '2px 4px',
          userSelect: 'none',
          touchAction: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
        }}
        title="Drag to reorder"
      >
        &#10303;
      </span>

      {/* Delete button */}
      <button
        onClick={handleDelete}
        title="Delete block"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          lineHeight: 1,
          fontSize: 14,
          color: 'var(--text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 4,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#e53e3e' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)' }}
      >
        &times;
      </button>

      {/* Swap button — tweet blocks only */}
      {block.type === 'tweet' && (
        <button
          onClick={() => setSwapOpen(!swapOpen)}
          title="Swap tweet"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1,
            fontSize: 12,
            color: 'var(--text-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            borderRadius: 4,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)' }}
        >
          &#8660;
        </button>
      )}

      {/* Swap picker dropdown */}
      {swapOpen && block.type === 'tweet' && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            left: 32,
            top: 0,
            width: 320,
            maxHeight: 300,
            overflowY: 'auto',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            zIndex: 100,
            padding: 4,
          }}
        >
          {availableTweets.length === 0 ? (
            <div style={{
              padding: '12px 10px',
              color: 'var(--text-tertiary)',
              fontSize: 13,
              textAlign: 'center',
            }}>
              No other tweets available
            </div>
          ) : (
            availableTweets.map(tweet => (
              <div
                key={tweet.tweet_id}
                onClick={() => handleSwap(tweet.tweet_id)}
                style={{
                  padding: '8px 10px',
                  cursor: 'pointer',
                  borderRadius: 6,
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.4,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  @{tweet.author_handle}
                </span>
                {': '}
                {tweet.text.length > 80 ? tweet.text.slice(0, 80) + '...' : tweet.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/* ---- Editable block (text or tweet) with left gutter — sortable ---- */
function EditableBlock({ id, block, blockIndex, script, topicId, tweets, onUpdateContent }: {
  id: string
  block: ScriptBlock
  blockIndex: number
  script: TopicScript
  topicId: number
  tweets: Tweet[]
  onUpdateContent: (content: ScriptBlock[]) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    display: 'flex',
    alignItems: 'flex-start',
  }

  return (
    <div ref={setNodeRef} style={style}>
      <BlockGutter
        block={block}
        blockIndex={blockIndex}
        script={script}
        tweets={tweets}
        onUpdateContent={onUpdateContent}
        dragHandleProps={{ ...attributes, ...listeners }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        {block.type === 'text' && block.text && (
          <ScriptTextBlock
            text={block.text}
            blockIndex={blockIndex}
            script={script}
            topicId={topicId}
          />
        )}
        {block.type === 'tweet' && block.tweet_id && (() => {
          const tweet = tweets.find(t => t.tweet_id === block.tweet_id)
          if (!tweet) return null
          return (
            <div data-tweet-id={block.tweet_id} style={{ margin: '8px 0' }}>
              <TweetCard tweet={tweet} selectable={false} />
            </div>
          )
        })()}
      </div>
    </div>
  )
}

/* ---- Insert button between blocks ---- */
function InsertButton({ index, script, tweets, onUpdateContent }: {
  index: number
  script: TopicScript
  tweets: Tweet[]
  onUpdateContent: (content: ScriptBlock[]) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showTweetList, setShowTweetList] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  /* Close menu on click-outside */
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setShowTweetList(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  /* Tweets NOT already in the script */
  const tweetIdsInScript = new Set(
    script.content.filter(b => b.type === 'tweet' && b.tweet_id).map(b => b.tweet_id!)
  )
  const availableTweets = tweets.filter(t => !tweetIdsInScript.has(t.tweet_id))

  const handleInsertText = () => {
    const newContent = [...script.content]
    newContent.splice(index, 0, { type: 'text', text: 'New text...' })
    onUpdateContent(newContent)
    setMenuOpen(false)
    setShowTweetList(false)
  }

  const handleInsertTweet = (tweetId: string) => {
    const newContent = [...script.content]
    newContent.splice(index, 0, { type: 'tweet', tweet_id: tweetId })
    onUpdateContent(newContent)
    setMenuOpen(false)
    setShowTweetList(false)
  }

  const visible = hovered || menuOpen

  return (
    <div
      style={{
        position: 'relative',
        height: 20,
        marginLeft: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Horizontal line */}
      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '50%',
        height: 1,
        background: visible ? 'var(--border-strong)' : 'transparent',
        transition: 'all 0.15s',
      }} />

      {/* Plus button */}
      <button
        onClick={() => {
          setMenuOpen(!menuOpen)
          setShowTweetList(false)
        }}
        style={{
          position: 'relative',
          zIndex: 1,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: visible ? 'var(--accent)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          transition: 'all 0.15s',
        }}
      >
        <span style={{
          color: visible ? '#fff' : 'transparent',
          fontSize: 14,
          lineHeight: 1,
          fontWeight: 600,
          transition: 'all 0.15s',
        }}>
          +
        </span>
      </button>

      {/* Insert menu popover */}
      {menuOpen && (
        <div
          ref={menuRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            zIndex: 100,
            padding: 4,
            minWidth: showTweetList ? 320 : 140,
          }}
        >
          {!showTweetList ? (
            <>
              <div
                onClick={handleInsertText}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderRadius: 6,
                  fontSize: 13,
                  color: 'var(--text-primary)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                Text
              </div>
              <div
                onClick={() => setShowTweetList(true)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderRadius: 6,
                  fontSize: 13,
                  color: 'var(--text-primary)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                Tweet
              </div>
            </>
          ) : (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {availableTweets.length === 0 ? (
                <div style={{
                  padding: '12px 10px',
                  color: 'var(--text-tertiary)',
                  fontSize: 13,
                  textAlign: 'center',
                }}>
                  No tweets available
                </div>
              ) : (
                availableTweets.map(tweet => (
                  <div
                    key={tweet.tweet_id}
                    onClick={() => handleInsertTweet(tweet.tweet_id)}
                    style={{
                      padding: '8px 10px',
                      cursor: 'pointer',
                      borderRadius: 6,
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.4,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      @{tweet.author_handle}
                    </span>
                    {': '}
                    {tweet.text.length > 60 ? tweet.text.slice(0, 60) + '...' : tweet.text}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ---- Per-topic edit section ---- */
function TopicEditSection({ topicId, tweets }: {
  topicId: number
  tweets: Tweet[]
}) {
  const { data: script, isLoading } = useTopicScript(topicId)
  const updateScript = useUpdateScript()

  const updateContent = useCallback((newContent: ScriptBlock[]) => {
    updateScript.mutate({ topicId, content: newContent })
  }, [topicId, updateScript])

  // DnD sensors — require 5px movement before drag starts
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (!script) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = parseInt((active.id as string).replace('block-', ''), 10)
    const newIndex = parseInt((over.id as string).replace('block-', ''), 10)
    if (isNaN(oldIndex) || isNaN(newIndex)) return

    const newContent = arrayMove(script.content, oldIndex, newIndex)
    updateContent(newContent)
  }, [script, updateContent])

  /* Loading state */
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '20px 0',
        color: 'var(--text-tertiary)',
        fontSize: 13,
      }}>
        <span style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          border: '2px solid var(--border-strong)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        Loading script...
      </div>
    )
  }

  /* Empty state */
  if (!script) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
        No script generated yet.
      </div>
    )
  }

  /* Stable sortable IDs for each block */
  const blockIds = script.content.map((_, idx) => `block-${idx}`)

  /* Render blocks with drag-and-drop + insert buttons interleaved */
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
        <div style={{ marginBottom: 8 }}>
          {/* Insert button before first block */}
          <InsertButton
            index={0}
            script={script}
            tweets={tweets}
            onUpdateContent={updateContent}
          />

          {script.content.map((block, idx) => (
            <div key={`${topicId}-block-${idx}`}>
              <EditableBlock
                id={`block-${idx}`}
                block={block}
                blockIndex={idx}
                script={script}
                topicId={topicId}
                tweets={tweets}
                onUpdateContent={updateContent}
              />

              {/* Insert button after each block */}
              <InsertButton
                index={idx + 1}
                script={script}
                tweets={tweets}
                onUpdateContent={updateContent}
              />
            </div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

/* ---- Main ScriptEditView ---- */
interface ScriptEditViewProps {
  topics: TopicBundle[]
}

export function ScriptEditView({ topics }: ScriptEditViewProps) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {topics.map((topic, idx) => (
        <div key={topic.id}>
          {/* Topic header — colored dot + title (same style as ScriptMirrorView) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 0 8px', borderBottom: '2px solid var(--border)', marginBottom: 12,
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: topic.color || 'var(--text-tertiary)', flexShrink: 0,
            }} />
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>
              {topic.title}
            </span>
          </div>

          <TopicEditSection topicId={topic.id} tweets={topic.tweets} />

          {/* Divider between topics */}
          {idx < topics.length - 1 && (
            <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
          )}
        </div>
      ))}

      {topics.length === 0 && (
        <div style={{
          padding: '40px 0',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 14,
        }}>
          No topics selected. Select topics in the Topics tab.
        </div>
      )}
    </div>
  )
}
