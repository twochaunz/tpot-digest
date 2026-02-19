# Tech Twitter Daily Digest — Design Document

**Date:** 2026-02-19
**Status:** Approved

## Overview

A feed ingestion, topic clustering, and asset organization tool for daily tech video production. The app scrapes Twitter/X feeds, identifies trending topics in tech, clusters discourse into sub-topics, captures clean tweet screenshots, and organizes everything into a browsable archive with annotation tools — all to streamline the workflow of producing daily tech discourse videos.

## Stack

- **Backend:** Python + FastAPI
- **Frontend:** React
- **Database:** PostgreSQL (with pgvector extension for semantic similarity)
- **Browser Automation:** Playwright
- **Deployment:** Docker Compose on a VPS (e.g. DigitalOcean, Hetzner)
- **Architecture:** Monolithic worker + dashboard (single Python backend service + React frontend)

## Data Model

### Core Entities

- **Account** — A tracked Twitter handle. Fields: `handle`, `display_name`, `pfp_url`, `source` (seed / auto-discovered), `priority` (1-3), `added_at`, `is_active`
- **Tweet** — A scraped tweet. Fields: `tweet_id`, `account_id`, `text`, `media_urls`, `posted_at`, `scraped_at`, `engagement` (JSON: likes/retweets/replies at scrape time), `engagement_velocity` (calculated delta between scrapes)
- **Topic** — A top-level trending subject for a given day. Fields: `date`, `title`, `summary`, `rank`, `lifecycle_status` (emerging/trending/peaked/fading), `sentiment`
- **SubTopic** — A distinct narrative thread within a topic. Fields: `topic_id`, `title`, `summary`, `sentiment` (positive/negative/neutral/mixed), `rank` (within the topic)
- **SubTopicTweet** — Join table linking tweets to sub-topics. Fields: `subtopic_id`, `tweet_id`, `relevance_score`, `stance`
- **Screenshot** — A captured PNG. Fields: `tweet_id`, `file_path`, `width`, `height`, `captured_at`, `crop_mode`
- **Article** — An extracted article referenced by a tweet. Fields: `url`, `archive_url`, `title`, `author`, `publication`, `full_text`, `summary`, `extracted_at`
- **TopicEdge** — Knowledge graph relationship between topics. Fields: `source_topic_id`, `target_topic_id`, `relationship_type` (related/contradicts/continues/caused_by), `strength`, `created_at`

### Filesystem Structure

```
data/
  YYYYMMDD/
    01-topic-name/
      metadata.json                          # topic summary, sub-topic list
      01-sub-topic-name/
        tweets/
          tweet_123456.png                   # original clean capture
          tweet_123456_annotated.png         # highlighted version
        articles/
          techcrunch-article-slug/
            full_text.md
            screenshot_section_1.png
            screenshot_section_1_annotated.png
            metadata.json                    # title, author, source URL, archive URL, summary
        metadata.json                        # sub-topic summary, key quotes, ranked tweets
      02-sub-topic-name/
        ...
    02-topic-name/
      ...
```

Numbered prefixes (01-, 02-) preserve ranking order when browsing in Finder.

## Feed Ingestion Engine

### Feed-First Approach

The primary data source is the user's **For You** and **Following** feeds — not individual account timelines. Playwright loads the feeds using a persistent authenticated browser session, scrolls like a human, and captures everything it sees.

Each scrape produces a **feed snapshot** — a timestamped batch of tweets observed during that scroll session.

### What Gets Captured

- Tweets from people you don't follow (surfaced by the algorithm)
- Retweets/reposts from your network (signaling what they find interesting)
- Quote tweets (commentary layer)
- The natural mix of content Twitter is pushing

### Schedule

Configurable scrape intervals (e.g. every 2 hours during waking hours). Each scrape updates the topic landscape — topics are dynamic and re-ranked as new signal comes in.

### Manual URL Input

Dashboard includes a simple input field to paste a tweet URL. The backend immediately scrapes it, screenshots it, and suggests a topic/sub-topic assignment (or the user assigns manually).

