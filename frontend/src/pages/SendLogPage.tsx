import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllSendLogs } from '../api/digest'

export function SendLogPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const logs = useAllSendLogs(statusFilter ? { status: statusFilter, limit: 200 } : { limit: 200 })

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

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px 24px 80px' }}>
        {logs.isLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
            Loading...
          </div>
        )}

        {logs.data && logs.data.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
            No send logs yet.
          </div>
        )}

        {logs.data && logs.data.length > 0 && (
          <div
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}
          >
            {/* Header row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 70px 1fr',
                gap: 12,
                padding: '10px 20px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.05em',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span>Recipient</span>
              <span>Draft</span>
              <span>Status</span>
              <span style={{ textAlign: 'right' }}>Time</span>
            </div>

            {logs.data.map((log) => (
              <div
                key={log.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 70px 1fr',
                  gap: 12,
                  padding: '10px 20px',
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

                <button
                  onClick={() => navigate(`/app/digest?draft=${log.draft_id}`)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: 13,
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: 'var(--font-body)',
                    textAlign: 'left',
                    textDecoration: 'underline',
                    textDecorationColor: 'var(--border)',
                  }}
                >
                  Draft #{log.draft_id}
                </button>

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
          </div>
        )}
      </main>
    </div>
  )
}
