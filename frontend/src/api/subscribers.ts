import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'

interface SubscribeResponse {
  message: string
  already_registered: boolean
}

interface SubscriptionCheck {
  subscribed: boolean
}

export function useSubscribe() {
  return useMutation<SubscribeResponse, Error, { email: string }>({
    mutationFn: async (body) => {
      const { data } = await api.post('/subscribers', body)
      return data
    },
  })
}

export function useCheckSubscription() {
  return useQuery<SubscriptionCheck>({
    queryKey: ['subscription-check'],
    queryFn: async () => {
      const { data } = await api.get('/subscribers/check')
      return data
    },
    staleTime: Infinity,
  })
}
