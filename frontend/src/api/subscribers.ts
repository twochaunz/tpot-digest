import { useMutation } from '@tanstack/react-query'
import { api } from './client'

interface SubscribeResponse {
  message: string
  already_registered: boolean
  re_subscribed: boolean
}

export function useSubscribe() {
  return useMutation<SubscribeResponse, Error, { email: string }>({
    mutationFn: async (body) => {
      const { data } = await api.post('/subscribers', body)
      return data
    },
  })
}
