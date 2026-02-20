#!/usr/bin/env python3
"""
Local Twitter login script.

Uses your installed Chrome browser (not Playwright's Chromium) to avoid
Twitter's bot detection. Opens a fresh Chrome profile, lets you log in
manually, then exports the session cookies.

Usage:
    python scripts/twitter-login.py

After login, upload to your server:
    ./scripts/upload-session.sh user@yourserver
"""

import asyncio
import sys
import tempfile
from pathlib import Path


async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("Playwright not installed. Run:")
        print("  pip install playwright")
        sys.exit(1)

    session_path = Path("browser_state/twitter_session.json")
    session_path.parent.mkdir(parents=True, exist_ok=True)

    # Use a temp dir for the Chrome profile so it doesn't conflict
    # with your existing Chrome session
    profile_dir = tempfile.mkdtemp(prefix="tpot-chrome-")

    print("Opening your installed Chrome browser...")
    print("(This uses real Chrome, not Playwright's Chromium)")
    print()

    pw = await async_playwright().start()

    # launch_persistent_context with channel="chrome" uses your
    # installed Chrome — same fingerprint, extensions, etc.
    # Much less likely to trigger Twitter's bot detection.
    try:
        context = await pw.chromium.launch_persistent_context(
            profile_dir,
            channel="chrome",
            headless=False,
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
    except Exception:
        print("Chrome not found. Falling back to Chromium...")
        print("(If this gets rate-limited, install Chrome and try again)")
        context = await pw.chromium.launch_persistent_context(
            profile_dir,
            headless=False,
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )

    page = context.pages[0] if context.pages else await context.new_page()
    await page.goto("https://x.com/login")

    print("=" * 50)
    print("Log in to Twitter in the Chrome window.")
    print()
    print("Take your time — there's no rush.")
    print("After you see your feed, come back here")
    print("and press Enter to save the session.")
    print("=" * 50)
    input()

    # Navigate to home to make sure cookies are fresh
    await page.goto("https://x.com/home", wait_until="domcontentloaded")
    await page.wait_for_timeout(2000)

    # Verify we're actually logged in
    if "/login" in page.url:
        print("WARNING: Still on login page. Session may not be valid.")
        print("Log in and press Enter when ready...")
        input()
        await page.goto("https://x.com/home", wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)

    await context.storage_state(path=str(session_path))
    await context.close()
    await pw.stop()

    print()
    print(f"Session saved to {session_path}")
    print()
    print("Next steps:")
    print("  ./scripts/upload-session.sh user@yourserver")


if __name__ == "__main__":
    asyncio.run(main())
