import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from './client'

export function useSchedulerStatus() {
  return useQuery({
    queryKey: ['scheduler-status'],
    queryFn: async () => {
      const { data } = await api.get('/scheduler/status')
      return data
    },
    refetchInterval: 60000,
  })
}

export function useTriggerScrape() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/scheduler/trigger')
      return data
    },
  })
}

export function useUpdateSchedulerConfig() {
  return useMutation({
    mutationFn: async (config: { scrape_interval_hours?: number; scrape_max_scrolls?: number }) => {
      const { data } = await api.patch('/scheduler/config', config)
      return data
    },
  })
}
