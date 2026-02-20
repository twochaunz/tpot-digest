import { useTopics } from '../api/topics'
import { TopicCard } from '../components/TopicCard'
import { ExtensionStatus } from '../components/ExtensionStatus'
import { UnclusteredQueue } from '../components/UnclusteredQueue'

export function TodaysFeed() {
  const { data: topics, isLoading, error } = useTopics()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>Today's Feed</h2>
        <ExtensionStatus />
      </div>

      <UnclusteredQueue />

      {isLoading && <p style={{ color: 'var(--text-secondary)' }}>Loading topics...</p>}
      {error && <p style={{ color: 'var(--negative)' }}>Error loading topics: {String(error)}</p>}

      {topics && topics.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
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
