const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  emerging: { bg: '#e8f5e9', text: '#2e7d32' },
  trending: { bg: '#fff3e0', text: '#e65100' },
  peaked: { bg: '#fce4ec', text: '#c62828' },
  fading: { bg: '#eceff1', text: '#546e7a' },
}

export function LifecycleBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.emerging
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase',
      backgroundColor: colors.bg,
      color: colors.text,
    }}>
      {status}
    </span>
  )
}
