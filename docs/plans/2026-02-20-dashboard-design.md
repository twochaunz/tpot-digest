# Dashboard UI Design — Chrome Extension Era

**Date:** 2026-02-20
**Aesthetic:** Dark Editorial Desk
**Reference:** `docs/design-reference/dashboard-preview.html`

## Aesthetic Direction

**Concept:** A newsroom command center meets design tool. The user is a tech content creator who curates discourse daily — the dashboard should feel like a professional creative workspace, not a generic admin panel.

**Tone:** Dark editorial. Warm, not cold. Intentional density with breathing room. Typography-forward. Every pixel earns its place.

**Memorable element:** The contrast between editorial serif headlines (topic names feel like newspaper headlines) and the dense, functional UI around them. Topics feel like stories being assembled, not database rows.

## Design System

### Colors

```css
:root {
  /* Surfaces */
  --bg-base: #0C0B0A;           /* Near-black, warm undertone */
  --bg-raised: #161514;          /* Card surfaces */
  --bg-elevated: #1E1D1B;        /* Modals, popovers */
  --bg-hover: #252320;           /* Hover states */
  --bg-active: #2E2B28;          /* Active/pressed states */

  /* Borders */
  --border-subtle: #2A2725;      /* Default borders */
  --border-strong: #3D3935;      /* Emphasized borders */

  /* Text */
  --text-primary: #E8E4DF;       /* Headings, primary content */
  --text-secondary: #9B9590;     /* Labels, descriptions */
  --text-tertiary: #6B6560;      /* Placeholders, disabled */
  --text-inverse: #0C0B0A;       /* Text on bright backgrounds */

  /* Accent — Warm Amber (desk lamp light) */
  --accent: #E8A838;
  --accent-hover: #F0B84A;
  --accent-muted: rgba(232, 168, 56, 0.15);

  /* Lifecycle Status Colors */
  --emerging: #4ECDC4;           /* Teal — fresh, new */
  --trending: #E8A838;           /* Amber — hot, active */
  --peaked: #E85D3A;             /* Burnt orange — maximum heat */
  --fading: #6B6560;             /* Muted gray — cooling off */

  /* Semantic */
  --success: #5CB85C;
  --warning: #E8A838;
  --error: #D9534F;
  --info: #5BC0DE;

  /* Spacing Scale (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.5);
}
```

### Typography

```css
/* Display — Editorial serif for topic titles and headings */
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,700;1,9..144,400&display=swap');

/* UI — Clean geometric sans for interface elements */
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');

/* Mono — For tweet IDs, counts, code */
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --font-display: 'Fraunces', Georgia, serif;
  --font-body: 'Outfit', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Type Scale */
  --text-xs: 0.75rem;    /* 12px — metadata, timestamps */
  --text-sm: 0.8125rem;  /* 13px — secondary labels */
  --text-base: 0.875rem; /* 14px — body text */
  --text-lg: 1rem;       /* 16px — emphasized body */
  --text-xl: 1.25rem;    /* 20px — section headers */
  --text-2xl: 1.5rem;    /* 24px — page headers */
  --text-3xl: 2rem;      /* 32px — topic titles */
  --text-4xl: 2.5rem;    /* 40px — hero numbers */
}
```

### Motion

```css
:root {
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
}

/* Staggered entrance for cards */
@keyframes fadeSlideUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Topic card entrance — each card delays by index */
.topic-card {
  animation: fadeSlideUp var(--duration-slow) var(--ease-out) both;
}
.topic-card:nth-child(1) { animation-delay: 0ms; }
.topic-card:nth-child(2) { animation-delay: 60ms; }
.topic-card:nth-child(3) { animation-delay: 120ms; }
/* etc. */
```

## Layout

### App Shell

