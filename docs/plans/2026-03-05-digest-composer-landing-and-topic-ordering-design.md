# Digest Composer: Draft List Landing & Topic Ordering

## Feature 1: Draft List Landing Page

When `selectedDraftId` is null, replace the empty content blocks area with a draft list.

- All drafts sorted by date descending (from `useDigestDrafts()`)
- Each row: date, status badge (draft/scheduled/sent), subject or "Untitled", topic count, sent metadata
- Click row → sets `selectedDraftId`, shows full editor
- "New Draft from Topics" button at top (uses selected date from date strip)
- Date strip stays for selecting which date a new draft targets
- Once inside a draft, the dropdown selector in the date strip appears for switching

## Feature 2: Topic Ordering with Number Badges

Replace checkboxes in `TopicSelectorModal` with numbered circles.

- Unselected: empty circle
- Click → assigns next number (#1, #2, #3...)
- Click selected → deselects, remaining numbers re-sequence
- "Top 3" selects first 3 as #1, #2, #3
- `onConfirm` changes from `Set<number>` to `number[]` (ordered)
- `generateTemplateBlocks` uses this ordering instead of default sort
