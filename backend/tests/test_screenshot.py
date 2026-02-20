import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path
from app.scraper.screenshot import CLEANUP_CSS, capture_tweet_screenshot, capture_tweet_screenshots_batch


def test_cleanup_css_hides_engagement():
    """Verify CSS targets the right elements."""
    assert 'data-testid="like"' in CLEANUP_CSS
    assert "display: none" in CLEANUP_CSS


def test_cleanup_css_hides_sidebar():
    assert 'data-testid="sidebarColumn"' in CLEANUP_CSS


@pytest.mark.asyncio
async def test_capture_tweet_screenshot_calls_page(tmp_path):
    """Test that screenshot function creates proper output."""
    mock_context = AsyncMock()
    mock_page = AsyncMock()
    mock_context.new_page.return_value = mock_page

    mock_locator = MagicMock()
    mock_locator.first = mock_locator
    mock_locator.screenshot = AsyncMock()
    mock_locator.bounding_box = AsyncMock(return_value={"x": 0, "y": 0, "width": 600, "height": 400})
    # page.locator() is synchronous in Playwright, so use MagicMock
    mock_page.locator = MagicMock(return_value=mock_locator)

    output = tmp_path / "test_tweet.png"
    result = await capture_tweet_screenshot(
        mock_context,
        "https://x.com/karpathy/status/123456",
        output,
    )

    assert result["width"] == 1200  # 600 * 2x DPR
    assert result["height"] == 800
    mock_page.goto.assert_called_once()
    mock_page.add_style_tag.assert_called_once()
    mock_page.close.assert_called_once()


@pytest.mark.asyncio
async def test_batch_screenshot(tmp_path):
    mock_context = AsyncMock()
    mock_page = AsyncMock()
    mock_context.new_page.return_value = mock_page

    mock_locator = MagicMock()
    mock_locator.first = mock_locator
    mock_locator.screenshot = AsyncMock()
    mock_locator.bounding_box = AsyncMock(return_value={"x": 0, "y": 0, "width": 500, "height": 300})
    # page.locator() is synchronous in Playwright, so use MagicMock
    mock_page.locator = MagicMock(return_value=mock_locator)

    urls = [
        "https://x.com/user/status/111",
        "https://x.com/user/status/222",
    ]
    results = await capture_tweet_screenshots_batch(mock_context, urls, tmp_path)
    assert len(results) == 2
    assert "tweet_111.png" in results[0]["path"]
    assert "tweet_222.png" in results[1]["path"]
