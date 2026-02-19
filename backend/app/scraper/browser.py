from pathlib import Path

from playwright.async_api import BrowserContext, async_playwright

STORAGE_PATH = Path("browser_state/twitter_session.json")


async def get_browser_context() -> BrowserContext:
    """Get a browser context with saved Twitter session if available."""
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=True)
    if STORAGE_PATH.exists():
        context = await browser.new_context(
            storage_state=str(STORAGE_PATH),
            device_scale_factor=2,
            viewport={"width": 1280, "height": 900},
        )
    else:
        context = await browser.new_context(
            device_scale_factor=2,
            viewport={"width": 1280, "height": 900},
        )
    return context


async def save_session(context: BrowserContext):
    """Save the current browser context's storage state for reuse."""
    STORAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    await context.storage_state(path=str(STORAGE_PATH))


async def check_session_valid(context: BrowserContext) -> bool:
    """Check if the saved session is still valid by loading Twitter."""
    page = await context.new_page()
    try:
        await page.goto(
            "https://x.com/home", wait_until="domcontentloaded", timeout=15000
        )
        # If redirected to login, session is invalid
        return "/login" not in page.url
    finally:
        await page.close()
