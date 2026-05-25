import {
  buildTweetGroups,
  clearDraftSelectionState,
  createFallbackDigestIntro,
  findDraftTweet,
  isTemplatePlaceholderDraft,
  resolveNewDraftDate,
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
