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
      <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Manual Tweet Input</h3>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setStatus('idle') }}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="https://x.com/user/status/123456"
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
        />
        <button onClick={handleSubmit} disabled={status === 'loading'}
          style={{ padding: '8px 16px', backgroundColor: '#1a73e8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
          {status === 'loading' ? 'Adding...' : 'Add Tweet'}
        </button>
      </div>
      {status !== 'idle' && (
        <p style={{ fontSize: '13px', marginTop: '8px', color: status === 'success' ? '#2e7d32' : '#c62828' }}>
          {message}
        </p>
      )}
    </div>
  )
}
