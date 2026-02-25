import { useNavigate } from 'react-router-dom'

export function SettingsPage() {
  const navigate = useNavigate()

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
      }}
    >
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
            maxWidth: 640,
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
            onMouseEnter={(e) =>
              (e.currentTarget.style.borderColor = 'var(--border-strong)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderColor = 'var(--border)')
            }
          >
            &#8592; Back
          </button>

          <h1
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Settings
          </h1>
        </div>
      </header>

      {/* Content */}
      <main
        style={{
          maxWidth: 640,
          margin: '0 auto',
          padding: '24px 24px 80px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* Backend URL Info */}
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
            <h3
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              Extension Configuration
            </h3>
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                margin: '4px 0 0',
              }}
            >
              Configure the Chrome extension to connect to this backend
            </p>
          </div>

          <div style={{ padding: '16px 20px' }}>
            {/* Backend URL */}
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                Backend URL
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <code
                  style={{
                    flex: 1,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px 12px',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    fontFamily: 'var(--font-mono)',
                    userSelect: 'all',
                  }}
                >
                  {window.location.origin}
                </code>
              </div>
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  marginTop: 6,
                  lineHeight: 1.5,
                }}
              >
                Enter this URL in the Chrome extension popup to connect it to
                this dashboard.
              </p>
            </div>

            {/* Setup instructions */}
            <div
              style={{
                background: 'var(--accent-muted)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 14px',
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--accent-hover)',
                  marginBottom: 8,
                }}
              >
                Setup Instructions
              </p>
              <ol
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.7,
                  paddingLeft: 16,
                  margin: 0,
                }}
              >
                <li>
                  Open{' '}
                  <code
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      background: 'var(--bg-elevated)',
                      padding: '1px 4px',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    chrome://extensions
                  </code>
                </li>
                <li>Enable &quot;Developer mode&quot;</li>
                <li>
                  Click &quot;Load unpacked&quot; and select the{' '}
                  <code
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      background: 'var(--bg-elevated)',
                      padding: '1px 4px',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    extension/
                  </code>{' '}
                  directory
                </li>
                <li>Click the extension icon and paste the backend URL above</li>
                <li>
                  Browse Twitter and click &quot;Save&quot; on tweets to capture
                  them
                </li>
              </ol>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
