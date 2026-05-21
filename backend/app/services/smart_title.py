"""Smart title casing via xAI Grok with tweet context."""

import logging
import re

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_XAI_URL = "https://api.x.ai/v1/chat/completions"
_MODEL = "grok-4-fast-non-reasoning"

_SYSTEM_PROMPT = """You are a title formatter for a tech news digest. Given a topic title and some tweet context, return the title with correct casing.

Rules:
- Preserve proper nouns, brand names, and acronyms exactly as they appear in tech (e.g. OpenAI, GPT-4o, iOS, GitHub, xAI, LLaMA, DeepSeek)
- Use AP-style title case: capitalize major words, lowercase articles/prepositions (a, an, the, of, in, to, for, etc.) unless first/last word
- Use the tweet context to identify the correct casing for ambiguous terms
- Return ONLY the formatted title, nothing else
- Do not add quotes or punctuation that wasn't in the original"""


async def smart_title_case(raw_title: str, tweet_texts: list[str]) -> str:
    """Title-case using LLM with tweet context. Falls back to dumb title_case on failure."""
    if raw_title.lower() == "kek":
        return "kek"

    if not settings.xai_api_key:
        logger.warning("XAI_API_KEY not set -- falling back to dumb title case")
        return _fallback_title_case(raw_title)

    # Build context from tweets (truncate each to ~200 chars, max 5 tweets)
    context_lines = []
    for text in tweet_texts[:5]:
        truncated = text[:200] + ("..." if len(text) > 200 else "")
        context_lines.append(f"- {truncated}")
    context = "\n".join(context_lines) if context_lines else "(no tweets for context)"

    user_msg = f"Title: {raw_title}\n\nTweet context:\n{context}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                _XAI_URL,
                headers={
                    "Authorization": f"Bearer {settings.xai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _MODEL,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    "max_tokens": 100,
                    "temperature": 0,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            result = data["choices"][0]["message"]["content"].strip()
            # Strip thinking tags if model returns them
            if "<think>" in result:
                import re
                result = re.sub(r"<think>.*?</think>", "", result, flags=re.DOTALL).strip()
            # Sanity check: result should be roughly the same length as input
            if result and len(result) < len(raw_title) * 3:
                formatted = _fallback_title_case(result)
                logger.info("Smart title: %r -> %r", raw_title, formatted)
                return formatted
            else:
                logger.warning("Smart title returned unexpected result: %r", result)
                return _fallback_title_case(raw_title)
    except Exception:
        logger.exception("Smart title case failed, falling back")
        return _fallback_title_case(raw_title)


# ── Fallback: dumb AP-style title case ──────────────────────────────

_SMALL_WORDS = {
    'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
    'at', 'by', 'in', 'of', 'on', 'to', 'up', 'as', 'is', 'if', 'it',
    'vs', 'via', 'from', 'with', 'into', 'over',
}

_KNOWN_CASINGS = {
    'ai': 'AI',
    'amd': 'AMD',
    'api': 'API',
    'ar': 'AR',
    'arm': 'ARM',
    'aws': 'AWS',
    'chatgpt': 'ChatGPT',
    'ceo': 'CEO',
    'cpu': 'CPU',
    'css': 'CSS',
    'cto': 'CTO',
    'gpu': 'GPU',
    'gpt': 'GPT',
    'gpt-4': 'GPT-4',
    'gpt-4o': 'GPT-4o',
    'gpt-5': 'GPT-5',
    'github': 'GitHub',
    'huggingface': 'HuggingFace',
    'html': 'HTML',
    'ibm': 'IBM',
    'ios': 'iOS',
    'ipad': 'iPad',
    'iphone': 'iPhone',
    'imessage': 'iMessage',
    'javascript': 'JavaScript',
    'llama': 'LLaMA',
    'ml': 'ML',
    'node.js': 'Node.js',
    'nvidia': 'NVIDIA',
    'nyc': 'NYC',
    'openai': 'OpenAI',
    'pdf': 'PDF',
    'sendcutsend': 'SendCutSend',
    'sdk': 'SDK',
    'seo': 'SEO',
    'tiktok': 'TikTok',
    'typescript': 'TypeScript',
    'ui': 'UI',
    'url': 'URL',
    'vc': 'VC',
    'vr': 'VR',
    'xai': 'xAI',
    'youtube': 'YouTube',
}


def _has_intentional_casing(word: str) -> bool:
    letters = [c for c in word if c.isalpha()]
    if len(letters) <= 1:
        return False
    return word.isupper() or any(c.isupper() for c in word[1:])


def _apply_known_or_preserved_casing(core: str) -> str | None:
    possessive = ''
    base = core
    lower = core.lower()
    if lower.endswith("'s") or lower.endswith("’s"):
        possessive = core[-2:]
        base = core[:-2]
        lower = base.lower()

    if lower in _KNOWN_CASINGS:
        return _KNOWN_CASINGS[lower] + possessive
    if _has_intentional_casing(base):
        return base + possessive
    return None


def _title_core(core: str) -> str:
    preserved = _apply_known_or_preserved_casing(core)
    if preserved is not None:
        return preserved

    if '-' in core:
        return '-'.join(_title_core(part) if part else part for part in core.split('-'))

    return core[:1].upper() + core[1:].lower()


def _format_title_word(word: str, force_title: bool) -> str:
    match = re.match(r"^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$", word)
    if not match:
        return word

    leading, core, trailing = match.groups()
    if not core:
        return word

    preserved = _apply_known_or_preserved_casing(core)
    if preserved is not None:
        return leading + preserved + trailing

    if not force_title:
        return leading + core.lower() + trailing

    return leading + _title_core(core) + trailing


def _fallback_title_case(text: str) -> str:
    """AP-style title case. 'kek' always stays lowercase."""
    if text.lower() == 'kek':
        return 'kek'
    words = text.split()
    result = []
    for i, word in enumerate(words):
        if word.lower() == 'kek':
            result.append('kek')
        else:
            force_title = i == 0 or i == len(words) - 1 or word.lower().strip(".,:;!?()[]{}\"'") not in _SMALL_WORDS
            result.append(_format_title_word(word, force_title))
    return ' '.join(result)
