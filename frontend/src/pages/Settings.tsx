import { AccountManager } from '../components/AccountManager'
import { FilterControls } from '../components/FilterControls'
import { ManualTweetInput } from '../components/ManualTweetInput'

export function Settings() {
  return (
    <div style={{ maxWidth: '800px' }}>
      <h2 style={{ marginBottom: '24px', fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>Settings</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <AccountManager />
        <FilterControls />
        <ManualTweetInput />
      </div>
    </div>
  )
}
