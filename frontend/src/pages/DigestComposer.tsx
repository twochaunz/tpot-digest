import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useDayBundle } from '../api/dayBundle'
import { sortTopics } from '../utils/topics'
import {
  type DigestBlock,
  useDigestDrafts,
  useDigestDraft,
  useCreateDigestDraft,
  useUpdateDigestDraft,
  useDeleteDigestDraft,
  useDigestPreview,
  useSendTestDigest,
  useSendDigest,
  useSubscriberCount,
} from '../api/digest'
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

function todayDateStr(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

let _blockCounter = 0
function nextBlockId(): string {
  return `block-${Date.now()}-${_blockCounter++}`
}

/* ---- Sortable block row ---- */
function SortableBlock({
  block,
  topics,
  isSent,
  onUpdateBlock,
  onDeleteBlock,
}: {
  block: DigestBlock
  topics: { id: number; title: string; color: string | null; tweet_count: number }[]
  isSent: boolean
  onUpdateBlock: (id: string, patch: Partial<DigestBlock>) => void
  onDeleteBlock: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 0,
    marginBottom: 8,
  }

  const topic = block.type === 'topic' && block.topic_id
    ? topics.find((t) => t.id === block.topic_id)
    : null

  return (
    <div ref={setNodeRef} style={style}>
      {/* Gutter: drag handle + delete */}
      <div style={{
        width: 32,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 10,
        gap: 2,
      }}>
        <span
          {...attributes}
          {...listeners}
          style={{
            cursor: isSent ? 'default' : 'grab',
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
        {!isSent && (
          <button
            onClick={() => onDeleteBlock(block.id)}
            title="Remove block"
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
            onMouseEnter={(e) => { e.currentTarget.style.color = '#e53e3e' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
          >
            &times;
          </button>
        )}
      </div>

      {/* Block content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {block.type === 'text' && (
          <textarea
            value={block.content || ''}
            onChange={(e) => onUpdateBlock(block.id, { content: e.target.value })}
            disabled={isSent}
            placeholder="Write text content..."
            rows={3}
            style={markdownTextareaStyle}
          />
        )}

        {block.type === 'topic' && topic && (
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{
                minWidth: 22,
                height: 22,
                borderRadius: 11,
                background: topic.color || 'var(--accent)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                color: '#fff',
                padding: '0 5px',
              }}>
                {topic.tweet_count}
              </span>
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                {topic.title}
              </span>
            </div>
            <textarea
              value={block.note || ''}
              onChange={(e) => onUpdateBlock(block.id, { note: e.target.value })}
              disabled={isSent}
              placeholder="Add a note for this topic..."
              rows={2}
              style={{ ...markdownTextareaStyle, background: 'var(--bg-base)' }}
            />
          </div>
        )}

        {/* Topic block with missing topic */}
        {block.type === 'topic' && !topic && (
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            color: 'var(--text-tertiary)',
            fontSize: 13,
          }}>
            Topic #{block.topic_id} (not found for this date)
          </div>
        )}
      </div>
    </div>
  )
}

/* ---- Topic picker dropdown ---- */
function TopicPicker({
  topics,
  usedTopicIds,
  onSelect,
}: {
  topics: { id: number; title: string; color: string | null; tweet_count: number }[]
  usedTopicIds: Set<number>
  onSelect: (topicId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const available = topics.filter((t) => !usedTopicIds.has(t.id))

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        disabled={available.length === 0}
        style={{
          ...addBtnStyle,
          opacity: available.length === 0 ? 0.4 : 1,
          cursor: available.length === 0 ? 'default' : 'pointer',
        }}
      >
        + Topic
      </button>

      {open && available.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 4,
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          zIndex: 100,
          padding: 4,
          minWidth: 220,
          maxHeight: 300,
          overflowY: 'auto',
        }}>
          {available.map((t) => (
            <div
              key={t.id}
              onClick={() => { onSelect(t.id); setOpen(false) }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                borderRadius: 6,
                fontSize: 13,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: t.color || 'var(--accent)',
                flexShrink: 0,
              }} />
              {t.title}
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                {t.tweet_count} tweet{t.tweet_count !== 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---- Main DigestComposer ---- */
export function DigestComposer() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  const [date, setDate] = useState(todayDateStr())
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null)
  const [blocks, setBlocks] = useState<DigestBlock[]>([])
  const [scheduledFor, setScheduledFor] = useState('')
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const { data: bundle } = useDayBundle(date)
  const { data: drafts } = useDigestDrafts()
  const { data: draft } = useDigestDraft(selectedDraftId)
  const { data: preview } = useDigestPreview(showPreview ? selectedDraftId : null)
  const { data: subCount } = useSubscriberCount()

  const createDraft = useCreateDigestDraft()
  const updateDraft = useUpdateDigestDraft()
  const deleteDraft = useDeleteDigestDraft()
  const sendTest = useSendTestDigest()
  const sendDigest = useSendDigest()

  // Load draft data when a draft is selected
  useEffect(() => {
    if (draft) {
      setBlocks(draft.content_blocks || [])
      setScheduledFor(draft.scheduled_for || '')
      setDate(draft.date)
    }
  }, [draft])

  // Auto-select existing draft for this date
  useEffect(() => {
    if (drafts && !selectedDraftId) {
      const existing = drafts.find((d) => d.date === date && d.status === 'draft')
      if (existing) {
        setSelectedDraftId(existing.id)
      }
    }
  }, [drafts, date, selectedDraftId])

  const topics = sortTopics(bundle?.topics || [])

  // Set of topic IDs already used in blocks
  const usedTopicIds = new Set(
    blocks.filter((b) => b.type === 'topic' && b.topic_id).map((b) => b.topic_id!)
  )

  const updateBlock = useCallback((id: string, patch: Partial<DigestBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }, [])

  const deleteBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const addTextBlock = useCallback(() => {
    setBlocks((prev) => [...prev, { id: nextBlockId(), type: 'text', content: '' }])
  }, [])

  const addTopicBlock = useCallback((topicId: number) => {
    setBlocks((prev) => [...prev, { id: nextBlockId(), type: 'topic', topic_id: topicId, note: '' }])
  }, [])

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setBlocks((prev) => {
      const oldIndex = prev.findIndex((b) => b.id === active.id)
      const newIndex = prev.findIndex((b) => b.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }, [])

  const showStatus = (text: string, type: 'success' | 'error') => {
    setStatusMessage({ text, type })
    setTimeout(() => setStatusMessage(null), 4000)
  }

  const handleSaveDraft = async () => {
    try {
      if (selectedDraftId) {
        await updateDraft.mutateAsync({
          id: selectedDraftId,
          content_blocks: blocks,
          scheduled_for: scheduledFor || undefined,
        })
        showStatus('Draft saved', 'success')
      } else {
        const created = await createDraft.mutateAsync({
          date,
          content_blocks: blocks,
        })
        setSelectedDraftId(created.id)
        showStatus('Draft created', 'success')
      }
    } catch {
      showStatus('Failed to save draft', 'error')
    }
  }

  const handleSendTest = async () => {
    if (!selectedDraftId) return
    try {
      const result = await sendTest.mutateAsync(selectedDraftId)
      showStatus(`Test email sent to ${result.to}`, 'success')
    } catch {
      showStatus('Failed to send test email', 'error')
    }
  }

  const handleSendNow = async () => {
    if (!selectedDraftId) return
    if (!window.confirm('Send digest to all subscribers now?')) return
    try {
      const result = await sendDigest.mutateAsync(selectedDraftId)
      showStatus(`Sent to ${result.sent_count} of ${result.total_subscribers} subscribers`, 'success')
    } catch {
      showStatus('Failed to send digest', 'error')
    }
  }

  const handleDelete = async () => {
    if (!selectedDraftId) return
    if (!window.confirm('Delete this draft?')) return
    try {
      await deleteDraft.mutateAsync(selectedDraftId)
      setSelectedDraftId(null)
      setBlocks([])
      setScheduledFor('')
      setShowPreview(false)
      showStatus('Draft deleted', 'success')
    } catch {
      showStatus('Failed to delete draft', 'error')
    }
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Admin access required
      </div>
    )
  }

  const isSent = draft?.status === 'sent'
  const isBusy = createDraft.isPending || updateDraft.isPending || sendTest.isPending || sendDigest.isPending
  const blockIds = blocks.map((b) => b.id)
  const topicCount = blocks.filter((b) => b.type === 'topic').length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Header */}
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
            maxWidth: 800,
            margin: '0 auto',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <button
            onClick={() => navigate('/app')}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)',
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            &#8592; Back
          </button>

          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Digest Composer
          </h1>

          <div style={{ flex: 1 }} />

          {subCount && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {subCount.count} subscriber{subCount.count !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      {/* Status message */}
      {statusMessage && (
        <div
          style={{
            maxWidth: 800,
            margin: '0 auto',
            padding: '0 24px',
          }}
        >
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              background: statusMessage.type === 'success' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
              color: statusMessage.type === 'success' ? '#4ade80' : 'var(--error)',
              border: `1px solid ${statusMessage.type === 'success' ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)'}`,
            }}
          >
            {statusMessage.text}
          </div>
        </div>
      )}

      {/* Content */}
      <main
        style={{
          maxWidth: 800,
          margin: '0 auto',
          padding: '24px 24px 80px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Date and Draft Selection */}
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            display: 'flex',
            gap: 16,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <label style={labelStyle}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setSelectedDraftId(null)
                setBlocks([])
                setShowPreview(false)
              }}
              style={inputStyle}
            />
          </div>

          {drafts && drafts.length > 0 && (
            <div>
              <label style={labelStyle}>Existing Drafts</label>
              <select
                value={selectedDraftId ?? ''}
                onChange={(e) => {
                  setSelectedDraftId(e.target.value ? Number(e.target.value) : null)
                  if (!e.target.value) {
                    setBlocks([])
                    setShowPreview(false)
                  }
                }}
                style={inputStyle}
              >
                <option value="">New draft</option>
                {drafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.date} ({d.status}){d.sent_at ? ' - Sent' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isSent && (
            <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 500 }}>
              Already sent ({draft!.recipient_count} recipients)
            </span>
          )}
        </div>

        {/* Block List */}
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={sectionTitleStyle}>Content Blocks</h3>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
              {blocks.length} block{blocks.length !== 1 ? 's' : ''} &middot; {topicCount} topic{topicCount !== 1 ? 's' : ''}
            </p>
          </div>

          <div style={{ padding: '16px 20px' }}>
            {blocks.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                No blocks yet. Add a text or topic block below.
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
                  {blocks.map((block) => (
                    <SortableBlock
                      key={block.id}
                      block={block}
                      topics={topics}
                      isSent={!!isSent}
                      onUpdateBlock={updateBlock}
                      onDeleteBlock={deleteBlock}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}

            {/* Add block buttons */}
            {!isSent && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={addTextBlock} style={addBtnStyle}>
                  + Text
                </button>
                <TopicPicker
                  topics={topics}
                  usedTopicIds={usedTopicIds}
                  onSelect={addTopicBlock}
                />
              </div>
            )}
          </div>
        </div>

        {/* Schedule */}
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            display: 'flex',
            gap: 16,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <label style={labelStyle}>Schedule Send (optional)</label>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              disabled={isSent}
              style={inputStyle}
            />
          </div>
          {scheduledFor && (
            <button
              onClick={() => setScheduledFor('')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-tertiary)',
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: '8px 0',
                fontFamily: 'var(--font-body)',
              }}
            >
              Clear schedule
            </button>
          )}
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={handleSaveDraft}
            disabled={isBusy || isSent}
            style={buttonStyle('var(--accent)')}
          >
            {selectedDraftId ? 'Save Draft' : 'Create Draft'}
          </button>

          {selectedDraftId && (
            <>
              <button
                onClick={() => setShowPreview(!showPreview)}
                style={buttonStyle('transparent', true)}
              >
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>

              <button
                onClick={handleSendTest}
                disabled={isBusy || isSent}
                style={buttonStyle('transparent', true)}
              >
                {sendTest.isPending ? 'Sending...' : 'Send Test'}
              </button>

              {scheduledFor && !isSent && (
                <button
                  onClick={handleSaveDraft}
                  disabled={isBusy}
                  style={buttonStyle('#8b5cf6')}
                >
                  Schedule
                </button>
              )}

              <button
                onClick={handleSendNow}
                disabled={isBusy || isSent}
                style={buttonStyle('#ef4444')}
              >
                {sendDigest.isPending ? 'Sending...' : 'Send Now'}
              </button>

              <div style={{ flex: 1 }} />

              <button
                onClick={handleDelete}
                disabled={isBusy}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  fontSize: 12,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontFamily: 'var(--font-body)',
                  padding: '8px 4px',
                }}
              >
                Delete draft
              </button>
            </>
          )}
        </div>

        {/* Email Preview */}
        {showPreview && selectedDraftId && (
          <div
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <h3 style={sectionTitleStyle}>Email Preview</h3>
              {preview && (
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
                  Subject: {preview.subject} &middot; {preview.recipient_count} recipient{preview.recipient_count !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div style={{ padding: 0, minHeight: 200 }}>
              {preview ? (
                <iframe
                  srcDoc={preview.html}
                  title="Email preview"
                  style={{
                    width: '100%',
                    minHeight: 600,
                    border: 'none',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 40 }}>
                  Loading preview...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Existing Drafts List */}
        {drafts && drafts.length > 0 && (
          <div
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={sectionTitleStyle}>All Drafts</h3>
            </div>
            <div>
              {drafts.map((d) => {
                const draftTopicCount = (d.content_blocks || []).filter((b) => b.type === 'topic').length
                return (
                  <div
                    key={d.id}
                    onClick={() => setSelectedDraftId(d.id)}
                    style={{
                      padding: '12px 20px',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: d.id === selectedDraftId ? 'var(--bg-elevated)' : 'transparent',
                      transition: 'background 0.1s ease',
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>
                        {d.date}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                        {draftTopicCount} topic{draftTopicCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: 'var(--radius-sm)',
                        background:
                          d.status === 'sent'
                            ? 'rgba(74, 222, 128, 0.15)'
                            : d.status === 'scheduled'
                              ? 'rgba(139, 92, 246, 0.15)'
                              : 'rgba(255, 255, 255, 0.06)',
                        color:
                          d.status === 'sent'
                            ? '#4ade80'
                            : d.status === 'scheduled'
                              ? '#a78bfa'
                              : 'var(--text-secondary)',
                      }}
                    >
                      {d.status}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 12px',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: 'var(--font-body)',
  outline: 'none',
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--text-primary)',
  margin: 0,
}

const markdownTextareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '12px 14px',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace',
  resize: 'vertical',
  outline: 'none',
  lineHeight: 1.7,
  letterSpacing: '-0.01em',
}

const addBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px dashed var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  transition: 'all 0.15s ease',
}

function buttonStyle(bg: string, outline = false): React.CSSProperties {
  return {
    background: outline ? 'transparent' : bg,
    color: outline ? 'var(--text-secondary)' : '#fff',
    border: outline ? '1px solid var(--border)' : 'none',
    borderRadius: 'var(--radius-md)',
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    transition: 'opacity 0.15s ease',
  }
}
