import { useSchedulerStatus, useTriggerScrape, useUpdateSchedulerConfig } from '../api/scheduler'
import { useState } from 'react'

export function FilterControls() {
  const { data: status } = useSchedulerStatus()
  const triggerScrape = useTriggerScrape()
  const updateConfig = useUpdateSchedulerConfig()
  const [interval, setInterval] = useState(2)

  return (
    <div>
      <h3 style={{ fontSize: '16px', marginBottom: '12px', color: 'var(--text-primary)' }}>Scrape Schedule</h3>

      <div style={{ backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Status:</span>
          <span style={{
            padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
            backgroundColor: status?.running ? 'var(--emerging-bg)' : 'var(--peaked-bg)',
            color: status?.running ? 'var(--emerging)' : 'var(--peaked)',
          }}>
            {status?.running ? 'Running' : 'Stopped'}
          </span>
        </div>

        {status?.next_run_time && (
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            Next run: {new Date(status.next_run_time).toLocaleString()}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Interval (hours):</label>
          <input type="number" min={1} max={24} value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
            style={{ width: '60px', padding: '4px 8px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
          />
          <button onClick={() => updateConfig.mutate({ scrape_interval_hours: interval })}
            style={{ padding: '6px 12px', fontSize: '12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-elevated)', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
            Update
          </button>
        </div>

        <button onClick={() => triggerScrape.mutate()}
          disabled={triggerScrape.isPending}
          style={{
            padding: '8px 16px', fontSize: '13px', border: 'none', borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--accent)', color: 'var(--text-inverse)', cursor: 'pointer', fontWeight: 600, fontFamily: 'var(--font-body)',
          }}>
          {triggerScrape.isPending ? 'Scraping...' : 'Trigger Scrape Now'}
        </button>
      </div>
    </div>
  )
}
