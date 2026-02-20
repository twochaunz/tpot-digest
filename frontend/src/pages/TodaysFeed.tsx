import { useTopics } from '../api/topics'
import { TopicCard } from '../components/TopicCard'

export function TodaysFeed() {
  const { data: topics, isLoading, error } = useTopics()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2>Today's Feed</h2>
        <span style={{ fontSize: '13px', color: '#999' }}>
          Auto-refreshes every 30s
        </span>
      </div>

      {isLoading && <p>Loading topics...</p>}
      {error && <p style={{ color: 'red' }}>Error loading topics: {String(error)}</p>}

      {topics && topics.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
          <p>No topics found for today.</p>
          <p style={{ fontSize: '13px' }}>Topics will appear after the next scrape runs.</p>
        </div>
      )}

      {topics?.map(topic => (
        <TopicCard key={topic.id} topic={topic} />
      ))}
    </div>
  )
}
