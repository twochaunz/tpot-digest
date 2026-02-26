# Script Panel Two-View Redesign

**Date**: 2026-02-26
**Status**: Approved
**Scope**: Split DayScriptView into Topic Manager + Script Mirror views

## Problem

1. **Scroll mirror latency**: The current ratio-based scroll sync (`scrollTop / scrollHeight`) drifts because left and right columns have different content heights.
2. **No topic management view**: Topic selection, script generation, and reordering are mixed into the script view, making it cumbersome to manage topics before recording.

## Design

### Component Architecture

Split the current monolithic `DayScriptView` (1349 lines) into three components:

**`ScriptPanel`** (parent, replaces `DayScriptView` as entry point)
- Props: `{ date, topics, onClose }`
- Shared state: `selectedTopicIds: Set<number>`, `orderedTopicIds: number[]`, `activeView: 'topics' | 'script'`
- Renders: header bar (back button, tab toggle, `g` shortcut listener) + active view
- Portal-rendered full-screen overlay (same z-index 60)

**`TopicManagerView`** (child)
- Single-column checklist of all topics
- Each row: checkbox, color dot, title, script status badge, drag handle
- Ordered by tweet count (most to least)
- Top 3 selected by default
- Select All / Deselect All at top
- Drag-to-reorder with `@dnd-kit` (persists position to backend)
- Bottom toolbar: model picker + "Generate Scripts" button for selected topics missing scripts
- Status line: "3 of 5 selected, 1 needs script"

**`ScriptMirrorView`** (child)
- Dual-column layout showing only selected topics
- Left: editable script, Right: read-only mirror
- Element-aligned scroll sync (see below)
- All drawing functionality (pen, highlighter, color wheel, image overlay)
- Mirror cursor

### Element-Aligned Scroll Sync

Replace ratio-based sync with section-anchored sync:

1. Each topic section in both columns gets `data-topic-id` attribute
2. IntersectionObserver on left column tracks which topic header is topmost visible
3. On scroll, find active topic header's viewport-relative offset in left column
4. Find matching `data-topic-id` element in right column
5. Set `right.scrollTop` so matching element is at same viewport position

Performance:
- `requestAnimationFrame`-throttled scroll handler (max one sync per frame)
- Direct DOM manipulation via refs (no React state updates during scroll)
- `syncing` ref prevents feedback loops
- IntersectionObserver is passive/async

### Header Bar

Layout: `[ Back ← ] [ "Topics" | "Script" tabs ] [ ... drawing tools (script view only) ]`

- Tab toggle: active tab has bottom border accent
- `g` keyboard shortcut toggles between views
- Drawing tools visible only in Script view
- Escape closes panel

### Topic Ordering

Topics ordered by tweet count (most to least tweets). This is the default sort in the Topic Manager. Drag-to-reorder overrides this for the session.

### Default Selection

Top 3 topics (by tweet count) are selected by default when panel opens.

## Performance Strategy

- **View switching**: Both views rendered, inactive uses `display: none` — no mount/unmount cost
- **Drawing**: Canvas-based with rAF loop, stroke data in refs not state
- **Scroll sync**: rAF-throttled, direct DOM writes, no state updates
- **Rendering**: `React.memo` on `TopicScriptSection` and `TopicScriptSectionMirror`, only selected topics rendered in script view
- **Mirror cursor**: Direct DOM positioning, no React state during movement

## Files Affected

- `frontend/src/components/DayScriptView.tsx` — refactor into three components
- `frontend/src/components/ScriptPanel.tsx` — new parent component
- `frontend/src/components/TopicManagerView.tsx` — new topic management view
- `frontend/src/components/ScriptMirrorView.tsx` — extracted script mirror view
- `frontend/src/components/DayFeedPanel.tsx` — update import from DayScriptView to ScriptPanel
