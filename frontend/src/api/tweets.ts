import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface Tweet {
  id: number
  tweet_id: string
  author_handle: string
  author_display_name: string | null
  author_avatar_url: string | null
  author_verified: boolean
  text: string
  media_urls: { type: string; url: string; width?: number; height?: number }[] | null
  engagement: { likes: number; retweets: number; replies: number } | null
  is_quote_tweet: boolean
  is_reply: boolean
  thread_id: string | null
  thread_position: number | null
  screenshot_path: string | null
  feed_source: string | null
  url: string | null
  memo: string | null
  grok_context: string | null
  created_at: string | null
  saved_at: string
  category?: string | null
}

export function useTweets(params: {
  date?: string
  topic_id?: number
  category_id?: number
  unassigned?: boolean
  q?: string
  thread_id?: string
}) {
  return useQuery<Tweet[]>({
    queryKey: ['tweets', params],
    queryFn: async () => {
      const { data } = await api.get('/tweets', { params })
      return data
    },
  })
}

export function useAssignTweets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { tweet_ids: number[]; topic_id: number; category?: string | null }) => {
      const { data } = await api.post('/tweets/assign', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tweets'] }),
  })
}

export function useUnassignTweets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { tweet_ids: number[]; topic_id: number }) => {
      const { data } = await api.post('/tweets/unassign', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tweets'] }),
  })
}

export function usePatchTweet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; memo?: string | null; saved_at?: string }) => {
      const { data } = await api.patch(`/tweets/${id}`, body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tweets'] }),
  })
}

export function useDeleteTweet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/tweets/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tweets'] }),
  })
}

export function useFetchGrokContext() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tweetId: number) => {
      const { data } = await api.post(`/tweets/${tweetId}/grok`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tweets'] }),
  })
}
