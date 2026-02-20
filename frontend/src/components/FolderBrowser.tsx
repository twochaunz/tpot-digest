import type { TopicAssets } from '../api/assets'

interface Props {
  dates: string[]
  selectedDate: string
  onDateChange: (date: string) => void
  topics: TopicAssets[]
  onSelectSubTopic: (subtopic: string) => void
  selectedSubTopic: string | null
}

export function FolderBrowser({ dates, selectedDate, onDateChange, topics, onSelectSubTopic, selectedSubTopic }: Props) {
  return (
    <div style={{
      width: '280px',
      borderRight: '1px solid var(--border-subtle)',
      backgroundColor: 'var(--bg-raised)',
      overflowY: 'auto',
      padding: '16px',
    }}>
      <h3 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-primary)' }}>Browse Dates</h3>
      <select
        value={selectedDate}
        onChange={(e) => onDateChange(e.target.value)}
        style={{ width: '100%', padding: '8px', marginBottom: '16px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}
      >
        {dates.map(d => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      <h3 style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--text-primary)' }}>Topics</h3>
      {topics.map(topic => (
        <div key={topic.dir_name} style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>
            {topic.title}
          </div>
          {topic.subtopics_detail.map(st => (
            <div
              key={st.name}
              onClick={() => onSelectSubTopic(st.path)}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                cursor: 'pointer',
                backgroundColor: selectedSubTopic === st.path ? 'var(--accent-muted)' : 'transparent',
                borderRadius: 'var(--radius-sm)',
                marginLeft: '12px',
                color: selectedSubTopic === st.path ? 'var(--accent)' : 'var(--text-secondary)',
                transition: 'all 0.15s var(--ease-out)',
              }}
            >
              {st.name}
              <span style={{ color: 'var(--text-tertiary)', marginLeft: '4px' }}>
                ({st.tweets.length + st.articles.length})
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
