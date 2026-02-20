import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', label: "Today's Feed", icon: '\u{1F4E1}' },
  { to: '/graph', label: 'Graph Explorer', icon: '\u{1F517}' },
  { to: '/assets', label: 'Assets', icon: '\u{1F4C1}' },
  { to: '/settings', label: 'Settings', icon: '\u{2699}\u{FE0F}' },
]

export function Sidebar() {
  return (
    <nav style={{
      width: '220px',
      backgroundColor: 'var(--bg-raised)',
      color: 'var(--text-primary)',
      padding: '20px 0',
      display: 'flex',
      flexDirection: 'column',
      borderRight: '1px solid var(--border-subtle)',
    }}>
      <h1 style={{ padding: '0 20px', fontSize: '18px', marginBottom: '24px', fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>
        tpot digest
      </h1>
      {navItems.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          style={({ isActive }) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 20px',
            color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
            backgroundColor: isActive ? 'var(--bg-active)' : 'transparent',
            textDecoration: 'none',
            fontSize: '14px',
            fontFamily: 'var(--font-body)',
            borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
            transition: 'all 0.15s var(--ease-out)',
          })}
        >
          <span>{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
