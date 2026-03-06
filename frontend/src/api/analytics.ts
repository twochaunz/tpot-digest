import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface AnalyticsOverview {
  subscriber_count: number
  last_digest: {
    draft_id: number
    date: string
    subject: string | null
    recipients: number
    opens: number
    open_rate: number
    clicks: number
    click_rate: number
    sent_at: string | null
  } | null
}

export interface DigestAnalytics {
  draft_id: number
  date: string
  subject: string | null
  recipients: number
  opens: number
  open_rate: number
  clicks: number
  click_rate: number
  sent_at: string | null
}

export interface DigestDetail {
  top_links: Array<{ url: string; count: number }>
  subscribers: Array<{
    email: string
    subscriber_id: number
    delivered: boolean
    opened: boolean
    clicked: boolean
  }>
}

export interface SubscriberAnalytics {
  email: string
  subscriber_id: number
  subscribed_at: string | null
  digests_received: number
  open_rate: number
  click_rate: number
  last_opened: string | null
}

export function useAnalyticsOverview() {
  return useQuery<AnalyticsOverview>({
    queryKey: ['analytics-overview'],
    queryFn: async () => {
      const { data } = await api.get('/analytics/overview')
      return data
    },
  })
}

export function useDigestAnalytics() {
  return useQuery<DigestAnalytics[]>({
    queryKey: ['analytics-digests'],
    queryFn: async () => {
      const { data } = await api.get('/analytics/digests')
      return data
    },
  })
}

export function useDigestDetail(draftId: number | null) {
  return useQuery<DigestDetail>({
    queryKey: ['analytics-digest-detail', draftId],
    queryFn: async () => {
      const { data } = await api.get(`/analytics/digests/${draftId}`)
      return data
    },
    enabled: draftId !== null,
  })
}

export function useSubscriberAnalytics() {
  return useQuery<SubscriberAnalytics[]>({
    queryKey: ['analytics-subscribers'],
    queryFn: async () => {
      const { data } = await api.get('/analytics/subscribers')
      return data
    },
  })
}
