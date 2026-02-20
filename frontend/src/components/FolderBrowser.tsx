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
      borderRight: '1px solid #e0e0e0',
      backgroundColor: '#fafafa',
      overflowY: 'auto',
      padding: '16px',
    }}>
      <h3 style={{ fontSize: '14px', marginBottom: '12px' }}>Browse Dates</h3>
      <select
        value={selectedDate}
        onChange={(e) => onDateChange(e.target.value)}
        style={{ width: '100%', padding: '8px', marginBottom: '16px', border: '1px solid #ddd', borderRadius: '4px' }}
      >
        {dates.map(d => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>Topics</h3>
      {topics.map(topic => (
        <div key={topic.dir_name} style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
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
                backgroundColor: selectedSubTopic === st.path ? '#e3f2fd' : 'transparent',
                borderRadius: '4px',
                marginLeft: '12px',
                color: '#555',
              }}
            >
              {st.name}
              <span style={{ color: '#999', marginLeft: '4px' }}>
                ({st.tweets.length + st.articles.length})
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
