/** Sort topics: kek topics always at the bottom, preserve original order otherwise. */
export function sortTopics<T extends { title: string }>(topics: T[]): T[] {
  return [...topics].sort((a, b) => {
    const aKek = a.title.toLowerCase() === 'kek' ? 1 : 0
    const bKek = b.title.toLowerCase() === 'kek' ? 1 : 0
    return aKek - bKek
  })
}

/** Check if a topic title is "kek" (case-insensitive). */
export function isKekTopic(title: string): boolean {
  return title.toLowerCase() === 'kek'
}
