import { useSchedulerStatus, useTriggerScrape, useUpdateSchedulerConfig } from '../api/scheduler'
import { useState } from 'react'

export function FilterControls() {
  const { data: status } = useSchedulerStatus()
  const triggerScrape = useTriggerScrape()
  const updateConfig = useUpdateSchedulerConfig()
  const [interval, setInterval] = useState(2)

  return (
    <div>
      <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Scrape Schedule</h3>

      <div style={{ backgroundColor: '#fff', border: '1px solid #e0e0e0', borderRadius: '6px', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px' }}>Status:</span>
          <span style={{
            padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
            backgroundColor: status?.running ? '#e8f5e9' : '#fce4ec',
            color: status?.running ? '#2e7d32' : '#c62828',
          }}>
            {status?.running ? 'Running' : 'Stopped'}
          </span>
        </div>

        {status?.next_run_time && (
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
            Next run: {new Date(status.next_run_time).toLocaleString()}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <label style={{ fontSize: '13px' }}>Interval (hours):</label>
          <input type="number" min={1} max={24} value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
            style={{ width: '60px', padding: '4px 8px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
          <button onClick={() => updateConfig.mutate({ scrape_interval_hours: interval })}
            style={{ padding: '6px 12px', fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#fff', cursor: 'pointer' }}>
            Update
          </button>
        </div>

        <button onClick={() => triggerScrape.mutate()}
          disabled={triggerScrape.isPending}
          style={{
            padding: '8px 16px', fontSize: '13px', border: 'none', borderRadius: '4px',
            backgroundColor: '#1a73e8', color: '#fff', cursor: 'pointer',
          }}>
          {triggerScrape.isPending ? 'Scraping...' : 'Trigger Scrape Now'}
        </button>
      </div>
    </div>
  )
}