### Login/Auth

Playwright uses a persistent browser context with logged-in X session cookies. User logs in once manually. Dashboard alerts when re-authentication is needed.

## Feed Quality Filtering

Every tweet from the For You feed runs through a quality pipeline before influencing topic detection.

### Automated Filters

- **Network proximity check** — Does this person share mutual follows with the seed list? How many? More mutual follows = higher weight
- **Account profile scoring** — Follower count, account age, bio keywords (tech/AI/startup indicators). Used as a weight, not a hard cutoff
- **Content relevance classifier** — Lightweight LLM pass: "Is this tweet about tech, AI, startups, or adjacent topics?" Binary gate to kill noise (feel-good articles, self-improvement, unrelated controversy)
- **Slop detection** — Track posting frequency per account. High-volume posters get diluted individual tweet weight
- **Diversity cap** — No single account can represent more than ~20% of tweets within any topic. Prevents one voice from dominating

### Manual Controls (Dashboard Settings)

- **Blocklist** — Permanently filter out specific accounts
- **Boost list** — Accounts whose tweets always pass quality gates
- **Relevance threshold slider** — Adjust noise filtering aggressiveness
- **Per-account frequency cap** — Override default diversity cap for specific accounts

All filters are tunable over time. Defaults are opinionated but every gate has a manual override.

## Topic Detection (Hybrid)

Three signals combined to identify and rank topics:

1. **Engagement velocity** — Tweets gaining likes/retweets/replies unusually fast relative to baseline. Tracked across scrapes to measure acceleration.
2. **Network convergence** — Multiple accounts in the curated network discussing the same thing within a short window. Consensus = signal.
3. **AI-assisted clustering** — LLM reads all ingested tweets, clusters by topic, then within each topic identifies distinct sub-topics (narrative threads).

### Two-Pass Clustering

1. **Pass 1: Topics** — Group tweets into top-level topics (e.g. "Claude 4 Launch")
2. **Pass 2: Sub-Topics** — Within each topic, identify distinct narrative threads (e.g. "Hype & excitement", "Benchmark analysis", "Benchmark manipulation accusations")

### Topic Lifecycle

Topics evolve throughout the day:

```
EMERGING  -->  TRENDING  -->  PEAKED  -->  FADING
   ^               |
   '-- can re-surge next day --'
```

- **EMERGING** — 2-3 tweets clustered on the same theme. Flagged but early
- **TRENDING** — Multiple feed snapshots confirm growth. More accounts engaging, engagement accelerating
- **PEAKED** — Engagement velocity flattening or declining
- **FADING** — Activity dropping off. Can re-surge if new discourse appears the next day

### Engagement Refresh

On each scrape, previously captured tweets for active topics get their engagement numbers updated. This feeds momentum tracking and topic ranking.

### Cross-Day Topic Bridging

Topics in EMERGING or early TRENDING at end of day carry forward. If the next day's scrapes show them exploding, they surface as top topics for that day. Historical tweets from prior days are linked for the full arc.

## Curated Network

### Seed List

Initial list of high-signal accounts provided by the user. These act as **signal amplifiers** — their engagement (comments, retweets, quote tweets) with any tweet boosts that tweet's weight in clustering.

### Auto-Expansion

The system discovers new high-signal accounts based on who seed accounts engage with most. Suggestions surface in the dashboard for the user to approve or reject.

### Manual Management

Add or remove accounts at any time through the dashboard. Tag by topic area, set priority levels.

## Screenshot Engine

### Tweet Screenshots

- Load individual tweet URL in Playwright
- Wait for full render (images loaded, no spinners)
- Crop to: PFP + handle + tweet text + media (if present)
- CSS injection to hide engagement metrics bar and reply thread
- Capture at 2x device pixel ratio for crisp video overlays
- Save as high-res PNG

### Article Screenshots

- Same capture mechanism applied to article sections
- User selects specific sections to screenshot from the embedded article viewer

## Annotation Toolkit

