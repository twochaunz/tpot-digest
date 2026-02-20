from app.scraper.article import (
    is_article_url,
    get_archive_url,
    extract_article_content,
    detect_article_urls,
)


def test_is_article_url_valid():
    assert is_article_url("https://techcrunch.com/2026/02/19/new-launch") is True
    assert is_article_url("https://www.bloomberg.com/news/article") is True


def test_is_article_url_social_media():
    assert is_article_url("https://x.com/karpathy/status/123") is False
    assert is_article_url("https://twitter.com/user/status/456") is False
    assert is_article_url("https://youtube.com/watch?v=abc") is False
    assert is_article_url("https://github.com/repo") is False


def test_is_article_url_media_files():
    assert is_article_url("https://example.com/photo.jpg") is False
    assert is_article_url("https://example.com/video.mp4") is False


def test_get_archive_url():
    url = "https://bloomberg.com/news/some-article"
    archive = get_archive_url(url)
    assert archive == "https://archive.ph/newest/https://bloomberg.com/news/some-article"


def test_extract_article_content_with_article_tag():
    html = """
    <html>
    <head><title>Test Article</title></head>
    <body>
    <article>
        <h1>Big News About AI</h1>
        <p class="byline">By John Doe</p>
        <p>This is a very long paragraph about artificial intelligence and its implications
        for the future of technology. The article discusses many important topics that are
        relevant to the current discourse in the tech industry. We need to make this long
        enough to pass the 200 character threshold for content extraction.</p>
        <p>Another substantial paragraph with additional details about the subject matter
        that provides more context and information for the reader to understand.</p>
    </article>
    </body>
    </html>
    """
    result = extract_article_content(html)
    assert result["title"] == "Big News About AI"
    assert result["full_text"] is not None
    assert "artificial intelligence" in result["full_text"]


def test_extract_article_content_fallback_to_paragraphs():
    html = """
    <html>
    <head><title>Another Article</title></head>
    <body>
    <div>
        <p>This is a substantial paragraph about technology trends that contains enough text
        to pass the minimum length threshold.</p>
        <p>Another paragraph with enough content to be captured as article text for extraction purposes.</p>
    </div>
    </body>
    </html>
    """
    result = extract_article_content(html)
    assert result["title"] == "Another Article"


def test_detect_article_urls():
    text = "Check out https://techcrunch.com/article and https://x.com/user/status/123 for more"
    urls = detect_article_urls(text)
    assert len(urls) == 1
    assert "techcrunch.com" in urls[0]


def test_detect_article_urls_empty():
    assert detect_article_urls("No links here") == []
    assert detect_article_urls("") == []
