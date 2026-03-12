import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllSendLogs, useDigestDrafts, type DigestSendLog } from '../api/digest'

export function SendLogPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const logs = useAllSendLogs(statusFilter ? { status: statusFilter, limit: 500 } : { limit: 500 })
  const { data: drafts } = useDigestDrafts()
  const [expandedDrafts, setExpandedDrafts] = useState<Set<number>>(new Set())

  // Build a lookup from draft_id to draft info
  const draftLookup = useMemo(() => {
    const map = new Map<number, { subject: string | null; date: string }>()
    if (drafts) {
      for (const d of drafts) {
        map.set(d.id, { subject: d.subject, date: d.date })
      }
    }
    return map
  }, [drafts])

  // Group logs by draft_id, ordered by most recent send first
  const grouped = useMemo(() => {
    if (!logs.data) return []
    const byDraft = new Map<number, DigestSendLog[]>()
    for (const log of logs.data) {
      const arr = byDraft.get(log.draft_id) || []
      arr.push(log)
      byDraft.set(log.draft_id, arr)
    }
    // Sort groups by latest attempted_at descending
    return Array.from(byDraft.entries())
      .map(([draftId, entries]) => {
        const sentCount = entries.filter(e => e.status === 'sent').length
        const failedCount = entries.filter(e => e.status === 'failed').length
        const latestAt = entries.reduce((max, e) => e.attempted_at > max ? e.attempted_at : max, entries[0].attempted_at)
        return { draftId, entries, sentCount, failedCount, latestAt }
      })
      .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
  }, [logs.data])

  const toggleExpand = (draftId: number) => {
    setExpandedDrafts(prev => {
      const next = new Set(prev)
      if (next.has(draftId)) next.delete(draftId)
      else next.add(draftId)
      return next
    })
  }

  const draftLabel = (draftId: number) => {
    const info = draftLookup.get(draftId)
    if (info?.subject) return info.subject
    if (info?.date) return info.date
    return `Draft #${draftId}`
  }

  return (
    <div style={{ height: '100dvh', overflowY: 'auto', background: 'var(--bg-base)' }}>
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
            onClick={() => navigate('/app/digest')}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)',
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            &#8592; Composer
          </button>

          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Send Log
          </h1>

          <div style={{ flex: 1 }} />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              padding: '6px 10px',
              fontSize: 13,
              fontFamily: 'var(--font-body)',
              outline: 'none',
            }}
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </header>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px 24px 80px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {logs.isLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
            Loading...
          </div>
        )}

        {logs.data && grouped.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
            No send logs yet.
          </div>
        )}

        {grouped.map(({ draftId, entries, sentCount, failedCount, latestAt }) => {
          const isExpanded = expandedDrafts.has(draftId)
          return (
            <div
              key={draftId}
              style={{
                background: 'var(--bg-raised)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}
            >
              {/* Draft group header */}
              <div
                onClick={() => toggleExpand(draftId)}
                style={{
                  padding: '12px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 16, flexShrink: 0 }}>
                  {isExpanded ? '▾' : '▸'}
                </span>

                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/app/digest?draft=${draftId}`) }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-primary)',
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: 'var(--font-body)',
                    textAlign: 'left',
                  }}
                  title="Open in composer"
                >
                  {draftLabel(draftId)}
                </button>

                <div style={{ flex: 1 }} />

                <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 500 }}>
                  {sentCount} sent
                </span>
                {failedCount > 0 && (
                  <span style={{ fontSize: 12, color: '#f87171', fontWeight: 500 }}>
                    {failedCount} failed
                  </span>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {new Date(latestAt).toLocaleDateString()}
                </span>
              </div>

              {/* Expanded: individual sends */}
              {isExpanded && (
                <>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 70px 1fr',
                      gap: 12,
                      padding: '8px 20px 8px 48px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.05em',
                      borderTop: '1px solid var(--border)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span>Recipient</span>
                    <span>Status</span>
                    <span style={{ textAlign: 'right' }}>Time</span>
                  </div>
                  {entries.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 70px 1fr',
                        gap: 12,
                        padding: '8px 20px 8px 48px',
                        fontSize: 13,
                        borderBottom: '1px solid var(--border)',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap' as const,
                        }}
                        title={log.email}
                      >
                        {log.email}
                      </span>

                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: log.status === 'sent' ? '#4ade80' : '#f87171',
                          textTransform: 'uppercase' as const,
                          letterSpacing: '0.03em',
                        }}
                      >
                        {log.status}
                      </span>

                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                          {new Date(log.attempted_at).toLocaleString()}
                        </span>
                        {log.status === 'failed' && log.error_message && (
                          <div
                            style={{
                              fontSize: 11,
                              color: '#f87171',
                              marginTop: 2,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap' as const,
                            }}
                            title={log.error_message}
                          >
                            {log.error_message}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )
        })}
      </main>
    </div>
  )
}
