import { useState } from 'react'
import { useAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount } from '../api/accounts'

export function AccountManager() {
  const { data: accounts, isLoading } = useAccounts()
  const createAccount = useCreateAccount()
  const updateAccount = useUpdateAccount()
  const deleteAccount = useDeleteAccount()
  const [newHandle, setNewHandle] = useState('')

  const handleAdd = () => {
    if (newHandle.trim()) {
      createAccount.mutate({ handle: newHandle.trim().replace('@', '') })
      setNewHandle('')
    }
  }

  if (isLoading) return <p>Loading accounts...</p>

  return (
    <div>
      <h3 style={{ fontSize: '16px', marginBottom: '12px', color: 'var(--text-primary)' }}>Curated Network</h3>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          type="text"
          value={newHandle}
          onChange={(e) => setNewHandle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="@handle"
          style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', fontSize: '14px', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}
        />
        <button onClick={handleAdd} style={{ padding: '8px 16px', backgroundColor: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-body)' }}>
          Add
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {accounts?.map(account => (
          <div key={account.id} style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '10px 12px', backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
          }}>
            <strong style={{ flex: 1, fontSize: '14px', color: 'var(--text-primary)' }}>@{account.handle}</strong>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{account.source}</span>
            <select
              value={account.priority}
              onChange={(e) => updateAccount.mutate({ id: account.id, priority: Number(e.target.value) })}
              style={{ padding: '4px', fontSize: '12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
            >
              <option value={1}>High</option>
              <option value={2}>Medium</option>
              <option value={3}>Low</option>
            </select>
            <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={account.is_boosted}
                onChange={(e) => updateAccount.mutate({ id: account.id, is_boosted: e.target.checked })} />
              Boost
            </label>
            <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={account.is_blocked}
                onChange={(e) => updateAccount.mutate({ id: account.id, is_blocked: e.target.checked })} />
              Block
            </label>
            <button onClick={() => deleteAccount.mutate(account.id)}
              style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-elevated)', cursor: 'pointer', color: 'var(--negative)' }}>
              Remove
            </button>
          </div>
        ))}
        {accounts?.length === 0 && (
          <p style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>No accounts added yet. Add handles above.</p>
        )}
      </div>
    </div>
  )
}
