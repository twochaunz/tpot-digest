from fastapi import APIRouter

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status")
async def auth_status():
    """Check authentication status.

    With the Chrome extension architecture, Twitter authentication is handled
    by the user's browser. This endpoint returns a simple status indicator.
    """
    return {"authenticated": True, "method": "chrome_extension"}
