import { useMutation } from '@tanstack/react-query'
import { api } from './client'

interface WaitlistResponse {
  message: string
  already_registered: boolean
}

export function useJoinWaitlist() {
  return useMutation({
    mutationFn: async (email: string): Promise<WaitlistResponse> => {
      const { data } = await api.post('/waitlist', { email })
      return data
    },
  })
}
