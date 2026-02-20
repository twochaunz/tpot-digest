type LifecycleStatus = 'emerging' | 'trending' | 'peaked' | 'fading'

const STYLES: Record<LifecycleStatus, { color: string; bg: string }> = {
  emerging: { color: 'var(--emerging)', bg: 'var(--emerging-bg)' },
  trending: { color: 'var(--trending)', bg: 'var(--trending-bg)' },
  peaked: { color: 'var(--peaked)', bg: 'var(--peaked-bg)' },
  fading: { color: 'var(--fading)', bg: 'var(--fading-bg)' },
}

interface Props {
  status: string
}

export function LifecycleBadge({ status }: Props) {
  const style = STYLES[status as LifecycleStatus] ?? STYLES.emerging

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: '20px',
      fontSize: '11px',
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      fontFamily: 'var(--font-body)',
      color: style.color,
      background: style.bg,
    }}>
      {status}
    </span>
  )
}
