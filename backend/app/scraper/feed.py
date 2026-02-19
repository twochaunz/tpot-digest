from playwright.async_api import BrowserContext, Page

from app.scraper.parser import parse_tweet_data


async def scrape_feed(
    context: BrowserContext, feed_type: str = "for_you", max_scrolls: int = 10
) -> list[dict]:
    """
    Scrape tweets from Twitter feed.

    feed_type: "for_you" or "following"
    max_scrolls: number of scroll-down actions to perform
    """
    page = await context.new_page()
    try:
        # Navigate to the appropriate feed
        if feed_type == "following":
            await page.goto(
                "https://x.com/home/following",
                wait_until="networkidle",
                timeout=30000,
            )
        else:
            await page.goto(
                "https://x.com/home", wait_until="networkidle", timeout=30000
            )

        seen_tweet_ids = set()
        tweets = []

        for _ in range(max_scrolls):
            # Extract tweet elements from current view
            raw_tweets = await extract_tweets_from_page(page)

            for raw in raw_tweets:
                tweet_id = raw.get("tweet_id")
                if tweet_id and tweet_id not in seen_tweet_ids:
                    seen_tweet_ids.add(tweet_id)
                    parsed = parse_tweet_data(raw)
                    parsed["feed_source"] = feed_type
                    tweets.append(parsed)

            # Scroll down
            await page.evaluate("window.scrollBy(0, window.innerHeight)")
            await page.wait_for_timeout(1500)  # Wait for new content to load

        return tweets
    finally:
        await page.close()


async def extract_tweets_from_page(page: Page) -> list[dict]:
    """Extract tweet data from the currently visible tweet elements on the page."""
    return await page.evaluate("""
        () => {
            const tweets = [];
            const articles = document.querySelectorAll('article[data-testid="tweet"]');

            for (const article of articles) {
                try {
                    // Extract tweet link to get ID
                    const timeLink = article.querySelector('a[href*="/status/"]');
                    const href = timeLink ? timeLink.getAttribute('href') : '';
                    const tweetIdMatch = href.match(/status\\/([0-9]+)/);
                    const tweetId = tweetIdMatch ? tweetIdMatch[1] : '';

                    // Extract author
                    const handleEl = article.querySelector('div[data-testid="User-Name"] a[href^="/"]');
                    const authorHandle = handleEl ? handleEl.getAttribute('href').replace('/', '') : '';

                    const displayNameEl = article.querySelector('div[data-testid="User-Name"] span');
                    const authorDisplayName = displayNameEl ? displayNameEl.textContent : '';

                    // Extract tweet text
                    const textEl = article.querySelector('div[data-testid="tweetText"]');
                    const text = textEl ? textEl.textContent : '';

                    // Extract media
                    const mediaEls = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
                    const mediaUrls = Array.from(mediaEls).map(el => el.src);

                    // Extract engagement counts
                    const likesEl = article.querySelector('button[data-testid="like"] span');
                    const retweetsEl = article.querySelector('button[data-testid="retweet"] span');
                    const repliesEl = article.querySelector('button[data-testid="reply"] span');

                    // Detect retweet
                    const retweetIndicator = article.querySelector('span[data-testid="socialContext"]');
                    const isRetweet = retweetIndicator ? retweetIndicator.textContent.includes('reposted') : false;

                    // Detect quote tweet
                    const quoteTweet = article.querySelector('div[role="link"][tabindex="0"]');
                    const isQuoteTweet = !!quoteTweet;

                    tweets.push({
                        tweet_id: tweetId,
                        author_handle: authorHandle,
                        author_display_name: authorDisplayName,
                        text: text,
                        media_urls: mediaUrls,
                        likes: likesEl ? likesEl.textContent : '0',
                        retweets: retweetsEl ? retweetsEl.textContent : '0',
                        replies: repliesEl ? repliesEl.textContent : '0',
                        is_retweet: isRetweet,
                        is_quote_tweet: isQuoteTweet,
                    });
                } catch(e) {
                    // Skip malformed tweet elements
                }
            }
            return tweets;
        }
    """)