```
┌──────────────────────────────────────────────────────┐
│ ┌──────┐ ┌──────────────────────────────────────────┐│
│ │      │ │  Header: page title + date picker +      ││
│ │ Side │ │  extension status indicator               ││
│ │  bar │ ├──────────────────────────────────────────┤│
│ │      │ │                                          ││
│ │ Nav  │ │  Main Content Area                       ││
│ │      │ │                                          ││
│ │      │ │  (scrollable, page-specific)             ││
│ │      │ │                                          ││
│ │      │ │                                          ││
│ │      │ │                                          ││
│ └──────┘ └──────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

- **Sidebar:** 56px wide (icons only), expands to 200px on hover
- **Header:** Fixed top, 56px height, contains page title + global controls
- **Content:** Fills remaining space, scrollable

### Sidebar Navigation

```
┌────────┐
│  logo  │  ← tpot icon (small, amber)
├────────┤
│  📰   │  ← Today's Feed (landing)
│  📊   │  ← Topics (detail views)
│  🔗   │  ← Graph Explorer
│  📁   │  ← Asset Manager
├────────┤
│  ⚙️   │  ← Settings (bottom)
└────────┘
```

Icons only by default. Hover reveals labels sliding in from the left.

## Key Views

### 1. Today's Feed (Landing Page)

**Purpose:** Show today's curated tweets clustered into topics. This is the "war room" view.

**Layout:**

```
┌─ Header ──────────────────────────────────────────────┐
│  Today's Feed          ◄ Feb 19 ►     🟢 Extension    │
│                                        23 saved today  │
├───────────────────────────────────────────────────────┤
│                                                       │
│  ┌─ Topic Card ────────────────────────────────────┐  │
│  │ TRENDING                                         │  │
│  │ Claude 4 Launch Shakes the AI Landscape    12▲   │  │
│  │ 3 sub-topics · 18 tweets · 4 articles            │  │
│  │                                                   │  │
│  │  ┌─ SubTopic ─────────────────────────────────┐  │  │
│  │  │ Benchmark Hype                    positive  │  │  │
│  │  │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │  │  │
│  │  │ │tweet │ │tweet │ │tweet │ │tweet │  +3    │  │  │
│  │  │ │thumb │ │thumb │ │thumb │ │thumb │        │  │  │
│  │  │ └──────┘ └──────┘ └──────┘ └──────┘        │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  │  ┌─ SubTopic ─────────────────────────────────┐  │  │
│  │  │ Benchmark Skepticism              negative  │  │  │
│  │  │ ┌──────┐ ┌──────┐                          │  │  │
│  │  │ │tweet │ │tweet │                    +1     │  │  │
│  │  │ │thumb │ │thumb │                          │  │  │
│  │  │ └──────┘ └──────┘                          │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─ Topic Card ────────────────────────────────────┐  │
│  │ EMERGING                                         │  │
│  │ OpenAI Series C at $300B                   3▲    │  │
│  │ ...                                              │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─ Unclustered Tweets ────────────────────────────┐  │
│  │ 5 tweets awaiting clustering                     │  │
│  │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │  │
│  │ │tweet │ │tweet │ │tweet │ │tweet │ │tweet │   │  │
│  │ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │  │
│  │                        [Re-cluster Now]          │  │
│  └──────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

**New elements for extension era:**
- **Extension status indicator** (top right): green dot + "23 saved today" — shows extension is connected and working
- **Unclustered tweets section** (bottom): tweets received from extension that haven't been clustered yet, with a "Re-cluster Now" button
- **Topic momentum arrow** (▲/▼): shows tweet velocity since last cluster

**Topic Card design:**
- Serif headline (Fraunces) for topic title — feels like a newspaper headline
- Lifecycle badge: colored pill (teal/amber/orange/gray) with status text
- Sub-topic panels collapse/expand
- Tweet thumbnails are small screenshot previews (80x80px) in a horizontal strip
- Click thumbnail → opens Topic Detail view

### 2. Topic Detail

**Purpose:** Deep dive into a single topic. All subtopics with their tweet clusters, articles, sentiment breakdown.

```
┌─ Header ──────────────────────────────────────────────┐
│  ← Back   Claude 4 Launch Shakes the AI Landscape     │
│           TRENDING · Feb 19 · 18 tweets · 4 articles  │
├───────────────────────────────────────────────────────┤
│                                                       │
│  ┌─ SubTopic Panel ──────────────────────────────┐    │
│  │ 01  Benchmark Hype                  😊 positive│    │
│  │     "Community celebrates Claude 4's..."       │    │
│  │                                                │    │
│  │  ┌────────────────┐  ┌────────────────┐       │    │
│  │  │                │  │                │       │    │
│  │  │  Tweet Card    │  │  Tweet Card    │       │    │
│  │  │  @karpathy     │  │  @sama         │       │    │
│  │  │  screenshot    │  │  screenshot    │       │    │
│  │  │  preview       │  │  preview       │       │    │
│  │  │                │  │                │       │    │
│  │  │  ✏️ Annotate   │  │  ✏️ Annotate   │       │    │
│  │  └────────────────┘  └────────────────┘       │    │
│  │                                                │    │
│  │  📎 Articles:                                  │    │
│  │  ├── TechCrunch: "Claude 4 benchmarks..."     │    │
│  │  └── The Verge: "Anthropic launches..."       │    │
│  └────────────────────────────────────────────────┘    │
│                                                       │
│  ┌─ SubTopic Panel ──────────────────────────────┐    │
│  │ 02  Benchmark Skepticism            😠 negative│    │
│  │     ...                                        │    │
│  └────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────┘
```

