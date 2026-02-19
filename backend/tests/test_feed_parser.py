from app.scraper.parser import parse_tweet_data, parse_count, extract_urls


def test_parse_count_plain():
    assert parse_count("500") == 500


def test_parse_count_with_k():
    assert parse_count("1.2K") == 1200


def test_parse_count_with_m():
    assert parse_count("3.4M") == 3400000


def test_parse_count_with_comma():
    assert parse_count("1,234") == 1234


def test_parse_count_empty():
    assert parse_count("") == 0
    assert parse_count(None) == 0


def test_extract_urls():
    text = "Check out https://example.com and https://t.co/abc123 for more"
    urls = extract_urls(text)
    assert len(urls) == 2
    assert "https://example.com" in urls


def test_parse_tweet_data():
    raw = {
        "tweet_id": "123456",
        "author_handle": "@karpathy",
        "text": "GPT-5 is amazing https://openai.com",
        "likes": "5K",
        "retweets": "1.2K",
        "replies": "300",
        "is_retweet": False,
    }
    result = parse_tweet_data(raw)
    assert result["author_handle"] == "karpathy"  # @ stripped
    assert result["engagement"]["likes"] == 5000
    assert result["engagement"]["retweets"] == 1200
    assert len(result["article_urls"]) == 1


def test_parse_tweet_data_minimal():
    raw = {"tweet_id": "789"}
    result = parse_tweet_data(raw)
    assert result["tweet_id"] == "789"
    assert result["text"] == ""
    assert result["engagement"]["likes"] == 0
