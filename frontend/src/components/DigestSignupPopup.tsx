import { useState, useCallback } from 'react'
import { useSubscribe } from '../api/subscribers'
import { useAuth } from '../contexts/AuthContext'

export function DigestSignupPopup() {
  const { isAdmin } = useAuth()
  const [visible, setVisible] = useState(true)
  const [email, setEmail] = useState('')
  const [success, setSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const subscribe = useSubscribe()

  const handleDismiss = useCallback(() => {
    setVisible(false)
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

  if (isAdmin || !visible) return null

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
      {success ? (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            You're subscribed 😀
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
            Top tech discourse, sent out daily.
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
            Keep up with the news, inside jokes, drama of tech.
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
          <button
            onClick={handleDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
              padding: 0,
              marginTop: 12,
              fontFamily: 'inherit',
              width: '100%',
              textAlign: 'center',
            }}
          >
            I actually like wasting my day on twitter &rsaquo;
          </button>
        </>
      )}
    </div>
  )
}
