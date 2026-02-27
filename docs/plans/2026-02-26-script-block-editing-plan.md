# Script Block Editing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated Edit tab for adding, editing, swapping, deleting, and reordering script blocks, with hover-activated plus buttons and left-gutter controls.

**Architecture:** New `ScriptEditView` component renders a single-column editor per topic. Each block gets a left gutter with drag handle, delete, and swap (tweet-only) icons. Hover zones between blocks show `+` buttons that insert text or tweet blocks. All edits call the existing `PATCH /api/topics/{topic_id}/script` endpoint — no backend changes.

**Tech Stack:** React 19, TypeScript, @dnd-kit (already installed), TanStack React Query, existing `useUpdateScript()` hook.

---

### Task 1: Add Edit Tab to ScriptPanel

**Files:**
- Modify: `frontend/src/components/ScriptPanel.tsx`

**Step 1: Change activeView type from `'topics' | 'script'` to `'topics' | 'edit' | 'script'`**

In `ScriptPanel.tsx:17`, update the useState type:
```tsx
const [activeView, setActiveView] = useState<'topics' | 'edit' | 'script'>('topics')
```

**Step 2: Update `g` key cycling to include edit**

In `ScriptPanel.tsx:109`, change the toggle to cycle three ways:
```tsx
if (e.key === 'g') {
  e.preventDefault()
  setActiveView(prev => prev === 'topics' ? 'edit' : prev === 'edit' ? 'script' : 'topics')
}
```

**Step 3: Add Edit tab button in header between Topics and Script**

After the Topics button (around line 172), add:
```tsx
<button
  onClick={() => setActiveView('edit')}
  style={{
    background: 'none',
    border: 'none',
    color: activeView === 'edit' ? 'var(--text-primary)' : 'var(--text-tertiary)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '4px 10px',
    borderBottom: activeView === 'edit' ? '2px solid var(--accent)' : '2px solid transparent',
  }}
>
  Edit
</button>
```

**Step 4: Add placeholder Edit view container**

After the Topics view container (around line 217), add:
```tsx
<div style={{
  display: activeView === 'edit' ? 'flex' : 'none',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
}}>
  <ScriptEditView topics={selectedTopics} />
</div>
```

Import `ScriptEditView` from `./ScriptEditView` at top of file.

**Step 5: Rename "Script" tab label to "Present"**

Change the Script tab button text from `Script` to `Present`.

**Step 6: Verify build compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: Passes (once ScriptEditView exists — created in Task 2)

**Step 7: Commit**

```
feat: add Edit tab to ScriptPanel with three-way tab cycling
```

---

### Task 2: Create ScriptEditView Component (Skeleton)

**Files:**
- Create: `frontend/src/components/ScriptEditView.tsx`

**Step 1: Create the component with basic topic-section rendering**

