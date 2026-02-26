import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface ScriptBlock {
  type: 'text' | 'tweet'
  text?: string
  tweet_id?: string
}

export interface TopicScript {
  id: number
  topic_id: number
  version: number
  model_used: string
  content: ScriptBlock[]
  feedback: string | null
  is_active: boolean
  created_at: string
}

export interface ScriptVersionSummary {
  id: number
  version: number
  model_used: string
  feedback: string | null
  is_active: boolean
  created_at: string
}

export const AVAILABLE_MODELS = [
  { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 (Reasoning)', provider: 'xAI' },
  { id: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 (Fast)', provider: 'xAI' },
  { id: 'grok-3', label: 'Grok 3', provider: 'xAI' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'Anthropic' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Anthropic' },
] as const

export function useTopicScript(topicId: number | undefined) {
  return useQuery<TopicScript>({
    queryKey: ['script', topicId],
    queryFn: async () => {
      const { data } = await api.get(`/topics/${topicId}/script`)
      return data
    },
    enabled: !!topicId,
    retry: false,
  })
}

export function useScriptVersions(topicId: number | undefined) {
  return useQuery<ScriptVersionSummary[]>({
    queryKey: ['script-versions', topicId],
    queryFn: async () => {
      const { data } = await api.get(`/topics/${topicId}/script/versions`)
      return data
    },
    enabled: !!topicId,
  })
}

export function useGenerateScript() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ topicId, model, feedback, fetchGrokContext }: {
      topicId: number
      model: string
      feedback?: string
      fetchGrokContext?: boolean
    }) => {
      const { data } = await api.post(`/topics/${topicId}/script/generate`, {
        model,
        feedback: feedback || null,
        fetch_grok_context: fetchGrokContext ?? true,
      })
      return data as TopicScript
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['script', data.topic_id] })
      qc.invalidateQueries({ queryKey: ['script-versions', data.topic_id] })
      qc.invalidateQueries({ queryKey: ['day-bundle'] })
    },
  })
}

export function useGenerateDayScripts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ date, model, fetchGrokContext, topicIds }: {
      date: string
      model: string
      fetchGrokContext?: boolean
      topicIds?: number[]
    }) => {
      const { data } = await api.post(`/dates/${date}/script/generate`, {
        model,
        fetch_grok_context: fetchGrokContext ?? true,
        topic_ids: topicIds ?? null,
      })
      return data as TopicScript[]
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['script'] })
      qc.invalidateQueries({ queryKey: ['script-versions'] })
    },
  })
}
