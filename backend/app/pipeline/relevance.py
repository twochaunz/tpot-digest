"""
Content relevance classifier.

Classifies tweets as tech-relevant or noise using LLM with keyword fallback.
"""

import os

from app.pipeline.llm import llm_structured_output


# Tech-related keywords for fallback classification
_TECH_KEYWORDS = {
    "ai", "ml", "llm", "gpt", "claude", "gemini", "model", "benchmark",
    "api", "developer", "code", "coding", "programming", "software", "hardware",
    "startup", "vc", "funding", "series", "valuation", "acquisition",
    "open source", "github", "deployment", "infrastructure", "cloud",
    "neural", "transformer", "training", "fine-tune", "rlhf", "inference",
    "robot", "autonomous", "crypto", "blockchain", "web3",
    "apple", "google", "meta", "microsoft", "nvidia", "openai", "anthropic",
    "tesla", "amazon", "aws", "azure", "silicon", "chip", "gpu", "cpu",
    "launch", "release", "announce", "ship", "product", "feature",
    "security", "privacy", "regulation", "policy", "safety",
    "data", "database", "backend", "frontend", "fullstack", "devops",
    "react", "python", "rust", "typescript", "javascript",
}


async def classify_relevance(text: str, threshold: float = 0.5) -> dict:
    """
    Classify whether a tweet is tech-relevant.

    Returns:
    {
        "is_relevant": bool,
        "confidence": float (0.0-1.0),
        "method": "llm" | "keyword",
        "category": str | None (e.g., "AI/ML", "startups", "dev tools")
    }
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")

    if api_key:
        return await _classify_with_llm(text, threshold)
    else:
        return _classify_with_keywords(text, threshold)


async def _classify_with_llm(text: str, threshold: float) -> dict:
    """Use LLM for relevance classification."""
    system_prompt = """You are a tech content classifier. Classify whether a tweet is about technology, AI, startups, software development, or adjacent topics.

Return a JSON object with:
- "is_relevant": true/false
- "confidence": 0.0-1.0
- "category": one of "AI/ML", "Startups/VC", "Dev Tools", "Hardware", "Crypto/Web3", "Security", "General Tech", or null if not relevant

Only return JSON, no explanation."""

    user_prompt = f"""Classify this tweet:

"{text}"

Return JSON:
{{"is_relevant": true, "confidence": 0.9, "category": "AI/ML"}}"""

    try:
        result = await llm_structured_output(system_prompt, user_prompt)
        if isinstance(result, dict):
            return {
                "is_relevant": result.get("is_relevant", False),
                "confidence": result.get("confidence", 0.0),
                "method": "llm",
                "category": result.get("category"),
            }
    except Exception:
        pass

    # Fallback to keywords if LLM fails
    return _classify_with_keywords(text, threshold)


def _classify_with_keywords(text: str, threshold: float) -> dict:
    """
    Fallback keyword-based relevance classification.
    Counts tech keyword matches and computes a confidence score.
    """
    if not text:
        return {"is_relevant": False, "confidence": 0.0, "method": "keyword", "category": None}

    text_lower = text.lower()
    words = set(text_lower.split())

    # Count keyword matches (both single words and multi-word phrases).
    # For single-word keywords, also check if any token starts with the keyword
    # to handle plurals and hyphenated variants (e.g. "benchmarks", "gpt-5").
    matches = set()
    for keyword in _TECH_KEYWORDS:
        if " " in keyword:
            if keyword in text_lower:
                matches.add(keyword)
        else:
            # Exact word match or token starts with keyword (covers plurals/variants)
            if keyword in words or any(w.startswith(keyword) for w in words):
                matches.add(keyword)

    # Compute confidence based on match density
    # More matches = higher confidence, normalize by text length
    word_count = max(len(words), 1)
    match_ratio = len(matches) / min(word_count, 20)  # Cap denominator at 20
    confidence = min(match_ratio * 2.0, 1.0)  # Scale up, cap at 1.0

    # Determine category from matches
    category = None
    ai_terms = {"ai", "ml", "llm", "gpt", "claude", "gemini", "model", "benchmark", "neural", "transformer", "training", "inference", "rlhf"}
    startup_terms = {"startup", "vc", "funding", "series", "valuation", "acquisition"}
    dev_terms = {"code", "coding", "programming", "developer", "github", "react", "python", "rust", "typescript", "javascript", "api"}
    hardware_terms = {"gpu", "cpu", "chip", "silicon", "hardware", "nvidia"}
    crypto_terms = {"crypto", "blockchain", "web3"}

    if matches & ai_terms:
        category = "AI/ML"
    elif matches & startup_terms:
        category = "Startups/VC"
    elif matches & dev_terms:
        category = "Dev Tools"
    elif matches & hardware_terms:
        category = "Hardware"
    elif matches & crypto_terms:
        category = "Crypto/Web3"
    elif matches:
        category = "General Tech"

    return {
        "is_relevant": confidence >= threshold,
        "confidence": round(confidence, 3),
        "method": "keyword",
        "category": category,
    }
