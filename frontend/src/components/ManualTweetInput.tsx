import { useState } from 'react'
import { api } from '../api/client'

export function ManualTweetInput() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleSubmit = async () => {
    if (!url.trim()) return
    setStatus('loading')
    try {
      await api.post('/tweets/from-url', { url: url.trim() })
      setStatus('success')
      setMessage('Tweet added successfully!')
      setUrl('')
    } catch {
      setStatus('error')
      setMessage('Failed to add tweet. Check the URL format.')
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: '16px', marginBottom: '12px', color: 'var(--text-primary)' }}>Manual Tweet Input</h3>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setStatus('idle') }}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="https://x.com/user/status/123456"
          style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', fontSize: '14px', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}
        />
        <button onClick={handleSubmit} disabled={status === 'loading'}
          style={{ padding: '8px 16px', backgroundColor: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-body)' }}>
          {status === 'loading' ? 'Adding...' : 'Add Tweet'}
        </button>
      </div>
      {status !== 'idle' && (
        <p style={{ fontSize: '13px', marginTop: '8px', color: status === 'success' ? 'var(--positive)' : 'var(--negative)' }}>
          {message}
        </p>
      )}
    </div>
  )
}
