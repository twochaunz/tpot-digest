"""Tests for scheduler control endpoints and scheduler lifecycle functions."""

from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Scheduler status endpoint tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scheduler_status(client: AsyncClient):
    """GET /api/scheduler/status returns the running state."""
    with patch("app.routers.scheduler.scheduler") as mock_scheduler:
        mock_scheduler.running = False
        response = await client.get("/api/scheduler/status")

    assert response.status_code == 200
    data = response.json()
    assert data["running"] is False
    assert data["next_run_time"] is None
    assert "scrape_interval_hours" in data


@pytest.mark.asyncio
async def test_scheduler_status_running(client: AsyncClient):
    """GET /api/scheduler/status returns next_run_time when running."""
    mock_job = MagicMock()
    mock_job.next_run_time.isoformat.return_value = "2026-02-19T12:00:00+00:00"

    with patch("app.routers.scheduler.scheduler") as mock_scheduler:
        mock_scheduler.running = True
        mock_scheduler.get_job.return_value = mock_job
        response = await client.get("/api/scheduler/status")

    assert response.status_code == 200
    data = response.json()
    assert data["running"] is True
    assert data["next_run_time"] == "2026-02-19T12:00:00+00:00"


# ---------------------------------------------------------------------------
# Scheduler config update endpoint tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scheduler_config_update(client: AsyncClient):
    """PATCH /api/scheduler/config updates interval and max scrolls."""
    with patch("app.routers.scheduler.settings") as mock_settings, \
         patch("app.routers.scheduler.scheduler") as mock_scheduler:
        mock_settings.scrape_interval_hours = 2
        mock_settings.scrape_max_scrolls = 10
        mock_scheduler.running = True

        response = await client.patch("/api/scheduler/config", json={
            "scrape_interval_hours": 4,
            "scrape_max_scrolls": 20,
        })

    assert response.status_code == 200
    data = response.json()
    assert data["scrape_interval_hours"] == 4
    assert data["scrape_max_scrolls"] == 20
    mock_scheduler.reschedule_job.assert_called_once_with(
        "scrape_feed",
        trigger="interval",
        hours=4,
    )


@pytest.mark.asyncio
async def test_scheduler_config_partial_update(client: AsyncClient):
    """PATCH /api/scheduler/config with partial fields only updates specified ones."""
    with patch("app.routers.scheduler.settings") as mock_settings, \
         patch("app.routers.scheduler.scheduler") as mock_scheduler:
        mock_settings.scrape_interval_hours = 2
        mock_settings.scrape_max_scrolls = 10
        mock_scheduler.running = False

        response = await client.patch("/api/scheduler/config", json={
            "scrape_max_scrolls": 15,
        })

    assert response.status_code == 200
    data = response.json()
    assert data["scrape_max_scrolls"] == 15
    # Scheduler not running, so reschedule_job should not be called
    mock_scheduler.reschedule_job.assert_not_called()


# ---------------------------------------------------------------------------
# Trigger endpoint test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trigger_scrape(client: AsyncClient):
    """POST /api/scheduler/trigger returns 202 and triggers a background task."""
    with patch("app.routers.scheduler.scrape_job") as mock_scrape_job:
        response = await client.post("/api/scheduler/trigger")

    assert response.status_code == 202
    data = response.json()
    assert data["message"] == "Scrape job triggered"


# ---------------------------------------------------------------------------
# Scheduler lifecycle function tests
# ---------------------------------------------------------------------------


def test_start_scheduler():
    """start_scheduler should add a job and start the scheduler."""
    with patch("app.scheduler.scheduler") as mock_scheduler:
        mock_scheduler.running = False
        from app.scheduler import start_scheduler
        start_scheduler()

        mock_scheduler.add_job.assert_called_once()
        call_kwargs = mock_scheduler.add_job.call_args
        assert call_kwargs[1]["id"] == "scrape_feed"
        assert call_kwargs[1]["replace_existing"] is True
        mock_scheduler.start.assert_called_once()


def test_stop_scheduler_when_running():
    """stop_scheduler should call shutdown when scheduler is running."""
    with patch("app.scheduler.scheduler") as mock_scheduler:
        mock_scheduler.running = True
        from app.scheduler import stop_scheduler
        stop_scheduler()

        mock_scheduler.shutdown.assert_called_once_with(wait=False)


def test_stop_scheduler_when_not_running():
    """stop_scheduler should not call shutdown when scheduler is not running."""
    with patch("app.scheduler.scheduler") as mock_scheduler:
        mock_scheduler.running = False
        from app.scheduler import stop_scheduler
        stop_scheduler()

        mock_scheduler.shutdown.assert_not_called()
