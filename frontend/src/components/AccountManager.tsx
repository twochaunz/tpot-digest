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
      <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Curated Network</h3>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          type="text"
          value={newHandle}
          onChange={(e) => setNewHandle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="@handle"
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
        />
        <button onClick={handleAdd} style={{ padding: '8px 16px', backgroundColor: '#1a73e8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
          Add
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {accounts?.map(account => (
          <div key={account.id} style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '10px 12px', backgroundColor: '#fff', border: '1px solid #e0e0e0', borderRadius: '6px',
          }}>
            <strong style={{ flex: 1, fontSize: '14px' }}>@{account.handle}</strong>
            <span style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase' }}>{account.source}</span>
            <select
              value={account.priority}
              onChange={(e) => updateAccount.mutate({ id: account.id, priority: Number(e.target.value) })}
              style={{ padding: '4px', fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px' }}
            >
              <option value={1}>High</option>
              <option value={2}>Medium</option>
              <option value={3}>Low</option>
            </select>
            <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input type="checkbox" checked={account.is_boosted}
                onChange={(e) => updateAccount.mutate({ id: account.id, is_boosted: e.target.checked })} />
              Boost
            </label>
            <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input type="checkbox" checked={account.is_blocked}
                onChange={(e) => updateAccount.mutate({ id: account.id, is_blocked: e.target.checked })} />
              Block
            </label>
            <button onClick={() => deleteAccount.mutate(account.id)}
              style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#fff', cursor: 'pointer', color: '#c62828' }}>
              Remove
            </button>
          </div>
        ))}
        {accounts?.length === 0 && (
          <p style={{ color: '#999', fontSize: '13px' }}>No accounts added yet. Add handles above.</p>
        )}
      </div>
    </div>
  )
}
