import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTweetGroups, findDraftTweet, isTemplatePlaceholderDraft, resolveNewDraftDate } from './digestComposer.ts'

const tweet = (id: number, text: string) => ({
  id,
  tweet_id: String(id),
  text,
  author_handle: 'user',
})

test('finds a draft tweet when it is visible in the unsorted feed', () => {
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

  const result = findDraftTweet(groups, 2)

  assert.equal(result?.tweet.id, 2)
  assert.equal(result?.topicTitle, 'Unsorted')
})

test('uses the generation date for delayed new draft autosaves', () => {
  assert.equal(resolveNewDraftDate('2026-05-13', '2026-05-14'), '2026-05-13')
})

test('identifies a stuck template placeholder draft', () => {
  assert.equal(isTemplatePlaceholderDraft([{ type: 'text', content: 'Generating template...' }]), true)
  assert.equal(isTemplatePlaceholderDraft([{ type: 'text', content: '# real draft' }]), false)
  assert.equal(isTemplatePlaceholderDraft([
    { type: 'text', content: 'Generating template...' },
    { type: 'topic-header', content: null },
  ]), false)
})
