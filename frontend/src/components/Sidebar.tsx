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
      backgroundColor: '#1a1a2e',
      color: '#eee',
      padding: '20px 0',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <h1 style={{ padding: '0 20px', fontSize: '18px', marginBottom: '24px' }}>
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
            color: isActive ? '#fff' : '#aaa',
            backgroundColor: isActive ? '#16213e' : 'transparent',
            textDecoration: 'none',
            fontSize: '14px',
          })}
        >
          <span>{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
