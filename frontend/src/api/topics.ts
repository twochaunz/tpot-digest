import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface SubTopic {
  id: number
  topic_id: number
  title: string
  summary: string | null
  sentiment: string | null
  rank: number
}

export interface Topic {
  id: number
  date: string
  title: string
  summary: string | null
  rank: number
  lifecycle_status: string
  sentiment: string | null
  tags: Record<string, unknown> | null
  created_at: string
  subtopics: SubTopic[]
}

export function useTopics(date?: string) {
  const today = date || new Date().toISOString().split('T')[0]
  return useQuery<Topic[]>({
    queryKey: ['topics', today],
    queryFn: async () => {
      const { data } = await api.get('/topics', { params: { date: today } })
      return data
    },
  })
}

export function useTopic(topicId: number) {
  return useQuery<Topic>({
    queryKey: ['topic', topicId],
    queryFn: async () => {
      const { data } = await api.get(`/topics/${topicId}`)
      return data
    },
    enabled: !!topicId,
  })
}