**Tweet Card design:**
- Screenshot preview (actual captured PNG from extension)
- Author handle + display name
- Tweet text excerpt (2 lines max, truncated)
- "Annotate" button opens Konva editor overlay
- Hover: subtle scale-up (1.02) with shadow elevation

### 3. Extension Status Bar (new component)

Replaces the old scheduler status display. Shows in the header across all views.

```
Connected states:
  🟢 Extension connected · 23 saved today · Last: 2m ago

Disconnected states:
  🔴 Extension not detected · Install extension →

Processing states:
  🟡 Clustering 18 tweets... · ETA ~30s
```

### 4. Unclustered Queue (new component)

Shows tweets that arrived from the extension but haven't been assigned to topics yet.

- Horizontal scrollable strip of tweet thumbnails
- Each shows: small screenshot + author handle
- Drag to reorder priority
- "Re-cluster Now" button triggers clustering pipeline
- Auto-clusters when threshold reached (configurable)
- Fades out with staggered animation as tweets get assigned to topics

### 5. Asset Manager (enhanced for extension)

Now shows screenshots captured by the extension (not Playwright). Same browse/download functionality but source is different.

### 6. Settings (simplified for extension)

**Removed:**
- Scrape schedule configuration
- Session status / re-auth controls
- Scheduler trigger buttons

**Added:**
- Extension connection settings (backend URL shown for copy-paste into extension popup)
- Clustering settings:
  - Auto-cluster threshold (e.g., "cluster after every 10 new tweets")
  - Manual cluster button
- Extension install link / instructions

**Kept:**
- Account manager (seed list, boost, block)
- Quality filter controls (relevance threshold, even though user curates, still useful for topic ranking)
- Manual tweet URL input

## Component Design Details

### Lifecycle Badge

```
┌──────────┐
│ EMERGING │  ← teal bg, dark text, subtle pulse animation
└──────────┘

┌──────────┐
│ TRENDING │  ← amber bg, dark text, slight glow
└──────────┘

┌──────────┐
│  PEAKED  │  ← burnt orange bg, light text
└──────────┘

┌──────────┐
│  FADING  │  ← gray bg, gray text, reduced opacity
└──────────┘
```

Small pill shape. Font: Outfit 600 weight, all-caps, letter-spacing 0.05em, text-xs size.

### Sentiment Indicator

Inline with subtopic title. Small colored dot + text label:
- 😊 positive → green dot
- 😠 negative → red dot
- 😐 neutral → gray dot
- 🔀 mixed → amber dot

### Extension Save Counter

In header bar. Shows:
```
┌─────────────────────────────────┐
│ 🟢  23 saved · Last save 2m ago │
└─────────────────────────────────┘
```

Animates the count up when a new tweet is ingested (number bumps with a spring animation). Green dot pulses briefly on each new save.

## Responsive Behavior

- **≥1440px:** Sidebar + full content, tweet cards in 3-column grid
- **1024-1439px:** Collapsed sidebar (icons only) + content, 2-column grid
- **768-1023px:** No sidebar (hamburger menu), single column, stacked layout
- **<768px:** Not a priority (this is a desktop production tool), but gracefully degrades

## Interaction Patterns

- **Topic cards:** Click anywhere to expand subtopics inline. Click title to navigate to Topic Detail.
- **Tweet thumbnails:** Click to open full screenshot in a lightbox. Double-click to open annotation editor.
- **Annotation editor:** Full-screen overlay with Konva canvas. Dark semi-transparent backdrop. Tools in a floating toolbar on the left.
- **Article split view:** Full-screen modal. Tweet screenshot pinned on left (1/3 width), article content scrollable on right (2/3 width).
- **Re-cluster button:** Amber button with loading spinner. Disabled when no unclustered tweets exist.
