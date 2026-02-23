import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Tweet } from '../api/tweets'

export function useGrokContext() {
  const qc = useQueryClient()
  return useMutation<Tweet, Error, { id: number; force?: boolean }>({
    mutationFn: async ({ id, force }) => {
      const params = force ? { force: true } : {}
      const { data } = await api.post(`/tweets/${id}/grok`, null, { params })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tweets'] })
    },
  })
}
