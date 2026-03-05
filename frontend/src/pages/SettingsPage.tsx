import { useNavigate } from 'react-router-dom'
import { useRef, useState, useCallback } from 'react'
import { Tweet } from 'react-tweet'
import { toPng } from 'html-to-image'
import { useAuth } from '../contexts/AuthContext'

const DEFAULT_TWEET_ID = '2028500984977330453'

export function SettingsPage() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const tweetRef = useRef<HTMLDivElement>(null)
  const [tweetId, setTweetId] = useState(DEFAULT_TWEET_ID)
  const [inputVal, setInputVal] = useState(DEFAULT_TWEET_ID)
  const [downloading, setDownloading] = useState(false)

  const handleDownload = useCallback(async () => {
    if (!tweetRef.current) return
    setDownloading(true)
    let clone: HTMLDivElement | null = null
    try {
      // Clone the DOM so dev-tools edits on the live element are never touched
      clone = tweetRef.current.cloneNode(true) as HTMLDivElement
      clone.style.position = 'fixed'
      clone.style.left = '-9999px'
      clone.style.top = '0'
      document.body.appendChild(clone)

      // Swap cross-origin images to proxied URLs on the clone only
      const imgs = clone.querySelectorAll('img')
      await Promise.all(
        Array.from(imgs).map(
          (img) =>
            new Promise<void>((resolve) => {
              const src = img.src
              if (!src || src.startsWith('data:') || src.startsWith(window.location.origin)) {
                resolve()
                return
              }
              img.crossOrigin = 'anonymous'
              img.src = `/api/image-proxy?url=${encodeURIComponent(src)}`
              img.onload = () => resolve()
              img.onerror = () => resolve()
            })
        )
      )

      const dataUrl = await toPng(clone, {
        pixelRatio: 2,
        backgroundColor: '#000',
        width: 600,
        height: 315,
      })

      const link = document.createElement('a')
      link.download = `tweet-${tweetId}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error('Download failed:', err)
    } finally {
      if (clone?.parentNode) clone.parentNode.removeChild(clone)
      setDownloading(false)
    }
  }, [tweetId])

  const handleLoadTweet = () => {
    // Extract tweet ID from URL or raw ID
    const match = inputVal.match(/status\/(\d+)/)
    setTweetId(match ? match[1] : inputVal.trim())
  }

  if (!isAdmin) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Admin access required</div>
  }

  return (
    <div
      style={{
        height: '100dvh',
        overflowY: 'auto' as const,
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

        {/* Tweet Screenshot Tool */}
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  margin: 0,
                }}
              >
                OG Embed Image
              </h3>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                  margin: '4px 0 0',
                }}
              >
                Edit text with dev tools, then download
              </p>
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                cursor: downloading ? 'wait' : 'pointer',
                opacity: downloading ? 0.6 : 1,
                fontFamily: 'var(--font-body)',
              }}
            >
              {downloading ? 'Capturing...' : 'Download PNG'}
            </button>
          </div>

          <div style={{ padding: '16px 20px' }}>
            {/* Tweet ID input */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginBottom: 16,
              }}
            >
              <input
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLoadTweet()}
                placeholder="Tweet ID or URL"
                style={{
                  flex: 1,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 12px',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <button
                onClick={handleLoadTweet}
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-secondary)',
                  padding: '8px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                }}
              >
                Load
              </button>
            </div>

            {/* Embedded tweet — dark theme, OG image dimensions */}
            <style>{`
              .tweet-screenshot-area .react-tweet-theme {
                /* Override global .react-tweet-theme { background: none; border: none } */
                background-color: rgb(21, 32, 43) !important;
                border: 1px solid rgb(66, 83, 100) !important;
                border-radius: 12px !important;
                /* Force dark theme variables */
                --tweet-border: 1px solid rgb(66, 83, 100) !important;
                --tweet-font-color: rgb(247, 249, 249) !important;
                --tweet-font-color-secondary: rgb(139, 152, 165) !important;
                --tweet-bg-color: rgb(21, 32, 43) !important;
                --tweet-bg-color-hover: rgb(30, 39, 50) !important;
                --tweet-quoted-bg-color-hover: rgba(255, 255, 255, 0.03) !important;
                --tweet-color-blue-primary: rgb(29, 155, 240) !important;
                --tweet-color-blue-secondary: rgb(107, 201, 251) !important;
                --tweet-twitter-icon-color: rgb(247, 249, 249) !important;
                --tweet-verified-old-color: rgb(130, 154, 171) !important;
                --tweet-verified-blue-color: #fff !important;
                --tweet-skeleton-gradient: linear-gradient(270deg, #15202b, rgb(30, 39, 50), rgb(30, 39, 50), rgb(21, 32, 43)) !important;
                color-scheme: dark !important;
              }
            `}</style>
            <div
              style={{
                background: '#111',
                borderRadius: 12,
                padding: '24px 0',
              }}
            >
              <div
                ref={tweetRef}
                data-theme="dark"
                className="tweet-screenshot-area"
                style={{
                  width: 600,
                  height: 315,
                  margin: '0 auto',
                  background: '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                <div style={{ width: 500 }}>
                  <Tweet id={tweetId} apiUrl={`/api/tweet-embed/${tweetId}`} />
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 12 }}>
                600 x 315 @ 2x = 1200 x 630 OG image
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
