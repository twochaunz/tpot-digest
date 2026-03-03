import { useState, useEffect, useCallback, useRef } from 'react'
import { useSubscribe, useCheckSubscription } from '../api/subscribers'

const DISMISS_KEY = 'digest_popup_dismissed_at'
const DISMISS_DAYS = 7
const SHOW_DELAY_MS = 5000
const SCROLL_THRESHOLD = 0.3

function isDismissedRecently(): boolean {
  const dismissed = localStorage.getItem(DISMISS_KEY)
  if (!dismissed) return false
  const dismissedAt = new Date(dismissed).getTime()
  const now = Date.now()
  return now - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000
}

export function DigestSignupPopup() {
  const [visible, setVisible] = useState(false)
  const [email, setEmail] = useState('')
  const [success, setSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const triggered = useRef(false)

  const { data: subCheck, isLoading: checkLoading } = useCheckSubscription()
  const subscribe = useSubscribe()

  const showPopup = useCallback(() => {
    if (triggered.current) return
    triggered.current = true
    setVisible(true)
  }, [])

  useEffect(() => {
    // Don't show if already subscribed, recently dismissed, or still checking
    if (checkLoading) return
    if (subCheck?.subscribed) return
    if (isDismissedRecently()) return

    // Timer trigger
    const timer = setTimeout(showPopup, SHOW_DELAY_MS)

    // Scroll trigger
    function handleScroll() {
      const scrollRatio = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)
      if (scrollRatio >= SCROLL_THRESHOLD) {
        showPopup()
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', handleScroll)
    }
  }, [checkLoading, subCheck, showPopup])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    localStorage.setItem(DISMISS_KEY, new Date().toISOString())
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    if (!email.trim()) return

    try {
      await subscribe.mutateAsync({ email: email.trim() })
      setSuccess(true)
    } catch (err) {
      if (err instanceof Error) {
        setErrorMsg(err.message || 'Something went wrong')
      } else {
        setErrorMsg('Something went wrong')
      }
    }
  }, [email, subscribe])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        width: 340,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 24,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
      }}
    >
      {/* Close button */}
      <button
        onClick={handleDismiss}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: 'none',
          border: 'none',
          color: 'var(--text-secondary)',
          fontSize: 20,
          cursor: 'pointer',
          lineHeight: 1,
          padding: '0 4px',
        }}
        aria-label="Dismiss"
      >
        &times;
      </button>

      {success ? (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            Check your email
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            We sent you a confirmation link. Click it to subscribe.
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
            Get the daily digest
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
            The best tweets from tech Twitter, curated and delivered to your inbox every day.
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--bg-base)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                fontSize: 14,
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            {errorMsg && (
              <div style={{ fontSize: 12, color: 'var(--error)', lineHeight: 1.4 }}>
                {errorMsg}
              </div>
            )}
            <button
              type="submit"
              disabled={subscribe.isPending}
              style={{
                width: '100%',
                padding: '10px 16px',
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: subscribe.isPending ? 'wait' : 'pointer',
                opacity: subscribe.isPending ? 0.7 : 1,
                fontFamily: 'inherit',
                transition: 'opacity 0.15s ease',
              }}
            >
              {subscribe.isPending ? 'Subscribing...' : 'Subscribe'}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
