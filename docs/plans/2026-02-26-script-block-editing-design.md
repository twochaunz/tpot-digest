# Script Block Editing — Design

## Problem
Users need to add, edit, swap, delete, and reorder blocks (text and tweets) within generated scripts. Currently the script view is optimized for presentation (two-column mirror) but lacks structured editing controls.

## Solution
Add a dedicated **Edit** tab between Topics and Present, providing a single-column full-width editor with left gutter controls and hover-activated plus buttons for inserting new blocks.

## Tab Structure

Three tabs in the ScriptPanel header: **Topics** | **Edit** | **Present**

- `g` key cycles: Topics → Edit → Present → Topics
- Drawing tools (pen/highlighter/color) only appear when Present is active
- Edit mode is a new single-column full-width view

## Edit Mode Layout

Single column, full width. Each topic section renders its script blocks vertically with a left gutter.

### Left Gutter (~32px, always visible in edit mode)

Per block:
- **Drag handle** (⠿ grip icon) — reorder blocks via `@dnd-kit` drag-and-drop
- **Delete** (× icon) — removes block from content array
- **Swap** (⇄ icon, tweet blocks only) — opens dropdown of topic's assigned tweets (excluding those already in script), selecting one replaces the tweet_id

Text blocks remain click-to-edit (existing `ScriptTextBlock` behavior).

### Plus Buttons (hover-activated)

Between every pair of blocks (and at top/bottom of each topic):
- Thin horizontal line with centered `+` icon, fades in on hover
- Click opens popover with two choices:
  - **"Text"** — inserts empty text block, immediately enters edit mode
  - **"Tweet"** — dropdown of topic's tweets not yet in script; selecting inserts tweet block

## Present Mode

Identical to current `ScriptMirrorView`:
- Two columns with scroll sync, cursor mirroring, stroke mirroring
- No editing controls, no plus buttons

## Data Flow

All edits mutate the script's `content: ScriptBlock[]` array and call `PATCH /api/topics/{topic_id}/script` with the updated array. No backend changes needed.

## Key Files

- `ScriptPanel.tsx` — add `'edit'` to activeView type, render new `ScriptEditView`
- New `ScriptEditView.tsx` — single-column edit view with gutter + plus buttons
- `DayScriptView.tsx` — extract/reuse `ScriptTextBlock`, `TweetRows`, `groupBlocks`
- `api/scripts.ts` — existing `useUpdateScript()` hook handles PATCH
