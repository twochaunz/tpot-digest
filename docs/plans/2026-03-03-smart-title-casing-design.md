# Smart Title Casing via OpenRouter (Qwen)

## Problem

The current `title_case()` function in `backend/app/routers/topics.py` uses Python's `.capitalize()` which lowercases everything after the first letter. "OpenAI GPT-4o" becomes "Openai Gpt-4o". Proper nouns, acronyms, and brand names get mangled.

## Solution

Replace the dumb `title_case()` with an LLM call via OpenRouter (Qwen) that uses the day's tweet context to correctly identify and preserve proper nouns, acronyms, and brand names.

## Flow

1. User types topic title (e.g. "arc browser drama")
2. `POST /api/topics` fires
3. Backend grabs unsorted tweets for that day (already in DB)
4. Sends to OpenRouter Qwen:
   - System prompt: minimal title formatting instruction
   - User message: raw title + sample of tweet texts from that day (~5 tweets, ~200 chars each)
5. LLM sees tweets mentioning "Arc", "The Browser Company" etc. -> returns "Arc Browser Drama"
6. Fallback to current dumb `title_case()` on any failure or timeout

## Details

- **Model:** `qwen/qwen3-8b` on OpenRouter
- **Fallback:** If API call fails or times out (500ms), fall back to current `title_case()`
- **Config:** New env var `OPENROUTER_API_KEY`
- **Where:** Only on topic creation (`POST /api/topics`), not on rename
- **"kek" rule:** Preserved -- skip LLM entirely for "kek"
- **Token budget:** ~40 (system) + ~10 (title) + ~500 (tweets) = ~550 input tokens per call
- **Context source:** Unsorted tweets for the topic's date, providing real mentions of proper nouns/brands/acronyms

## What Changes

- New: `backend/app/services/smart_title.py` -- OpenRouter call + fallback
- Edit: `backend/app/config.py` -- new `openrouter_api_key` setting
- Edit: `docker-compose.prod.yml` -- new `OPENROUTER_API_KEY` env var
- Edit: `backend/app/routers/topics.py` -- replace `title_case()` with `smart_title_case()`, pass db session
