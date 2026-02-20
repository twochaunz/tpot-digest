#!/usr/bin/env python3
"""
Local Twitter login script.

Run this on your Mac (with a display) to authenticate with Twitter.
Exports session cookies to browser_state/twitter_session.json,
which you then upload to your server.

Usage:
    python scripts/twitter-login.py
    # Log in to Twitter in the browser window that opens
    # Press Enter in terminal after you see your feed
    # Then upload the session:
    scp browser_state/twitter_session.json yourserver:/path/to/tpot-digest/browser_state/
"""

import asyncio
import sys
from pathlib import Path


async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("Playwright not installed. Run:")
        print("  pip install playwright && playwright install chromium")
        sys.exit(1)

    session_path = Path("browser_state/twitter_session.json")
    session_path.parent.mkdir(parents=True, exist_ok=True)

    print("Opening browser for Twitter login...")
    print()

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False)
    context = await browser.new_context()
    page = await context.new_page()

    await page.goto("https://x.com/login")

    print("=" * 50)
    print("Log in to Twitter in the browser window.")
    print("After you see your feed, come back here")
    print("and press Enter to save the session.")
    print("=" * 50)
    input()

    # Verify we're actually logged in
    if "/login" in page.url:
        print("WARNING: Still on login page. Session may not be valid.")
        print("Try again? (y/n) ", end="")
        if input().strip().lower() == "y":
            print("Press Enter after logging in...")
            input()

    await context.storage_state(path=str(session_path))
    await browser.close()
    await pw.stop()

    print()
    print(f"Session saved to {session_path}")
    print()
    print("To upload to your server:")
    print(f"  scp {session_path} user@yourserver:/path/to/tpot-digest/browser_state/")


if __name__ == "__main__":
    asyncio.run(main())
