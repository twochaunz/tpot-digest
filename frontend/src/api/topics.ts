import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { DayBundle } from './dayBundle'

export interface Topic {
  id: number
  title: string
  date: string
  color: string | null
  position: number
  og_tweet_id: number | null
  created_at: string
}

export function useTopics(date: string) {
  return useQuery<Topic[]>({
    queryKey: ['topics', date],
    queryFn: async () => {
      const { data } = await api.get('/topics', { params: { date } })
      return data
    },
  })
}

export function useCreateTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { title: string; date: string; color?: string }) => {
      const { data } = await api.post('/topics', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-bundle'] }),
  })
}

export function useUpdateTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; title?: string; date?: string; color?: string; position?: number; og_tweet_id?: number | null }) => {
      const { data } = await api.patch(`/topics/${id}`, body)
      return data
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['day-bundle'] })
      const prev: [string, DayBundle][] = []
      qc.getQueriesData<DayBundle>({ queryKey: ['day-bundle'] }).forEach(([key, data]) => {
        if (data) prev.push([key[1] as string, data])
      })
      qc.setQueriesData<DayBundle>({ queryKey: ['day-bundle'] }, (old) => {
        if (!old) return old
        return {
          ...old,
          topics: old.topics.map((t) => {
            if (t.id !== vars.id) return t
            const updated = { ...t }
            if ('og_tweet_id' in vars) updated.og_tweet_id = vars.og_tweet_id ?? null
            if (vars.title !== undefined) updated.title = vars.title
            if (vars.color !== undefined) updated.color = vars.color
            return updated
          }),
        }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        for (const [date, data] of context.prev) {
          qc.setQueryData(['day-bundle', date], data)
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['day-bundle'] })
    },
  })
}

export function useDeleteTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/topics/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-bundle'] }),
  })
}
