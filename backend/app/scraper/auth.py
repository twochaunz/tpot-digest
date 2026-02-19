from playwright.async_api import async_playwright

from app.scraper.browser import STORAGE_PATH


async def interactive_login():
    """Opens a headed browser for manual Twitter login. Saves session after."""
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False)
    context = await browser.new_context()
    page = await context.new_page()
    await page.goto("https://x.com/login")
    print("Please log in to Twitter in the browser window.")
    print("Press Enter here after you've logged in and see your feed...")
    input()
    STORAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    await context.storage_state(path=str(STORAGE_PATH))
    await browser.close()
    await pw.stop()
    print(f"Session saved to {STORAGE_PATH}")
