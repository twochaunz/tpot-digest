import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

interface UnclusteredTweet {
  id: number
  tweet_id: string
  author_handle: string
  text: string
  scraped_at: string
  engagement: Record<string, number> | null
}

interface ClusterResponse {
  status: 'started' | 'no_tweets'
  unclustered_count: number
}

export function useUnclusteredTweets() {
  return useQuery<UnclusteredTweet[]>({
    queryKey: ['unclustered'],
    queryFn: async () => {
      const { data } = await api.get('/ingest/unclustered')
      return data
    },
    refetchInterval: 15000,
  })
}

export function useTriggerClustering() {
  const queryClient = useQueryClient()
  return useMutation<ClusterResponse>({
    mutationFn: async () => {
      const { data } = await api.post('/ingest/cluster')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unclustered'] })
      queryClient.invalidateQueries({ queryKey: ['topics'] })
    },
  })
}
