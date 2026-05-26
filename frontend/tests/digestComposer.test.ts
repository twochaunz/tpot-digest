import {
  buildTweetGroups,
  clearDraftSelectionState,
  createFallbackDigestIntro,
  findDraftTweet,
  getDefaultTemplateTopicIds,
  getDigestLookbackDates,
  isTemplatePlaceholderDraft,
  mapTopicDates,
  resolveNewDraftDate,
  resolveSelectedTemplateTopics,
  shouldLoadSelectedDraft,
} from '../src/utils/digestComposer'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`)
  }
}

const tweet = (id: number, text: string) => ({
  id,
  tweet_id: String(id),
  text,
  author_handle: 'user',
})

const groups = buildTweetGroups(
  [
    {
      id: 10,
      title: 'Assigned',
      color: '#123456',
      tweets: [tweet(1, 'assigned tweet')],
    },
  ],
  [tweet(2, 'unsorted tweet')],
)

assertEqual(
  findDraftTweet(groups, 2)?.topicTitle,
  'Unsorted',
  'finds a draft tweet when it is visible in the unsorted feed',
)

assertEqual(
  resolveNewDraftDate('2026-05-13', '2026-05-14'),
  '2026-05-13',
  'uses the generation date for delayed new draft autosaves',
)

assertEqual(
  shouldLoadSelectedDraft({ id: 7 }, 7, null),
  false,
  'does not load stale cached draft data after draft selection is cleared',
)

assertEqual(
  shouldLoadSelectedDraft({ id: 7 }, null, 7),
  true,
  'loads cached draft data again after date navigation resets the loaded draft guard',
)

assertDeepEqual(
  clearDraftSelectionState(),
  { selectedDraftId: null, loadedDraftId: null, blocks: [] },
  'date navigation clears selected draft, loaded draft guard, and visible blocks together',
)

assertEqual(
  createFallbackDigestIntro(['Agents SDK updates', 'Gemini drama']).length > 0,
  true,
  'fallback drafts include an intro even if AI intro generation fails',
)

assertEqual(
  isTemplatePlaceholderDraft([{ type: 'text', content: 'Generating template...' }]),
  true,
  'still identifies legacy stuck placeholder drafts',
)

assertDeepEqual(
  getDigestLookbackDates('2026-05-22'),
  [
    '2026-05-22',
    '2026-05-21',
    '2026-05-20',
    '2026-05-19',
    '2026-05-18',
    '2026-05-17',
    '2026-05-16',
  ],
  'digest topic picker uses seven total days including the selected date',
)

assertDeepEqual(
  Array.from(mapTopicDates([
    { date: '2026-05-22', topics: [{ id: 1, title: 'Friday topic', tweets: [] }] },
    { date: '2026-05-20', topics: [{ id: 2, title: 'Wednesday topic', tweets: [] }] },
  ]).entries()),
  [[1, '2026-05-22'], [2, '2026-05-20']],
  'topic date mapping keeps timeline links pointed at the source day',
)

assertDeepEqual(
  getDefaultTemplateTopicIds([
    { date: '2026-05-25', label: 'Mon 5/25', topics: [
      { id: 3, title: 'Main topic', tweets: [] },
      { id: 4, title: 'kek', tweets: [] },
    ] },
    { date: '2026-05-24', label: 'Sun 5/24', topics: [
      { id: 5, title: 'kek', tweets: [] },
    ] },
  ], '2026-05-25'),
  [4],
  'only the draft day kek topic is checked by default',
)

assertDeepEqual(
  resolveSelectedTemplateTopics([
    { id: 1, title: 'Selected story', tweets: [] },
    { id: 2, title: 'kek', tweets: [] },
    { id: 3, title: 'Older kek', tweets: [] },
  ], [1, 3]),
  {
    featured: [
      { id: 1, title: 'Selected story', tweets: [] },
      { id: 3, title: 'Older kek', tweets: [] },
    ],
    rest: [],
  },
  'unselected kek topics are hidden from draft output entirely',
)
