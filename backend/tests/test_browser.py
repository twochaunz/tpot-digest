"""Tests for browser session management.

These tests verify browser management logic without requiring
a real browser or network access. Playwright calls are mocked.
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.scraper.browser import STORAGE_PATH, check_session_valid, get_browser_context, save_session


# ---------------------------------------------------------------------------
# Basic module / constant tests
# ---------------------------------------------------------------------------


def test_storage_path_is_path():
    """STORAGE_PATH should be a Path instance."""
    assert isinstance(STORAGE_PATH, Path)


def test_storage_path_location():
    """STORAGE_PATH should point to the expected file."""
    assert STORAGE_PATH.name == "twitter_session.json"
    assert STORAGE_PATH.parent.name == "browser_state"


def test_scraper_package_importable():
    """The scraper package should be importable."""
    import app.scraper  # noqa: F401


def test_auth_module_importable():
    """The auth module should be importable."""
    from app.scraper.auth import interactive_login  # noqa: F401


def test_browser_module_importable():
    """The browser module should be importable."""
    from app.scraper.browser import (  # noqa: F401
        check_session_valid,
        get_browser_context,
        save_session,
    )


# ---------------------------------------------------------------------------
# Mocked browser context tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_browser_context_no_saved_session():
    """get_browser_context without a saved session file creates a fresh context."""
    mock_context = AsyncMock()
    mock_browser = AsyncMock()
    mock_browser.new_context = AsyncMock(return_value=mock_context)

    mock_pw = AsyncMock()
    mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)

    with patch("app.scraper.browser.async_playwright") as mock_apw, \
         patch("app.scraper.browser.STORAGE_PATH") as mock_path:
        mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
        mock_path.exists.return_value = False

        ctx = await get_browser_context()

        assert ctx is mock_context
        mock_browser.new_context.assert_called_once_with(
            device_scale_factor=2,
            viewport={"width": 1280, "height": 900},
        )


@pytest.mark.asyncio
async def test_get_browser_context_with_saved_session():
    """get_browser_context with a saved session loads storage_state."""
    mock_context = AsyncMock()
    mock_browser = AsyncMock()
    mock_browser.new_context = AsyncMock(return_value=mock_context)

    mock_pw = AsyncMock()
    mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)

    with patch("app.scraper.browser.async_playwright") as mock_apw, \
         patch("app.scraper.browser.STORAGE_PATH") as mock_path:
        mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
        mock_path.exists.return_value = True
        mock_path.__str__ = lambda self: "browser_state/twitter_session.json"

        ctx = await get_browser_context()

        assert ctx is mock_context
        call_kwargs = mock_browser.new_context.call_args[1]
        assert "storage_state" in call_kwargs


@pytest.mark.asyncio
async def test_save_session_creates_file(tmp_path):
    """save_session should call storage_state with the correct path."""
    mock_context = AsyncMock()
    session_file = tmp_path / "browser_state" / "twitter_session.json"

    with patch("app.scraper.browser.STORAGE_PATH", session_file):
        await save_session(mock_context)

    mock_context.storage_state.assert_called_once_with(path=str(session_file))
    # Verify the parent directory was created
    assert session_file.parent.exists()


@pytest.mark.asyncio
async def test_check_session_valid_returns_true():
    """check_session_valid returns True when page is not redirected to login."""
    mock_page = AsyncMock()
    mock_page.url = "https://x.com/home"
    mock_page.goto = AsyncMock()
    mock_page.close = AsyncMock()

    mock_context = AsyncMock()
    mock_context.new_page = AsyncMock(return_value=mock_page)

    result = await check_session_valid(mock_context)

    assert result is True
    mock_page.close.assert_called_once()


@pytest.mark.asyncio
async def test_check_session_valid_returns_false_on_redirect():
    """check_session_valid returns False when redirected to /login."""
    mock_page = AsyncMock()
    mock_page.url = "https://x.com/i/flow/login"
    mock_page.goto = AsyncMock()
    mock_page.close = AsyncMock()

    mock_context = AsyncMock()
    mock_context.new_page = AsyncMock(return_value=mock_page)

    result = await check_session_valid(mock_context)

    assert result is False
    mock_page.close.assert_called_once()


@pytest.mark.asyncio
async def test_check_session_valid_closes_page_on_error():
    """check_session_valid should close the page even if goto raises."""
    mock_page = AsyncMock()
    mock_page.goto = AsyncMock(side_effect=Exception("timeout"))
    mock_page.close = AsyncMock()

    mock_context = AsyncMock()
    mock_context.new_page = AsyncMock(return_value=mock_page)

    with pytest.raises(Exception, match="timeout"):
        await check_session_valid(mock_context)

    mock_page.close.assert_called_once()


# ---------------------------------------------------------------------------
# Auth router endpoint tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auth_status_no_session():
    """GET /api/auth/status returns authenticated=False when no session file."""
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    with patch("app.routers.auth.STORAGE_PATH") as mock_path:
        mock_path.exists.return_value = False
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/auth/status")

    assert response.status_code == 200
    assert response.json() == {"authenticated": False}


@pytest.mark.asyncio
async def test_auth_status_with_valid_session():
    """GET /api/auth/status returns authenticated=True when session is valid."""
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    mock_context = AsyncMock()
    mock_browser = MagicMock()
    mock_browser.close = AsyncMock()
    mock_context.browser = mock_browser

    with patch("app.routers.auth.STORAGE_PATH") as mock_path, \
         patch("app.routers.auth.get_browser_context", return_value=mock_context) as mock_get, \
         patch("app.routers.auth.check_session_valid", return_value=True) as mock_check:
        mock_path.exists.return_value = True
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/auth/status")

    assert response.status_code == 200
    assert response.json() == {"authenticated": True}