Canvas-based editor (Konva.js or Fabric.js) that opens when clicking any tweet or article screenshot.

### Tools

- **Text highlight** — Colored overlay on selected text (marker pen effect). Configurable color + opacity
- **Box/rectangle** — Draw rectangles to call attention to areas. Optional dim on everything outside the box
- **Freehand draw** — Free drawing for underlines, circles, arrows
- **Color picker** — Preset colors + custom
- **Undo/redo** — Standard history

### Output

- Saves both the **original** untouched screenshot and the **annotated** version as a separate PNG
- Annotations also saved as **non-destructive JSON** (coordinates, colors, shapes) for re-editing later
- All processing happens client-side in the browser

## Article Extraction & Embedding

### Auto-Detection

When a tweet contains a URL to an article, the system automatically:

1. Detects the URL from tweet content or card preview
2. Attempts direct fetch of the article
3. Falls back to Archive.ph for paywalled content
4. Extracts full text, images, author, publication date

### Article Viewer

Split view in the dashboard:
- **Left:** Tweet screenshot that referenced the article
- **Right:** Embedded clean reading view (no ads, no popups)

### Article Tools

- **Segment extraction** — Select specific paragraphs, quotes, or data points. Saved as discrete assets tied to the sub-topic
- **Article screenshot** — Capture any section as high-res PNG
- **Full annotation toolkit** — Same highlight/box/freehand tools
- **Auto-summary** — AI-generated summary of key points, stored in sub-topic metadata

### Storage

Articles live alongside tweets within the same sub-topic folder structure.

## Persistent Topic Knowledge Graph

### Structure

- **Nodes** = Topics (each day's topics become nodes in the graph)
- **Edges** = Relationships between topics

### Edge Formation

- **Semantic similarity** — AI embedding comparison (via pgvector) between topic summaries. Semantically similar topics across different days get linked
- **Entity overlap** — Same companies, people, or products appearing across topics
- **Narrative continuation** — When a Day 1 topic spawns follow-up discourse on Day 3, the system detects and links them
- **Manual linking** — User can connect any two topics in the dashboard

### Node Metadata

- Date(s) active (can span multiple days)
- Peak engagement day
- Sentiment arc (how sentiment evolved over time)
- Key accounts involved
- Sub-topics within it
- Tags (launch, controversy, funding, policy, meme, etc.)

### Capabilities

- **Entity search** — "Show me everything related to Anthropic in the last 30 days"
- **Narrative tracing** — Follow the chain of connected nodes across weeks
- **Pattern detection** — Recurring cycles become visible (e.g. model launch → benchmark debate → skepticism)
- **Script research** — Pull up a topic's full history and related narratives for video context

## Dashboard Views

### 1. Today's Feed (Landing Page)

Current day's topics ranked by momentum. Each expandable to see sub-topics and tweets. Topics show lifecycle status (EMERGING / TRENDING / PEAKED / FADING). Live-updating as new scrapes come in.

### 2. Topic Detail

- All sub-topics with their tweet clusters
- Click any tweet screenshot to open annotation editor
- Topic's position in the knowledge graph (connected historical topics)
- Sentiment breakdown across sub-topics
- Referenced articles with embedded viewer

### 3. Graph Explorer

Visual map of the topic knowledge graph. Filter by date range, tags, entities, sentiment. Click any node to jump to topic detail.

### 4. Asset Manager

Browse the data/YYYYMMDD/ folder structure. Drag-select screenshots for a video. Bulk download as zip. Shows original and annotated versions side by side.

### 5. Settings

- Manage seed accounts (add/remove/tag/prioritize)
- Review auto-discovered account suggestions (approve/reject)
- Tune quality filters (blocklist, boost list, thresholds, frequency caps)
- Scrape schedule configuration
- Manual tweet URL input

## Viral Content Detection

External viral content (outside curated network) only gets surfaced when accounts in the curated network engage with it — retweets, quote tweets, replies, likes. This keeps signal tight and prevents the system from just mirroring Twitter's own trending algorithm.