```tsx
import { useCallback } from 'react'
import type { TopicBundle } from '../api/dayBundle'
import {
  type ScriptBlock,
  type TopicScript,
  useTopicScript,
  useUpdateScript,
} from '../api/scripts'
import type { Tweet } from '../api/tweets'
import { ScriptTextBlock, TweetRows, groupBlocks } from './DayScriptView'
import { TweetCard } from './TweetCard'

interface ScriptEditViewProps {
  topics: TopicBundle[]
}

export function ScriptEditView({ topics }: ScriptEditViewProps) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
      {topics.map((topic, idx) => (
        <div key={topic.id}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 0 8px', borderBottom: '2px solid var(--border)', marginBottom: 12,
          }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: topic.color || 'var(--text-tertiary)', flexShrink: 0 }} />
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>{topic.title}</span>
          </div>
          <TopicEditSection topicId={topic.id} tweets={topic.tweets} />
          {idx < topics.length - 1 && <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />}
        </div>
      ))}
    </div>
  )
}

function TopicEditSection({ topicId, tweets }: { topicId: number; tweets: Tweet[] }) {
  const { data: script, isLoading } = useTopicScript(topicId)
  const updateScript = useUpdateScript()

  const updateContent = useCallback((newContent: ScriptBlock[]) => {
    updateScript.mutate({ topicId, content: newContent })
  }, [topicId, updateScript])

  if (isLoading) {
    return <div style={{ padding: '20px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading script...</div>
  }
  if (!script) {
    return <div style={{ padding: '12px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>No script generated yet.</div>
  }

  return (
    <div>
      {script.content.map((block, index) => (
        <EditableBlock
          key={`${topicId}-${index}`}
          block={block}
          index={index}
          script={script}
          topicId={topicId}
          tweets={tweets}
          onUpdateContent={updateContent}
        />
      ))}
    </div>
  )
}

function EditableBlock({ block, index, script, topicId, tweets, onUpdateContent }: {
  block: ScriptBlock
  index: number
  script: TopicScript
  topicId: number
  tweets: Tweet[]
  onUpdateContent: (content: ScriptBlock[]) => void
}) {
  if (block.type === 'text' && block.text) {
    return (
      <div style={{ display: 'flex', gap: 0 }}>
        <div style={{ width: 32, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <ScriptTextBlock text={block.text} blockIndex={index} script={script} topicId={topicId} />
        </div>
      </div>
    )
  }

  if (block.type === 'tweet' && block.tweet_id) {
    const tweet = tweets.find(t => t.tweet_id === block.tweet_id)
    if (!tweet) return null
    return (
      <div style={{ display: 'flex', gap: 0 }}>
        <div style={{ width: 32, flexShrink: 0 }} />
        <div style={{ flex: 1, margin: '8px 0' }}>
          <TweetCard tweet={tweet} selectable={false} />
        </div>
      </div>
    )
  }

  return null
}
```

**Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
feat: add ScriptEditView skeleton with topic sections and block rendering
```

---

### Task 3: Add Left Gutter Controls (Delete + Swap)

**Files:**
- Modify: `frontend/src/components/ScriptEditView.tsx`

**Step 1: Add delete and swap functionality to EditableBlock**

Replace the `EditableBlock` component with gutter icons. The gutter should show:
- A delete (×) icon on all blocks
- A swap (⇄) icon on tweet blocks only — clicking opens a dropdown of the topic's tweets not already in the script

```tsx
import { useState } from 'react'

