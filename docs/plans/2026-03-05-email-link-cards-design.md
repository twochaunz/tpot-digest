# Email Link Preview Cards Design

## Problem

When tweets contain links to external sites (articles, GitHub repos, etc.), the email digest shows raw `t.co` shortened URLs in the tweet text. Readers shouldn't see Twitter's link shortener — links should appear as rich preview cards.

## Solution

Strip all t.co links from tweet text in the email and render rich link preview cards below the tweet text instead. The data already exists in `url_entities` (expanded URL, title, description, preview images) — it's just not being passed to the email template.

### Backend changes (`digest.py`)

1. **`_strip_all_tco_links(text, url_entities)`** — Replace `_strip_tco_links` (trailing-only) with a function that strips ALL t.co URLs from tweet text, using `url_entities` to identify them
2. **`_build_tweet_dict`** — Pass non-media `url_entities` as `link_cards` to the template dict
3. **Proxy link card images** — Run preview images through `_proxy_avatar_url` for email compatibility

### Template changes (`digest_email.html`)

Add link card rendering after tweet text in the `tweet_card` macro:
- Table-based layout (email client compatibility)
- Preview image (if available) on the left
- Title + description + display URL on the right
- Bordered card linking to `expanded_url`
- Filter out media links (`pic.x.com`, `pic.twitter.com`)
