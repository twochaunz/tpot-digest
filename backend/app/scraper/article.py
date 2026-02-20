import re
from urllib.parse import urlparse
import httpx
from bs4 import BeautifulSoup


# Domains that are typically paywalled
PAYWALLED_DOMAINS = {
    "nytimes.com", "wsj.com", "ft.com", "bloomberg.com",
    "washingtonpost.com", "theathletic.com", "economist.com",
    "businessinsider.com", "wired.com", "thetimes.co.uk",
}

# Domains to skip (not articles)
SKIP_DOMAINS = {
    "x.com", "twitter.com", "t.co", "youtube.com", "youtu.be",
    "instagram.com", "facebook.com", "tiktok.com", "reddit.com",
    "github.com", "linkedin.com",
}


def is_article_url(url: str) -> bool:
    """Check if a URL is likely an article (not social media, not image, etc.)."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower().replace("www.", "")

        # Skip social media and non-article domains
        if any(skip in domain for skip in SKIP_DOMAINS):
            return False

        # Skip direct media links
        path = parsed.path.lower()
        if path.endswith(('.png', '.jpg', '.jpeg', '.gif', '.mp4', '.pdf')):
            return False

        return True
    except Exception:
        return False


def get_archive_url(url: str) -> str:
    """Generate an Archive.ph URL for a given article URL."""
    return f"https://archive.ph/newest/{url}"


async def fetch_article(url: str) -> dict:
    """
    Fetch and extract article content.

    1. Try direct fetch first
    2. If it looks paywalled, try Archive.ph
    3. Extract title, author, text content

    Returns: {
        "url": str,
        "archive_url": str | None,
        "title": str | None,
        "author": str | None,
        "publication": str | None,
        "full_text": str | None,
        "success": bool,
    }
    """
    parsed = urlparse(url)
    domain = parsed.netloc.lower().replace("www.", "")
    publication = domain.split(".")[0].title()

    result = {
        "url": url,
        "archive_url": None,
        "title": None,
        "author": None,
        "publication": publication,
        "full_text": None,
        "success": False,
    }

    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
        # Try direct fetch
        try:
            response = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            })

            if response.status_code == 200:
                content = extract_article_content(response.text)
                if content.get("full_text") and len(content["full_text"]) > 200:
                    result.update(content)
                    result["success"] = True
                    return result
        except Exception:
            pass

        # Try Archive.ph for paywalled or failed direct fetch
        is_paywalled = any(pw in domain for pw in PAYWALLED_DOMAINS)
        if is_paywalled or not result["success"]:
            try:
                archive_url = get_archive_url(url)
                response = await client.get(archive_url, headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                })
                if response.status_code == 200:
                    content = extract_article_content(response.text)
                    if content.get("full_text"):
                        result.update(content)
                        result["archive_url"] = archive_url
                        result["success"] = True
                        return result
            except Exception:
                pass

    return result


def extract_article_content(html: str) -> dict:
    """
    Extract article content from HTML using BeautifulSoup.

    Tries multiple common patterns for article content extraction.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Extract title
    title = None
    for selector in ["h1", "title", 'meta[property="og:title"]']:
        if selector.startswith("meta"):
            el = soup.select_one(selector)
            title = el.get("content") if el else None
        else:
            el = soup.select_one(selector)
            title = el.get_text(strip=True) if el else None
        if title:
            break

    # Extract author
    author = None
    for selector in [
        'meta[name="author"]',
        'meta[property="article:author"]',
        '[rel="author"]',
        '.author-name',
        '.byline',
    ]:
        el = soup.select_one(selector)
        if el:
            author = el.get("content") or el.get_text(strip=True)
            if author:
                break

    # Extract main content
    full_text = None

    # Try article tag first
    article = soup.select_one("article")
    if article:
        # Remove script, style, nav, aside elements
        for tag in article.select("script, style, nav, aside, footer, .ad, .advertisement"):
            tag.decompose()
        full_text = article.get_text(separator="\n", strip=True)

    # Fallback to common content containers
    if not full_text or len(full_text) < 200:
        for selector in [".article-body", ".post-content", ".entry-content", "main", "#content"]:
            content = soup.select_one(selector)
            if content:
                for tag in content.select("script, style, nav, aside"):
                    tag.decompose()
                text = content.get_text(separator="\n", strip=True)
                if text and len(text) > len(full_text or ""):
                    full_text = text

    # Last resort: get all paragraphs
    if not full_text or len(full_text) < 200:
        paragraphs = soup.select("p")
        if paragraphs:
            full_text = "\n".join(p.get_text(strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 30)

    return {
        "title": title,
        "author": author,
        "full_text": full_text,
    }


def detect_article_urls(tweet_text: str) -> list[str]:
    """Extract article URLs from tweet text, filtering out social media links."""
    url_pattern = r'https?://[^\s<>"{}|\\^`\[\]]+'
    urls = re.findall(url_pattern, tweet_text)
    return [url for url in urls if is_article_url(url)]
