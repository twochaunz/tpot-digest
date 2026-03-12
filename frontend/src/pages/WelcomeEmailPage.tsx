import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  useDigestSettings,
  useUpdateDigestSettings,
  useWelcomePreview,
  useSendWelcomeTest,
} from '../api/digest'

const SEND_MODES = [
  { value: 'off', label: 'Off' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'immediate', label: 'Immediate' },
] as const

export function WelcomeEmailPage() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { data: settings, isLoading } = useDigestSettings()
  const updateSettings = useUpdateDigestSettings()
  const { data: preview, refetch: refetchPreview } = useWelcomePreview(true)
  const sendTest = useSendWelcomeTest()

  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sendMode, setSendMode] = useState<'off' | 'hourly' | 'immediate'>('off')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [initialized, setInitialized] = useState(false)

  const previewDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Initialize form from settings
  useEffect(() => {
    if (settings && !initialized) {
      setSubject(settings.welcome_subject)
      setMessage(settings.welcome_message)
      setSendMode(settings.welcome_send_mode)
      setInitialized(true)
    }
  }, [settings, initialized])

  // Debounced preview refresh when message changes
  useEffect(() => {
    if (!initialized) return
    clearTimeout(previewDebounceRef.current)
    previewDebounceRef.current = setTimeout(() => {
      refetchPreview()
    }, 800)
    return () => clearTimeout(previewDebounceRef.current)
  }, [message, subject, initialized, refetchPreview])

  const handleSendModeChange = useCallback((mode: 'off' | 'hourly' | 'immediate') => {
    setSendMode(mode)
    setSaveStatus('saving')
    updateSettings.mutate({ welcome_send_mode: mode }, {
      onSuccess: () => {
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      },
    })
  }, [updateSettings])

  const handleSave = useCallback(() => {
    setSaveStatus('saving')
    updateSettings.mutate(
      { welcome_subject: subject, welcome_message: message },
      {
        onSuccess: () => {
          setSaveStatus('saved')
          setTimeout(() => setSaveStatus('idle'), 2000)
          refetchPreview()
        },
      }
    )
  }, [subject, message, updateSettings, refetchPreview])

  const handleSendTest = useCallback(() => {
    setTestStatus('sending')
    sendTest.mutate(undefined, {
      onSuccess: () => {
        setTestStatus('sent')
        setTimeout(() => setTestStatus('idle'), 3000)
      },
      onError: () => {
        setTestStatus('error')
        setTimeout(() => setTestStatus('idle'), 3000)
      },
    })
  }, [sendTest])

  const resolvedVars = preview?.template_vars || {}

  if (!isAdmin) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Admin access required</div>
  }

  if (isLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
  }

  const isDimmed = sendMode === 'off'

  return (
    <div style={{ height: '100dvh', overflowY: 'auto', background: 'var(--bg-base)' }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: 'var(--bg-base)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          maxWidth: 640, margin: '0 auto', padding: '16px 24px',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <button
            onClick={() => navigate('/app/digest')}
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)',
              padding: '6px 12px', fontSize: 13, cursor: 'pointer',
              fontFamily: 'var(--font-body)', transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            &#8592; Back
          </button>

          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', margin: 0, flex: 1 }}>
            Welcome Email
          </h1>

          {saveStatus === 'saving' && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span style={{ fontSize: 12, color: '#4ade80' }}>Saved</span>
          )}
        </div>
      </header>

      {/* Content */}
      <main style={{
        maxWidth: 640, margin: '0 auto', padding: '24px 24px 80px',
        display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        {/* Send Mode */}
        <section style={{
          background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden',
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              Send mode
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
              Control when welcome emails are sent to new subscribers
            </p>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', gap: 8 }}>
            {SEND_MODES.map(mode => (
              <button
                key={mode.value}
                onClick={() => handleSendModeChange(mode.value)}
                style={{
                  background: sendMode === mode.value ? 'var(--accent)' : 'transparent',
                  color: sendMode === mode.value ? '#fff' : 'var(--text-secondary)',
                  border: sendMode === mode.value ? 'none' : '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 16px', fontSize: 13, cursor: 'pointer',
                  fontFamily: 'var(--font-body)', fontWeight: sendMode === mode.value ? 600 : 400,
                  transition: 'all 0.15s ease',
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </section>

        {/* Subject & Message */}
        <section style={{
          background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          opacity: isDimmed ? 0.5 : 1, transition: 'opacity 0.2s ease',
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              Email content
            </h2>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Subject */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Subject
              </label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                style={{
                  width: '100%', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  padding: '8px 12px', fontSize: 14, color: 'var(--text-primary)',
                  fontFamily: 'var(--font-body)', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Welcome Message */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Welcome message
              </label>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span>Available:</span>
                {['date', 'subject'].map(v => (
                  <span
                    key={v}
                    title={resolvedVars[v] ? `Current value: ${resolvedVars[v]}` : 'No digest sent yet'}
                    style={{
                      background: 'var(--bg-elevated)', padding: '1px 6px',
                      borderRadius: 'var(--radius-sm)', cursor: 'help',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={5}
                style={{
                  width: '100%', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  padding: '8px 12px', fontSize: 14, color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)', outline: 'none', resize: 'vertical',
                  lineHeight: 1.5, boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleSendTest}
                disabled={testStatus === 'sending' || !preview?.has_digest}
                style={{
                  background: 'transparent', color: 'var(--text-secondary)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                  padding: '9px 18px', fontSize: 13, cursor: 'pointer',
                  fontFamily: 'var(--font-body)', transition: 'all 0.15s ease',
                  opacity: testStatus === 'sending' || !preview?.has_digest ? 0.5 : 1,
                }}
              >
                {testStatus === 'sending' ? 'Sending...' : testStatus === 'sent' ? 'Sent!' : testStatus === 'error' ? 'Failed' : 'Send Test'}
              </button>
              <button
                onClick={handleSave}
                style={{
                  background: 'var(--accent)', color: '#fff', border: 'none',
                  borderRadius: 'var(--radius-md)', padding: '9px 18px',
                  fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)',
                  fontWeight: 600, transition: 'all 0.15s ease',
                }}
              >
                Save
              </button>
            </div>
          </div>
        </section>

        {/* Preview */}
        <section style={{
          background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          opacity: isDimmed ? 0.5 : 1, transition: 'opacity 0.2s ease',
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              Preview
            </h2>
            {preview?.subject && (
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                Subject: {preview.subject}
              </span>
            )}
          </div>
          <div style={{ padding: 0 }}>
            {preview?.html ? (
              <iframe
                srcDoc={preview.html}
                title="Welcome email preview"
                style={{
                  width: '100%', minHeight: 600, border: 'none',
                  background: '#fff',
                }}
              />
            ) : (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                Loading preview...
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
