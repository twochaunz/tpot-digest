export interface DigestComposerTweet {
  id: number
}

export interface DigestComposerTopic<TTweet extends DigestComposerTweet> {
  id: number
  title: string
  color?: string | null
  tweets: TTweet[]
}

export interface DigestTopicGroup<TTopic extends { id: number }> {
  date: string
  label: string
  topics: TTopic[]
}

export interface DigestTweetGroup<TTweet extends DigestComposerTweet> {
  key: string
  topicTitle: string
  topicColor: string | null
  tweets: TTweet[]
}

export interface DraftTweetMatch<TTweet extends DigestComposerTweet> {
  tweet: TTweet
  topicTitle: string
  topicColor: string | null
}

export interface DraftSelectionState<TBlock> {
  selectedDraftId: number | null
  loadedDraftId: number | null
  blocks: TBlock[]
}

export function buildTweetGroups<TTweet extends DigestComposerTweet>(
  topics: DigestComposerTopic<TTweet>[],
  unsortedTweets: TTweet[] = [],
): DigestTweetGroup<TTweet>[] {
  const groups = topics.map((topic) => ({
    key: `topic-${topic.id}`,
    topicTitle: topic.title,
    topicColor: topic.color ?? null,
    tweets: topic.tweets,
  }))

  if (unsortedTweets.length > 0) {
    groups.push({
      key: 'unsorted',
      topicTitle: 'Unsorted',
      topicColor: 'var(--text-tertiary)',
      tweets: unsortedTweets,
    })
  }

  return groups
}

export function findDraftTweet<TTweet extends DigestComposerTweet>(
  groups: DigestTweetGroup<TTweet>[],
  tweetId: number,
): DraftTweetMatch<TTweet> | null {
  for (const group of groups) {
    const found = group.tweets.find((tweet) => tweet.id === tweetId)
    if (found) {
      return {
        tweet: found,
        topicTitle: group.topicTitle,
        topicColor: group.topicColor,
      }
    }
  }
  return null
}

export function resolveNewDraftDate(pendingCreateDate: string | null, currentDate: string): string {
  return pendingCreateDate || currentDate
}

export function uniqueTweetIds(ids: Array<number | null | undefined>): number[] {
  return Array.from(new Set(ids.filter((id): id is number => typeof id === 'number')))
}

export function isTemplatePlaceholderDraft(blocks: Array<{ type?: string; content?: string | null }>): boolean {
  return blocks.length === 1
    && blocks[0].type === 'text'
    && (blocks[0].content || '').trim().toLowerCase() === 'generating template...'
}

export function shouldLoadSelectedDraft(
  draft: { id: number } | null | undefined,
  loadedDraftId: number | null,
  selectedDraftId: number | null,
): boolean {
  return !!draft && draft.id === selectedDraftId && draft.id !== loadedDraftId
}

export function clearDraftSelectionState<TBlock>(): DraftSelectionState<TBlock> {
  return {
    selectedDraftId: null,
    loadedDraftId: null,
    blocks: [],
  }
}

export function createFallbackDigestIntro(topicTitles: string[]): string {
  const titles = topicTitles.map((title) => title.trim()).filter(Boolean)
  if (titles.length === 0) {
    return "quick catch-up on what happened in tech today"
  }
  if (titles.length === 1) {
    return `quick catch-up on ${titles[0]}`
  }
  const last = titles[titles.length - 1]
  const first = titles.slice(0, -1).join(', ')
  return `quick catch-up on ${first}, and ${last}`
}

function formatDateStr(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function getDigestLookbackDates(dateStr: string, totalDays = 7): string[] {
  const start = new Date(dateStr + 'T00:00:00')
  return Array.from({ length: totalDays }, (_, offset) => {
    const d = new Date(start)
    d.setDate(d.getDate() - offset)
    return formatDateStr(d)
  })
}

export function formatDigestTopicGroupLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  })
}

export function mapTopicDates<TTopic extends { id: number }>(
  topicGroups: Array<{ date: string; topics: TTopic[] }>,
): Map<number, string> {
  const topicDateMap = new Map<number, string>()
  for (const group of topicGroups) {
    for (const topic of group.topics) {
      topicDateMap.set(topic.id, group.date)
    }
  }
  return topicDateMap
}
