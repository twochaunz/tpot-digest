import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface DigestBlock {
  id: string
  type: 'text' | 'topic-header' | 'tweet' | 'divider'
  content?: string | null       // text blocks (supports markdown)
  topic_id?: number | null      // topic-header blocks
  tweet_id?: number | null      // tweet blocks (DB integer id)
  show_engagement?: boolean     // tweet blocks
}

export interface GenerateTemplateResult {
  topics: Array<{
    topic_id: number
    title: string
    summary: string | null
    category_groups: Array<{
      category: string
      tweet_ids: number[]
      transition: string | null
    }>
  }>
}

export interface DigestDraft {
  id: number
  date: string
  content_blocks: DigestBlock[]
  subject: string | null
  scheduled_for: string | null
  sent_at: string | null
  recipient_count: number | null
  status: 'draft' | 'scheduled' | 'sent'
  created_at: string
  updated_at: string
}

export interface DigestPreview {
  subject: string
  html: string
  recipient_count: number
}

export function useDigestDrafts(status?: string) {
  return useQuery<DigestDraft[]>({
    queryKey: ['digest-drafts', status],
    queryFn: async () => {
      const params = status ? { status } : {}
      const { data } = await api.get('/digest/drafts', { params })
      return data
    },
  })
}

export function useDigestDraft(draftId: number | null) {
  return useQuery<DigestDraft>({
    queryKey: ['digest-draft', draftId],
    queryFn: async () => {
      const { data } = await api.get(`/digest/drafts/${draftId}`)
      return data
    },
    enabled: draftId !== null,
  })
}

export function useCreateDigestDraft() {
  const qc = useQueryClient()
  return useMutation<DigestDraft, Error, { date: string; content_blocks: DigestBlock[] }>({
    mutationFn: async (body) => {
      const { data } = await api.post('/digest/drafts', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['digest-drafts'] }),
  })
}

export function useUpdateDigestDraft() {
  const qc = useQueryClient()
  return useMutation<DigestDraft, Error, { id: number; content_blocks?: DigestBlock[]; scheduled_for?: string | null; subject?: string }>({
    mutationFn: async ({ id, ...body }) => {
      const { data } = await api.patch(`/digest/drafts/${id}`, body)
      return data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['digest-drafts'] })
      qc.setQueryData(['digest-draft', data.id], data)
      qc.invalidateQueries({ queryKey: ['digest-preview', data.id] })
    },
  })
}

export function useDeleteDigestDraft() {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (id) => { await api.delete(`/digest/drafts/${id}`) },
    onSuccess: (_data, deletedId) => {
      qc.invalidateQueries({ queryKey: ['digest-drafts'] })
      qc.removeQueries({ queryKey: ['digest-draft', deletedId] })
      qc.removeQueries({ queryKey: ['digest-preview', deletedId] })
    },
  })
}

export function useDigestPreview(draftId: number | null) {
  return useQuery<DigestPreview>({
    queryKey: ['digest-preview', draftId],
    queryFn: async () => {
      const { data } = await api.get(`/digest/drafts/${draftId}/preview`)
      return data
    },
    enabled: draftId !== null,
  })
}

export function useSendTestDigest() {
  return useMutation<{ sent: boolean; to: string }, Error, number>({
    mutationFn: async (draftId) => {
      const { data } = await api.post(`/digest/drafts/${draftId}/send-test`)
      return data
    },
  })
}

export function useSendDigest() {
  const qc = useQueryClient()
  return useMutation<
    { sent_count: number; total_subscribers: number },
    Error,
    { draftId: number; subscriberIds?: number[] }
  >({
    mutationFn: async ({ draftId, subscriberIds }) => {
      const body = subscriberIds ? { subscriber_ids: subscriberIds } : undefined
      const { data } = await api.post(`/digest/drafts/${draftId}/send`, body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['digest-drafts'] }),
  })
}

export function useGenerateTemplate() {
  return useMutation<GenerateTemplateResult, Error, { date: string; topic_ids: number[] }>({
    mutationFn: async (body) => {
      const { data } = await api.post('/digest/generate-template', body)
      return data
    },
  })
}

export function useSubscriberCount() {
  return useQuery<{ count: number }>({
    queryKey: ['subscriber-count'],
    queryFn: async () => {
      const { data } = await api.get('/subscribers/count')
      return data
    },
  })
}

export interface SubscriberInfo {
  id: number
  email: string
  unsubscribed_at: string | null
  subscribed_at: string
}

export function useSubscribers(enabled: boolean) {
  return useQuery<SubscriberInfo[]>({
    queryKey: ['subscribers'],
    queryFn: async () => {
      const { data } = await api.get('/subscribers')
      return data
    },
    enabled,
  })
}
