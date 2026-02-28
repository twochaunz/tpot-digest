# Table of Contents Overlay — Design

## Behavior
- **Open**: Press `T` on keyboard (ignored when focus is in input/textarea), or tap a FAB button (bottom-right corner)
- **Close**: Press `Escape`, click backdrop, tap X button, or select a section (all close it)
- **On select**: Smooth-scroll to the section, then close the TOC

## Visual
- Fixed overlay with semi-transparent backdrop (`rgba(0,0,0,0.7)`), z-index 100
- Centered panel using existing design system variables (`--bg-raised`, `--border`, `--radius-lg`)
- List of clickable entries:
  - **Unsorted (N)** — only shown if unsorted tweets exist
  - **Topic Title (N)** — one per topic, with topic color dot, tweet count
- Each entry highlights on hover/tap

## FAB Button
- Fixed position bottom-right (`bottom: 24px, right: 24px`)
- Small circular button with a list/TOC icon
- Hidden when TOC is open
- Visible on all viewports (useful on mobile, unobtrusive on desktop)

## Component Structure
- New `TableOfContents.tsx` component
- State (`tocOpen`) lives in `DayFeedPanel.tsx`
- Keyboard listener in `DayFeedPanel` (or `DailyView`) toggles state
- Sections get `id` attributes for `scrollIntoView` targeting

## Entries
- Unsorted section (if it has tweets) + all topic folders for the current day
- Each entry shows name + tweet count
- Topics show their color dot
