import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api } from './client'
import type { Tweet } from './tweets'
import type { Topic } from './topics'

export interface TopicBundle extends Topic {
  tweets: Tweet[]
  tweet_count: number
}

export interface DayBundle {
  topics: TopicBundle[]
  unsorted: Tweet[]
}

export function useDayBundle(date: string) {
  return useQuery<DayBundle>({
    queryKey: ['day-bundle', date],
    queryFn: async () => {
      const { data } = await api.get(`/days/${date}/bundle`)
      return data
    },
    staleTime: 30_000, // 30s — refetch picks up extension-saved tweets on focus
    refetchOnWindowFocus: true, // respects staleTime instead of always refetching
  })
}

export function useOptimisticAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { tweet_ids: number[]; topic_id: number; category?: string | null }) => {
      const { data } = await api.post('/tweets/assign', body)
      return data
    },
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['day-bundle'] })
      const prev: [string, DayBundle][] = []
      qc.getQueriesData<DayBundle>({ queryKey: ['day-bundle'] }).forEach(([key, data]) => {
        if (data) prev.push([key[1] as string, data])
      })

      qc.setQueriesData<DayBundle>({ queryKey: ['day-bundle'] }, (old) => {
        if (!old) return old
        const tweetIdSet = new Set(body.tweet_ids)
        const movingTweets: Tweet[] = []
        const newUnsorted = old.unsorted.filter((t) => {
          if (tweetIdSet.has(t.id)) { movingTweets.push(t); return false }
          return true
        })
        const newTopics = old.topics.map((topic) => {
          const filtered = topic.tweets.filter((t) => {
            if (tweetIdSet.has(t.id)) { movingTweets.push(t); return false }
            return true
          })
          return { ...topic, tweets: filtered, tweet_count: filtered.length }
        })
        const finalTopics = newTopics.map((topic) => {
          if (topic.id !== body.topic_id) return topic
          const tweetsToAdd = movingTweets.map((t) => ({
            ...t,
            category: body.category ?? t.category ?? null,
          }))
          const merged = [...topic.tweets, ...tweetsToAdd]
          return { ...topic, tweets: merged, tweet_count: merged.length }
        })
        return { topics: finalTopics, unsorted: newUnsorted }
      })
      return { prev }
    },
    onError: (_err, _body, context) => {
      if (context?.prev) {
        for (const [date, data] of context.prev) {
          qc.setQueryData(['day-bundle', date], data)
        }
      }
    },
  })
}

export function useOptimisticUnassign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { tweet_ids: number[]; topic_id: number }) => {
      const { data } = await api.post('/tweets/unassign', body)
      return data
    },
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['day-bundle'] })
      const prev: [string, DayBundle][] = []
      qc.getQueriesData<DayBundle>({ queryKey: ['day-bundle'] }).forEach(([key, data]) => {
        if (data) prev.push([key[1] as string, data])
      })

      qc.setQueriesData<DayBundle>({ queryKey: ['day-bundle'] }, (old) => {
        if (!old) return old
        const tweetIdSet = new Set(body.tweet_ids)
        const movingTweets: Tweet[] = []
        const newTopics = old.topics.map((topic) => {
          if (topic.id !== body.topic_id) return topic
          const filtered = topic.tweets.filter((t) => {
            if (tweetIdSet.has(t.id)) {
              movingTweets.push({ ...t, category: undefined })
              return false
            }
            return true
          })
          return { ...topic, tweets: filtered, tweet_count: filtered.length }
        })
        return { topics: newTopics, unsorted: [...movingTweets, ...old.unsorted] }
      })
      return { prev }
    },
    onError: (_err, _body, context) => {
      if (context?.prev) {
        for (const [date, data] of context.prev) {
          qc.setQueryData(['day-bundle', date], data)
        }
      }
    },
  })
}

export function useOptimisticDeleteTweet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/tweets/${id}`)
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['day-bundle'] })
      const prev: [string, DayBundle][] = []
      qc.getQueriesData<DayBundle>({ queryKey: ['day-bundle'] }).forEach(([key, data]) => {
        if (data) prev.push([key[1] as string, data])
      })
      qc.setQueriesData<DayBundle>({ queryKey: ['day-bundle'] }, (old) => {
        if (!old) return old
        return {
          topics: old.topics.map((t) => {
            const filtered = t.tweets.filter((tw) => tw.id !== id)
            return { ...t, tweets: filtered, tweet_count: filtered.length }
          }),
          unsorted: old.unsorted.filter((tw) => tw.id !== id),
        }
      })
      return { prev }
    },
    onError: (_err, _id, context) => {
      if (context?.prev) {
        for (const [date, data] of context.prev) {
          qc.setQueryData(['day-bundle', date], data)
        }
      }
    },
  })
}

export function useOptimisticPatchTweet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; memo?: string | null; saved_at?: string }) => {
      const { data } = await api.patch(`/tweets/${id}`, body)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['day-bundle'] })
    },
  })
}

export function useAcceptSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tweetId: number) => {
      const { data } = await api.post(`/tweets/${tweetId}/accept-suggestion`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-bundle'] }),
  })
}

export function useDismissSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tweetId: number) => {
      const { data } = await api.post(`/tweets/${tweetId}/dismiss-suggestion`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-bundle'] }),
  })
}
