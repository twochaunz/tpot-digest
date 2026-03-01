# Category Label Responsive Positioning

## Problem

Category labels use `marginLeft: -30` to shift left, but this is a fixed offset unrelated to label width. Longer labels overlap the tweet card content. The label's right edge should be consistently positioned relative to the tweet card's left edge, with a visible gap, regardless of label text length.

## Design

Two-mode responsive layout:

### Desktop (viewport ≥ 900px)

Labels sit to the **left** of tweet cards, right-aligned to the tweet card's left edge with an 8px gap.

**How it works:**
1. Add a centering wrapper (`maxWidth: 600, margin: '0 auto'`) inside the existing sticky label wrapper (`height: 0`)
2. Replace `marginLeft: -30` with `transform: translateX(calc(-100% - 8px)) translateY(4px)`
   - `-100%` moves the label left by its own width → right edge at tweet card left edge
   - `-8px` creates the gap
3. Label automatically tracks tweet card centering at any viewport width

### Mobile (viewport < 900px)

Labels sit **above** the tweet group as standard inline blocks.

- No centering wrapper or transform
- Label renders inline above the first tweet in each category group
- Standard flow layout

### Implementation

**Viewport detection:** JS-based `useMediaQuery` hook (or `useWindowWidth`) to toggle between desktop/mobile label modes. Needed because components use inline styles.

**Files to change:**
- `TopicSection.tsx` — CategoryNavLabel: conditional transform + centering wrapper
- New hook or utility for viewport width detection
- `DayFeedPanel.tsx` — may adjust left padding

**Key CSS values:**
- Desktop label transform: `translateX(calc(-100% - 8px)) translateY(4px)`
- Centering wrapper: `maxWidth: 600, margin: '0 auto', width: '100%'`
- Breakpoint: ~900px (tweet card 600px + space for labels on each side)
