/** Sort topics: kek at bottom, then by tweet count desc, then earliest saved_at asc. */
export function sortTopics<T extends { title: string; tweets?: { saved_at: string }[]; tweet_count?: number }>(topics: T[]): T[] {
  return [...topics].sort((a, b) => {
    const aKek = isKekTopic(a.title) ? 1 : 0
    const bKek = isKekTopic(b.title) ? 1 : 0
    if (aKek !== bKek) return aKek - bKek

    const aCount = a.tweet_count ?? a.tweets?.length ?? 0
    const bCount = b.tweet_count ?? b.tweets?.length ?? 0
    if (aCount !== bCount) return bCount - aCount

    const aEarliest = a.tweets?.length ? a.tweets.reduce((min, t) => t.saved_at < min ? t.saved_at : min, a.tweets[0].saved_at) : ''
    const bEarliest = b.tweets?.length ? b.tweets.reduce((min, t) => t.saved_at < min ? t.saved_at : min, b.tweets[0].saved_at) : ''
    return aEarliest.localeCompare(bEarliest)
  })
}

/** Check if a topic title is "kek" (case-insensitive). */
export function isKekTopic(title: string): boolean {
  return title.toLowerCase() === 'kek'
}
