import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface Article {
  id: number
  tweet_id: number | null
  url: string
  archive_url: string | null
  title: string | null
  author: string | null
  publication: string | null
  full_text: string | null
  summary: string | null
  extracted_at: string
}

export function useArticle(articleId: number) {
  return useQuery<Article>({
    queryKey: ['article', articleId],
    queryFn: async () => {
      const { data } = await api.get(`/articles/${articleId}`)
      return data
    },
    enabled: !!articleId,
  })
}
