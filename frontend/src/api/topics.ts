import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['topics'], refetchType: 'active' }),
  })
}

export function useUpdateTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; title?: string; color?: string; position?: number; og_tweet_id?: number | null }) => {
      const { data } = await api.patch(`/topics/${id}`, body)
      return data
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['topics'], refetchType: 'active' })
      if ('og_tweet_id' in variables) {
        qc.invalidateQueries({ queryKey: ['tweets'], refetchType: 'active' })
      }
    },
  })
}

export function useDeleteTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/topics/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['topics'], refetchType: 'active' }),
  })
}
