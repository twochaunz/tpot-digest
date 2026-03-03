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
    const originals: { img: HTMLImageElement; src: string; crossOrigin: string | null }[] = []
    try {
      const el = tweetRef.current

      // Swap cross-origin images to proxied URLs in-place, remember originals
      const imgs = el.querySelectorAll('img')
      await Promise.all(
        Array.from(imgs).map(
          (img) =>
            new Promise<void>((resolve) => {
              const src = img.src
              if (!src || src.startsWith('data:') || src.startsWith(window.location.origin)) {
                resolve()
                return
              }
              originals.push({ img, src, crossOrigin: img.getAttribute('crossorigin') })
              img.crossOrigin = 'anonymous'
              img.src = `/api/image-proxy?url=${encodeURIComponent(src)}`
              img.onload = () => resolve()
              img.onerror = () => resolve()
            })
        )
      )

      const dataUrl = await toPng(el, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
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
      // Always restore original image sources, even if toPng throws
      for (const { img, src, crossOrigin } of originals) {
        if (crossOrigin === null) {
          img.removeAttribute('crossorigin')
        } else {
          img.crossOrigin = crossOrigin
        }
        img.src = src
      }
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

        {/* Tweet Screenshot Tool */}
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
                Tweet Screenshot
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

            {/* Embedded tweet — force light theme, OG image dimensions */}
            <style>{`
              .tweet-screenshot-area .react-tweet-theme {
                /* Override global .react-tweet-theme { background: none; border: none } */
                background-color: #fff !important;
                border: 1px solid rgb(207, 217, 222) !important;
                border-radius: 12px !important;
                /* Force light theme variables (override dark mode / prefers-color-scheme) */
                --tweet-border: 1px solid rgb(207, 217, 222) !important;
                --tweet-font-color: rgb(15, 20, 25) !important;
                --tweet-font-color-secondary: rgb(83, 100, 113) !important;
                --tweet-bg-color: #fff !important;
                --tweet-bg-color-hover: rgb(247, 249, 249) !important;
                --tweet-quoted-bg-color-hover: rgba(0, 0, 0, 0.03) !important;
                --tweet-color-blue-primary: rgb(29, 155, 240) !important;
                --tweet-color-blue-secondary: rgb(0, 111, 214) !important;
                --tweet-twitter-icon-color: rgb(15, 20, 25) !important;
                --tweet-verified-old-color: rgb(130, 154, 171) !important;
                --tweet-verified-blue-color: rgb(29, 155, 240) !important;
                --tweet-skeleton-gradient: linear-gradient(270deg, #fafafa, #eaeaea, #eaeaea, #fafafa) !important;
                color-scheme: light !important;
              }
            `}</style>
            <div
              ref={tweetRef}
              data-theme="light"
              className="tweet-screenshot-area"
              style={{
                width: 600,
                height: 315,
                margin: '0 auto',
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid #e1e8ed',
              }}
            >
              <div style={{ width: 500 }}>
                <Tweet id={tweetId} apiUrl={`/api/tweet-embed/${tweetId}`} />
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 8 }}>
              600 x 315 @ 2x = 1200 x 630 OG image
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
