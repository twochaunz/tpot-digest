import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface Account {
  id: number
  handle: string
  display_name: string | null
  source: string
  priority: number
  is_active: boolean
  is_blocked: boolean
  is_boosted: boolean
  follower_count: number | null
}

export function useAccounts() {
  return useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data } = await api.get('/accounts')
      return data
    },
  })
}

export function useCreateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { handle: string; source?: string; priority?: number }) => {
      const { data } = await api.post('/accounts', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useUpdateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number } & Partial<Account>) => {
      const { data } = await api.patch(`/accounts/${id}`, body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useDeleteAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/accounts/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}
