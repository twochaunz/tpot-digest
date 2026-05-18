# Dynamic Topic Link Previews Design

## Goal

Shared topic links such as `https://abridged.tech/app/20260517/2` should produce topic-specific social previews. The preview should lead with the topic's OG tweet: use the OG tweet's first image when it has media, and generate a branded text image when it does not.

## Architecture

FastAPI will own crawler-facing preview metadata for canonical topic share URLs. Caddy will route `/app/YYYYMMDD/N` requests to FastAPI only when the `User-Agent` matches a known social preview crawler, and FastAPI will return a small HTML document containing Open Graph and Twitter card tags.

The React app remains responsible for the actual human dashboard experience. Normal browser requests for the same URL continue to the existing frontend catch-all, so the current dashboard route behavior does not change.

## URL Resolution

The backend resolves `/app/{date_slug}/{topic_num}` by:

1. Parsing `YYYYMMDD` or `YYYY-MM-DD` into a date.
2. Loading that day's topics in the same order used by share links, currently `sortTopics`: non-`kek` topics first, then tweet count descending, then earliest assigned tweet saved time ascending, with `kek` topics last.
3. Selecting the one-indexed `topic_num`.
4. Loading the topic's `og_tweet_id`.

If any step fails, the route still returns valid metadata using the existing static `https://abridged.tech/og-image.png` fallback.

## Metadata Rules

Title is the topic title when available, otherwise `abridged tech`.

Description is the OG tweet text when available. If the tweet text is missing, use the OG tweet Grok context. If neither exists, use `daily curated tech discourse`.

Image selection follows the approved option A:

1. If the OG tweet has media, use the first image-like media URL as `og:image`.
2. If the OG tweet is text-only, use a generated image endpoint for that topic.
3. If the topic or OG tweet cannot be resolved, use the existing static OG image.

The generated image endpoint returns a 1200x630 PNG rendered with Pillow. It contains the date, author handle, topic title, and clipped OG tweet text on a branded dark card.

## Error Handling

Malformed dates, out-of-range topic numbers, missing OG tweets, missing media, and database misses should not return 500s. They should return generic preview metadata. If a valid topic and OG tweet exist but the OG tweet has no image media, they should return a generated text card.

The generated image endpoint renders user-controlled text into a bitmap rather than returning it as markup.

## Testing

Backend tests cover:

- topic metadata uses the OG tweet's first media image when media exists
- text-only OG tweets use the generated topic image endpoint
- invalid topic links fall back to static metadata
- generated PNG fallback returns a PNG image content type

Existing backend tests and frontend TypeScript checks should still pass after implementation.
