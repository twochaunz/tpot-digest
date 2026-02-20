import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface AssetFile {
  name: string
  path: string
}

export interface SubTopicAssets {
  name: string
  path: string
  tweets: AssetFile[]
  articles: AssetFile[]
}

export interface TopicAssets {
  title: string
  date: string
  rank: number
  dir_name: string
  path: string
  subtopics_detail: SubTopicAssets[]
}

export function useAssetDates() {
  return useQuery<string[]>({
    queryKey: ['asset-dates'],
    queryFn: async () => {
      const { data } = await api.get('/assets/dates')
      return data.dates
    },
  })
}

export function useAssetBrowse(dateStr: string) {
  return useQuery<TopicAssets[]>({
    queryKey: ['asset-browse', dateStr],
    queryFn: async () => {
      const { data } = await api.get(`/assets/browse/${dateStr}`)
      return data.topics
    },
    enabled: !!dateStr,
  })
}

export async function downloadAssets(paths: string[]) {
  const response = await api.post('/assets/download', { paths }, { responseType: 'blob' })
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.download = 'assets.zip'
  link.click()
  window.URL.revokeObjectURL(url)
}
