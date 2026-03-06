import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useAnalyticsOverview,
  useDigestAnalytics,
  useDigestDetail,
  useSubscriberAnalytics,
} from '../api/analytics'

type Tab = 'digests' | 'subscribers'

function rateColor(rate: number): string {
  if (rate >= 50) return '#4ade80'
  if (rate >= 25) return '#fbbf24'
  return '#f87171'
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString()
}

function formatPercent(rate: number): string {
  return `${rate.toFixed(1)}%`
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 140,
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '20px 16px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: color ?? 'var(--text-primary)',
          fontFamily: 'var(--font-body)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
          marginTop: 4,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.04em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function DigestRow({
  digest,
  isExpanded,
  onToggle,
}: {
  digest: { draft_id: number; date: string; subject: string | null; recipients: number; opens: number; open_rate: number; clicks: number; click_rate: number; sent_at: string | null }
  isExpanded: boolean
  onToggle: () => void
}) {
  const detail = useDigestDetail(isExpanded ? digest.draft_id : null)

  return (
    <>
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '90px 1fr 80px 60px 80px 60px 80px',
          gap: 12,
          padding: '10px 20px',
          fontSize: 13,
          borderBottom: '1px solid var(--border)',
          alignItems: 'center',
          cursor: 'pointer',
          background: isExpanded ? 'var(--bg-elevated)' : 'transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => {
          if (!isExpanded) e.currentTarget.style.background = 'var(--bg-elevated)'
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) e.currentTarget.style.background = 'transparent'
        }}
      >
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
          {formatDate(digest.date)}
        </span>
        <span
          style={{
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
          }}
        >
          {digest.subject || `Draft #${digest.draft_id}`}
        </span>
        <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
          {digest.recipients}
        </span>
        <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
          {digest.opens}
        </span>
        <span style={{ color: rateColor(digest.open_rate), textAlign: 'right', fontWeight: 600 }}>
          {formatPercent(digest.open_rate)}
        </span>
        <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
          {digest.clicks}
        </span>
        <span style={{ color: rateColor(digest.click_rate), textAlign: 'right', fontWeight: 600 }}>
          {formatPercent(digest.click_rate)}
        </span>
      </div>

      {isExpanded && (
        <div
          style={{
            padding: '16px 20px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
          }}
        >
          {detail.isLoading && (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading details...</div>
          )}

          {detail.data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Top Clicked Links */}
              <div>
                <h4
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.04em',
                    margin: '0 0 8px',
                  }}
                >
                  Top Clicked Links
                </h4>
                {detail.data.top_links.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No clicks yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {detail.data.top_links.map((link) => (
                      <div
                        key={link.url}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 13,
                        }}
                      >
                        <span
                          style={{
                            color: 'var(--text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap' as const,
                            flex: 1,
                          }}
                          title={link.url}
                        >
                          {link.url}
                        </span>
                        <span
                          style={{
                            color: 'var(--text-primary)',
                            fontWeight: 600,
                            fontSize: 12,
                            flexShrink: 0,
                          }}
                        >
                          {link.count} {link.count === 1 ? 'click' : 'clicks'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Subscriber Breakdown */}
              <div>
                <h4
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.04em',
                    margin: '0 0 8px',
                  }}
                >
                  Subscriber Breakdown
                </h4>
                {detail.data.subscribers.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                    No subscriber data.
                  </div>
                ) : (
                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Subscriber header */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 80px 80px 80px',
                        gap: 8,
                        padding: '8px 14px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.04em',
                        borderBottom: '1px solid var(--border)',
                        background: 'var(--bg-base)',
                      }}
                    >
                      <span>Email</span>
                      <span style={{ textAlign: 'center' }}>Delivered</span>
                      <span style={{ textAlign: 'center' }}>Opened</span>
                      <span style={{ textAlign: 'center' }}>Clicked</span>
                    </div>
                    {detail.data.subscribers.map((sub) => (
                      <div
                        key={sub.subscriber_id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 80px 80px 80px',
                          gap: 8,
                          padding: '6px 14px',
                          fontSize: 12,
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span
                          style={{
                            color: 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap' as const,
                          }}
                          title={sub.email}
                        >
                          {sub.email}
                        </span>
                        <span style={{ textAlign: 'center', color: sub.delivered ? '#4ade80' : 'var(--text-tertiary)' }}>
                          {sub.delivered ? '\u2713' : '\u2014'}
                        </span>
                        <span style={{ textAlign: 'center', color: sub.opened ? '#4ade80' : 'var(--text-tertiary)' }}>
                          {sub.opened ? '\u2713' : '\u2014'}
                        </span>
                        <span style={{ textAlign: 'center', color: sub.clicked ? '#4ade80' : 'var(--text-tertiary)' }}>
                          {sub.clicked ? '\u2713' : '\u2014'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

export function AnalyticsPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('digests')
  const [expandedDraftId, setExpandedDraftId] = useState<number | null>(null)

  const overview = useAnalyticsOverview()
  const digests = useDigestAnalytics()
  const subscribers = useSubscriberAnalytics()

  const lastDigest = overview.data?.last_digest

  return (
    <div style={{ height: '100dvh', overflowY: 'auto', background: 'var(--bg-base)' }}>
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
            maxWidth: 900,
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
              fontFamily: 'var(--font-body)',
            }}
          >
            &#8592; Back
          </button>

          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Analytics
          </h1>

          <div style={{ flex: 1 }} />

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
            Digest Composer
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 24px 80px' }}>
        {/* Overview Cards */}
        {overview.isLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
            Loading...
          </div>
        )}

        {overview.data && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginBottom: 32,
              flexWrap: 'wrap',
            }}
          >
            <StatCard
              label="Active Subscribers"
              value={String(overview.data.subscriber_count)}
            />
            <StatCard
              label="Last Open Rate"
              value={lastDigest ? formatPercent(lastDigest.open_rate) : '—'}
              color={lastDigest ? rateColor(lastDigest.open_rate) : undefined}
            />
            <StatCard
              label="Last Click Rate"
              value={lastDigest ? formatPercent(lastDigest.click_rate) : '—'}
              color={lastDigest ? rateColor(lastDigest.click_rate) : undefined}
            />
            <StatCard
              label="Last Recipients"
              value={lastDigest ? String(lastDigest.recipients) : '—'}
            />
          </div>
        )}

        {/* Tab Bar */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            borderBottom: '1px solid var(--border)',
            marginBottom: 20,
          }}
        >
          {(['digests', 'subscribers'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--text-primary)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontWeight: activeTab === tab ? 600 : 400,
                fontSize: 14,
                padding: '10px 20px',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                textTransform: 'capitalize' as const,
                transition: 'all 0.15s ease',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Digests Tab */}
        {activeTab === 'digests' && (
          <>
            {digests.isLoading && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
                Loading digests...
              </div>
            )}

            {digests.data && digests.data.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
                No digests sent yet.
              </div>
            )}

            {digests.data && digests.data.length > 0 && (
              <div
                style={{
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 1fr 80px 60px 80px 60px 80px',
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
                  <span>Date</span>
                  <span>Subject</span>
                  <span style={{ textAlign: 'right' }}>Recipients</span>
                  <span style={{ textAlign: 'right' }}>Opens</span>
                  <span style={{ textAlign: 'right' }}>Open Rate</span>
                  <span style={{ textAlign: 'right' }}>Clicks</span>
                  <span style={{ textAlign: 'right' }}>Click Rate</span>
                </div>

                {digests.data.map((d) => (
                  <DigestRow
                    key={d.draft_id}
                    digest={d}
                    isExpanded={expandedDraftId === d.draft_id}
                    onToggle={() =>
                      setExpandedDraftId(expandedDraftId === d.draft_id ? null : d.draft_id)
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Subscribers Tab */}
        {activeTab === 'subscribers' && (
          <>
            {subscribers.isLoading && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
                Loading subscribers...
              </div>
            )}

            {subscribers.data && subscribers.data.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
                No subscribers yet.
              </div>
            )}

            {subscribers.data && subscribers.data.length > 0 && (
              <div
                style={{
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 110px 100px 80px 80px 110px',
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
                  <span>Email</span>
                  <span style={{ textAlign: 'right' }}>Subscribed</span>
                  <span style={{ textAlign: 'right' }}>Received</span>
                  <span style={{ textAlign: 'right' }}>Open Rate</span>
                  <span style={{ textAlign: 'right' }}>Click Rate</span>
                  <span style={{ textAlign: 'right' }}>Last Opened</span>
                </div>

                {subscribers.data.map((sub) => (
                  <div
                    key={sub.subscriber_id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 110px 100px 80px 80px 110px',
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
                      title={sub.email}
                    >
                      {sub.email}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'right' }}>
                      {formatDate(sub.subscribed_at)}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                      {sub.digests_received}
                    </span>
                    <span
                      style={{
                        color: rateColor(sub.open_rate),
                        textAlign: 'right',
                        fontWeight: 600,
                      }}
                    >
                      {formatPercent(sub.open_rate)}
                    </span>
                    <span
                      style={{
                        color: rateColor(sub.click_rate),
                        textAlign: 'right',
                        fontWeight: 600,
                      }}
                    >
                      {formatPercent(sub.click_rate)}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'right' }}>
                      {formatDate(sub.last_opened)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
