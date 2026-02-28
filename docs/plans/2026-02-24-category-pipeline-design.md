# Category Pipeline + Context Menu — Design

## Goal
Replace dynamic categories table with hardcoded universal categories. Fix the broken pipeline so category data flows end-to-end. Add "Set Category" submenu to tweet right-click context menu.

## Hardcoded Categories

| Key | Label | Color |
|-----|-------|-------|
| `og-post` | OG Post | `#F59E0B` |
| `context` | Context | `#60A5FA` |
| `hot-take` | Hot Take | `#F87171` |
| `signal-boost` | Signal Boost | `#34D399` |
| `kek` | Kek | `#C084FC` |
| `pushback` | Pushback | `#FB923C` |

## Data Migration

1. Add `category` VARCHAR column to `tweet_assignments`
2. Copy: `UPDATE tweet_assignments SET category = (SELECT name FROM categories WHERE id = category_id)`
3. Drop `category_id` FK column
4. Drop `categories` table
5. Legacy labels ("commentary", "reaction", "callout") preserved as strings, shown with default gray color

## Backend Changes

- New alembic migration for the schema change
- Remove `backend/app/models/category.py`
- Remove `backend/app/routers/categories.py`
- Remove `backend/app/schemas/category.py`
- Update `TweetAssignment` model: `category_id` → `category` (string, nullable)
- Update `TweetOut` schema: add `category: str | None`
- Update `list_tweets()`: when `topic_id` is set, join with `TweetAssignment` to return `category`
- Update `assign_tweets()`: accept `category: str | None` instead of `category_id`
- Update `TweetAssignRequest`: `category_id` → `category: str | None`

## Frontend Changes

- New `constants/categories.ts` with hardcoded list (key, label, color)
- Remove `api/categories.ts` (useCategories, useCreateCategory, useDeleteCategory)
- Remove `CategoryManager` component and its Settings page section
- Add `category?: string` to `Tweet` interface
- Update `useAssignTweets`: send `category` string instead of `category_id`
- Fix `TopicSectionWithData`: group tweets by `category` string using the hardcoded list for colors/labels
- Update `ContextMenu`: add "Set Category" item with submenu listing hardcoded categories + "Remove Category"
- ContextMenu needs `onSetCategory(tweetId, topicId, category)` callback

## Context Menu UX

Right-click tweet in topic → "Set Category ▸" → submenu with:
- Each hardcoded category (color dot + label)
- Divider
- "Remove Category" (if tweet has one)

Selecting a category calls assign endpoint with the category string.
