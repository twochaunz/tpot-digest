import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface GraphNode {
  id: number
  title: string
  date: string
  lifecycle_status: string
  sentiment: string | null
  tags: Record<string, unknown> | null
  summary: string | null
}

export interface GraphEdge {
  id: number
  source_topic_id: number
  target_topic_id: number
  relationship_type: string
  strength: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export function useGraph(params?: { date_from?: string; date_to?: string; tags?: string; entity?: string }) {
  return useQuery<GraphData>({
    queryKey: ['graph', params],
    queryFn: async () => {
      const { data } = await api.get('/graph', { params })
      return data
    },
  })
}

export function useGraphSearch(q: string) {
  return useQuery<GraphNode[]>({
    queryKey: ['graph-search', q],
    queryFn: async () => {
      const { data } = await api.get('/graph/search', { params: { q } })
      return data
    },
    enabled: q.length > 0,
  })
}

export function useCreateLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { source_topic_id: number; target_topic_id: number; relationship_type?: string }) => {
      const { data } = await api.post('/graph/link', body)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] })
    },
  })
}
