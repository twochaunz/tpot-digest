from pathlib import Path

from playwright.async_api import BrowserContext


# CSS to inject to hide engagement metrics, reply thread, and other noise
CLEANUP_CSS = """
/* Hide engagement metrics bar */
div[role="group"]:has(button[data-testid="like"]) { display: none !important; }

/* Hide reply thread / "Show replies" */
div[data-testid="cellInnerDiv"]:has(div[data-testid="tweet"]) ~ div { display: none !important; }

/* Hide "Who can reply" notice */
div[data-testid="restrictedReplyNotice"] { display: none !important; }

/* Hide follow button */
button[data-testid*="follow"] { display: none !important; }

/* Hide "More tweets" / "Show this thread" */
div[role="link"][tabindex="0"] { display: none !important; }

/* Hide bottom navigation */
nav[aria-label="Bottom Navigation"] { display: none !important; }

/* Hide trending sidebar */
div[data-testid="sidebarColumn"] { display: none !important; }

/* Hide header bar */
header[role="banner"] { display: none !important; }

/* Clean up background */
body { background: white !important; }
"""


async def capture_tweet_screenshot(
    context: BrowserContext,
    tweet_url: str,
    output_path: str | Path,
) -> dict:
    """
    Capture a clean screenshot of a tweet.

    - Loads the tweet URL
    - Injects CSS to hide engagement metrics, replies, nav
    - Waits for full render
    - Screenshots the tweet article element only
    - Saves at 2x DPR for crisp video overlays

    Returns: {"path": str, "width": int, "height": int}
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    page = await context.new_page()
    try:
        await page.goto(tweet_url, wait_until="networkidle", timeout=30000)

        # Inject cleanup CSS
        await page.add_style_tag(content=CLEANUP_CSS)

        # Wait for tweet content to render
        await page.wait_for_selector('article[data-testid="tweet"]', timeout=10000)

        # Wait a moment for images to load
        await page.wait_for_timeout(2000)

        # Get the tweet article element
        tweet_element = page.locator('article[data-testid="tweet"]').first

        # Screenshot just the tweet element
        await tweet_element.screenshot(
            path=str(output_path),
            type="png",
        )

        # Get dimensions
        box = await tweet_element.bounding_box()
        width = int(box["width"] * 2) if box else 0  # 2x DPR
        height = int(box["height"] * 2) if box else 0

        return {
            "path": str(output_path),
            "width": width,
            "height": height,
        }
    finally:
        await page.close()


async def capture_tweet_screenshots_batch(
    context: BrowserContext,
    tweet_urls: list[str],
    output_dir: str | Path,
) -> list[dict]:
    """
    Capture screenshots for multiple tweets.
    Returns list of result dicts.
    """
    output_dir = Path(output_dir)
    results = []

    for url in tweet_urls:
        # Extract tweet ID from URL for filename
        tweet_id = url.rstrip("/").split("/")[-1]
        output_path = output_dir / f"tweet_{tweet_id}.png"

        try:
            result = await capture_tweet_screenshot(context, url, output_path)
            results.append(result)
        except Exception as e:
            results.append({
                "path": str(output_path),
                "width": 0,
                "height": 0,
                "error": str(e),
            })

    return results
