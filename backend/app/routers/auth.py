from fastapi import APIRouter

from app.scraper.auth import interactive_login
from app.scraper.browser import STORAGE_PATH, check_session_valid, get_browser_context

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status")
async def auth_status():
    """Check if a saved Twitter session exists and is valid."""
    if not STORAGE_PATH.exists():
        return {"authenticated": False}

    try:
        context = await get_browser_context()
        try:
            valid = await check_session_valid(context)
            return {"authenticated": valid}
        finally:
            await context.browser.close()
    except Exception:
        return {"authenticated": False}


@router.post("/login")
async def auth_login():
    """Trigger interactive login. Only works when server runs locally with a display."""
    try:
        await interactive_login()
        return {"status": "ok", "message": "Session saved successfully"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
