import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useDayBundle } from '../api/dayBundle'
import { sortTopics } from '../utils/topics'
import {
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

function todayDateStr(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function DigestComposer() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  const [date, setDate] = useState(todayDateStr())
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null)
  const [selectedTopicIds, setSelectedTopicIds] = useState<number[]>([])
  const [topicNotes, setTopicNotes] = useState<Record<string, string>>({})
  const [introText, setIntroText] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: bundle } = useDayBundle(date)
  const { data: drafts } = useDigestDrafts()
  const { data: draft } = useDigestDraft(selectedDraftId)
  const { data: preview } = useDigestPreview(selectedDraftId)
  const { data: subCount } = useSubscriberCount()

  const createDraft = useCreateDigestDraft()
  const updateDraft = useUpdateDigestDraft()
  const deleteDraft = useDeleteDigestDraft()
  const sendTest = useSendTestDigest()
  const sendDigest = useSendDigest()

  // Load draft data when a draft is selected
  useEffect(() => {
    if (draft) {
      setSelectedTopicIds(draft.topic_ids)
      setTopicNotes(draft.topic_notes || {})
      setIntroText(draft.intro_text || '')
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

  const toggleTopic = (topicId: number) => {
    setSelectedTopicIds((prev) =>
      prev.includes(topicId)
        ? prev.filter((id) => id !== topicId)
        : [...prev, topicId]
    )
  }

  const setTopicNote = (topicId: number, note: string) => {
    setTopicNotes((prev) => ({ ...prev, [String(topicId)]: note }))
  }

  const showStatus = (text: string, type: 'success' | 'error') => {
    setStatusMessage({ text, type })
    setTimeout(() => setStatusMessage(null), 4000)
  }

  const handleSaveDraft = async () => {
    try {
      if (selectedDraftId) {
        await updateDraft.mutateAsync({
          id: selectedDraftId,
          intro_text: introText || undefined,
          topic_ids: selectedTopicIds,
          topic_notes: topicNotes,
          scheduled_for: scheduledFor || undefined,
        })
        showStatus('Draft saved', 'success')
      } else {
        const created = await createDraft.mutateAsync({
          date,
          topic_ids: selectedTopicIds,
          intro_text: introText || undefined,
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
      setSelectedTopicIds([])
      setTopicNotes({})
      setIntroText('')
      setScheduledFor('')
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
              }}
              style={inputStyle}
            />
          </div>

          {drafts && drafts.length > 0 && (
            <div>
              <label style={labelStyle}>Existing Drafts</label>
              <select
                value={selectedDraftId ?? ''}
                onChange={(e) => setSelectedDraftId(e.target.value ? Number(e.target.value) : null)}
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
              Already sent ({draft.recipient_count} recipients)
            </span>
          )}
        </div>

        {/* Topic Selection */}
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={sectionTitleStyle}>Topics</h3>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
              Select topics to include in the digest ({selectedTopicIds.length} selected)
            </p>
          </div>

          <div style={{ padding: '4px 0' }}>
            {topics.length === 0 ? (
              <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-tertiary)' }}>
                No topics for this date
              </div>
            ) : (
              topics.map((topic) => {
                const isSelected = selectedTopicIds.includes(topic.id)
                const accentColor = topic.color || 'var(--accent)'
                return (
                  <div
                    key={topic.id}
                    style={{
                      padding: '10px 20px',
                      transition: 'background 0.1s ease',
                    }}
                  >
                    <div
                      onClick={() => !isSent && toggleTopic(topic.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        cursor: isSent ? 'default' : 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      {/* Toggle switch */}
                      <div
                        style={{
                          width: 36,
                          height: 20,
                          borderRadius: 10,
                          background: isSelected ? accentColor : 'var(--bg-elevated)',
                          border: isSelected ? 'none' : '1px solid var(--border)',
                          position: 'relative',
                          transition: 'background 0.2s ease',
                          flexShrink: 0,
                          opacity: isSent ? 0.5 : 1,
                        }}
                      >
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 8,
                            background: '#fff',
                            position: 'absolute',
                            top: isSelected ? 2 : 1,
                            left: isSelected ? 18 : 2,
                            transition: 'left 0.2s ease',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                          }}
                        />
                      </div>

                      {/* Count badge (same as TopicSection header) */}
                      <span
                        style={{
                          minWidth: 22,
                          height: 22,
                          borderRadius: 11,
                          background: accentColor,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#fff',
                          padding: '0 5px',
                        }}
                      >
                        {topic.tweet_count}
                      </span>

                      {/* Title */}
                      <span style={{
                        fontWeight: 500,
                        fontSize: 14,
                        color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                        transition: 'color 0.15s ease',
                      }}>
                        {topic.title}
                      </span>
                    </div>

                    {/* Topic note (markdown-style) */}
                    {isSelected && (
                      <div style={{ marginTop: 8, marginLeft: 48 }}>
                        <textarea
                          placeholder="Add a note for this topic (markdown supported)..."
                          value={topicNotes[String(topic.id)] || ''}
                          onChange={(e) => setTopicNote(topic.id, e.target.value)}
                          disabled={isSent}
                          rows={2}
                          style={markdownTextareaStyle}
                        />
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Intro Text */}
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={sectionTitleStyle}>Intro Text</h3>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
              Brief introduction for the email &mdash; supports markdown
            </p>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <textarea
              value={introText}
              onChange={(e) => setIntroText(e.target.value)}
              disabled={isSent}
              placeholder="# Today's Digest&#10;&#10;Write a brief intro for today's digest..."
              rows={5}
              style={markdownTextareaStyle}
            />
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

        {/* Email Preview - always visible when draft exists */}
        {selectedDraftId && (
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
              {drafts.map((d) => (
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
                      {d.topic_ids.length} topic{d.topic_ids.length !== 1 ? 's' : ''}
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
              ))}
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
