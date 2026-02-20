import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface Tweet {
  id: number
  tweet_id: string
  author_handle: string
  text: string
  media_urls: Record<string, unknown> | null
  posted_at: string | null
  scraped_at: string
  engagement: { likes?: number; retweets?: number; replies?: number } | null
  quality_score: number | null
  feed_source: string | null
}

export function useTweetsBySubTopic(subtopicId: number) {
  return useQuery<Tweet[]>({
    queryKey: ['subtopic-tweets', subtopicId],
    queryFn: async () => {
      // Backend doesn't have this endpoint yet, so we'll use the tweets list
      // and filter client-side for now. This will be replaced later.
      const { data } = await api.get('/tweets')
      return data
    },
    enabled: !!subtopicId,
  })
}