function BlockGutter({ block, index, script, tweets, onUpdateContent }: {
  block: ScriptBlock
  index: number
  script: TopicScript
  tweets: Tweet[]
  onUpdateContent: (content: ScriptBlock[]) => void
}) {
  const [showSwapPicker, setShowSwapPicker] = useState(false)

  const handleDelete = () => {
    const newContent = script.content.filter((_, i) => i !== index)
    onUpdateContent(newContent)
  }

  const handleSwap = (newTweetId: string) => {
    const newContent = script.content.map((b, i) =>
      i === index ? { ...b, tweet_id: newTweetId } : b
    )
    onUpdateContent(newContent)
    setShowSwapPicker(false)
  }

  // Tweets already used in the script
  const usedTweetIds = new Set(
    script.content.filter(b => b.type === 'tweet' && b.tweet_id).map(b => b.tweet_id!)
  )
  const availableTweets = tweets.filter(t => !usedTweetIds.has(t.tweet_id))

  return (
    <div style={{
      width: 32, flexShrink: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 2, paddingTop: 6, position: 'relative',
    }}>
      {/* Delete button */}
      <button
        onClick={handleDelete}
        title="Delete block"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-tertiary)', fontSize: 14, padding: '2px 4px',
          lineHeight: 1, borderRadius: 4,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger, #e53e3e)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
      >
        ×
      </button>

      {/* Swap button (tweet blocks only) */}
      {block.type === 'tweet' && (
        <>
          <button
            onClick={() => setShowSwapPicker(!showSwapPicker)}
            title="Swap tweet"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', fontSize: 12, padding: '2px 4px',
              lineHeight: 1, borderRadius: 4,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
          >
            ⇄
          </button>

          {/* Swap picker dropdown */}
          {showSwapPicker && (
            <div style={{
              position: 'absolute', left: 32, top: 0, zIndex: 100,
              background: 'var(--bg-raised)', border: '1px solid var(--border)',
              borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              maxHeight: 300, overflowY: 'auto', width: 320, padding: 4,
            }}>
              {availableTweets.length === 0 ? (
                <div style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
                  No other tweets available
                </div>
              ) : (
                availableTweets.map(t => (
                  <div
                    key={t.tweet_id}
                    onClick={() => handleSwap(t.tweet_id)}
                    style={{
                      padding: '6px 8px', cursor: 'pointer', borderRadius: 6,
                      fontSize: 13, color: 'var(--text-secondary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <strong>@{t.author_handle}</strong>: {t.text?.slice(0, 80)}...
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

Update `EditableBlock` to use `BlockGutter` instead of the empty 32px div.

**Step 2: Add click-outside handling to close swap picker**

Use a `useEffect` with a mousedown listener on document to close the swap picker when clicking outside.

**Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```
feat: add delete and swap controls in left gutter of script edit blocks
```

---

### Task 4: Add Drag-to-Reorder Blocks

**Files:**
- Modify: `frontend/src/components/ScriptEditView.tsx`

**Step 1: Add @dnd-kit sortable to TopicEditSection**

Wrap the block list in `DndContext` + `SortableContext`. Each `EditableBlock` becomes sortable using `useSortable`. Use the same pattern as `TopicManagerView.tsx` (lines 1-19 for imports).

The sortable items use the block index as the ID. On drag end, use `arrayMove` on `script.content` and call `onUpdateContent`.

Add a drag handle (⠿) icon at the top of the `BlockGutter`:
```tsx
<div
  {...attributes}
  {...listeners}
  style={{
    cursor: 'grab', color: 'var(--text-tertiary)', fontSize: 14,
    padding: '2px 4px', lineHeight: 1,
  }}
  title="Drag to reorder"
>
  ⠿
</div>
```

**Step 2: Use stable block IDs for sortable**

Generate stable string IDs for each block: `${topicId}-${index}`. Map indices in `onDragEnd`.

**Step 3: Verify build + test drag interaction**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```
feat: add drag-to-reorder for script blocks in edit view
```

---

### Task 5: Add Plus Buttons Between Blocks

**Files:**
- Modify: `frontend/src/components/ScriptEditView.tsx`

**Step 1: Create InsertButton component**

A thin horizontal line with a centered `+` icon that appears on hover. Clicking opens a popover with "Text" and "Tweet" options.

```tsx
function InsertButton({ index, script, topicId, tweets, onUpdateContent }: {
  index: number  // insert BEFORE this index (0 = top, content.length = bottom)
  script: TopicScript
  topicId: number
  tweets: Tweet[]
  onUpdateContent: (content: ScriptBlock[]) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showTweetPicker, setShowTweetPicker] = useState(false)

  const usedTweetIds = new Set(
    script.content.filter(b => b.type === 'tweet' && b.tweet_id).map(b => b.tweet_id!)
  )
  const availableTweets = tweets.filter(t => !usedTweetIds.has(t.tweet_id))

  const insertText = () => {
    const newContent = [...script.content]
    newContent.splice(index, 0, { type: 'text', text: '' })
    onUpdateContent(newContent)
    setShowMenu(false)
  }

  const insertTweet = (tweetId: string) => {
    const newContent = [...script.content]
    newContent.splice(index, 0, { type: 'tweet', tweet_id: tweetId })
    onUpdateContent(newContent)
    setShowMenu(false)
    setShowTweetPicker(false)
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!showMenu) setHovered(false) }}
      style={{
        position: 'relative', height: 20, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        marginLeft: 32, /* align with block content, past gutter */
      }}
    >
      {/* Line + button */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: '50%',
        height: 1, background: (hovered || showMenu) ? 'var(--border-strong)' : 'transparent',
        transition: 'background 0.15s',
      }} />
      <button
        onClick={() => setShowMenu(!showMenu)}
        style={{
          position: 'relative', zIndex: 1,
          width: 20, height: 20, borderRadius: '50%',
          background: (hovered || showMenu) ? 'var(--accent)' : 'transparent',
          color: (hovered || showMenu) ? '#fff' : 'transparent',
          border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s',
        }}
      >
        +
      </button>

      {/* Insert menu */}
      {showMenu && (
        <div style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 100, background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          padding: 4, minWidth: 120,
        }}>
          <div
            onClick={insertText}
            style={{
              padding: '6px 12px', cursor: 'pointer', borderRadius: 6,
              fontSize: 13, color: 'var(--text-primary)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            Text
          </div>
          <div
            onClick={() => setShowTweetPicker(true)}
            style={{
              padding: '6px 12px', cursor: 'pointer', borderRadius: 6,
              fontSize: 13, color: 'var(--text-primary)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            Tweet
          </div>

          {/* Tweet picker sub-menu */}
          {showTweetPicker && (
            <div style={{
              borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4,
              maxHeight: 250, overflowY: 'auto',
            }}>
              {availableTweets.length === 0 ? (
                <div style={{ padding: '6px 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
                  No tweets available
                </div>
              ) : (
                availableTweets.map(t => (
                  <div
                    key={t.tweet_id}
                    onClick={() => insertTweet(t.tweet_id)}
                    style={{
                      padding: '6px 8px', cursor: 'pointer', borderRadius: 6,
                      fontSize: 12, color: 'var(--text-secondary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <strong>@{t.author_handle}</strong>: {t.text?.slice(0, 60)}...
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
```

**Step 2: Render InsertButtons between every block in TopicEditSection**

In `TopicEditSection`, interleave `InsertButton` components:
- One before the first block (index 0)
- One after each block (index i+1)

```tsx
return (
  <div>
    <InsertButton index={0} script={script} topicId={topicId} tweets={tweets} onUpdateContent={updateContent} />
    {script.content.map((block, index) => (
      <div key={`${topicId}-${index}`}>
        <EditableBlock ... />
        <InsertButton index={index + 1} script={script} topicId={topicId} tweets={tweets} onUpdateContent={updateContent} />
      </div>
    ))}
  </div>
)
```

**Step 3: Handle auto-edit for newly inserted empty text blocks**

When inserting a text block with `text: ''`, it should immediately enter editing mode. Modify `ScriptTextBlock` to accept an `autoEdit` prop, or handle this via a state variable in `TopicEditSection` that tracks "just-inserted index".

**Step 4: Add click-outside to close insert menus**

Use a document mousedown listener to close any open menus.

**Step 5: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```
feat: add hover-activated plus buttons for inserting text/tweet blocks
```

---

### Task 6: Integration Testing and Polish

**Files:**
- Modify: `frontend/src/components/ScriptEditView.tsx` (minor fixes)
- Modify: `frontend/src/components/ScriptPanel.tsx` (if needed)

**Step 1: Verify full flow manually**

Test in browser:
1. Open script panel → Topics tab works as before
2. Click Edit tab → single column, blocks render with gutter
3. Click `+` between blocks → popover appears with Text/Tweet
4. Insert text → edit mode activates immediately
5. Insert tweet → tweet card appears
6. Click × → block deleted
7. Click ⇄ on tweet → swap picker shows available tweets
8. Drag handle → blocks reorder
9. Click Present tab → two-column mirror with drawing, no edit controls
10. `g` key cycles Topics → Edit → Present → Topics

**Step 2: Verify right panel (Present mode) shows added blocks but no plus buttons**

New blocks added in Edit mode are persisted via API and appear in Present mode on both columns (text on left, tweets on both).

**Step 3: Fix any TypeScript errors**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```
fix: polish script block editing integration
```
