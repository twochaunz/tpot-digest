"""Authentication module with HMAC cookie signing and admin access control."""

import hashlib
import hmac
import time
from collections import defaultdict

from fastapi import APIRouter, Cookie, Header, HTTPException, Request, Response

from app.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

# --- In-memory rate limiting ---

_rate_limit_store: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_MAX = 5
_RATE_LIMIT_WINDOW = 60  # seconds


def _check_rate_limit(ip: str) -> bool:
    """Return True if the IP is rate-limited (too many attempts)."""
    now = time.time()
    attempts = _rate_limit_store[ip]
    # Prune old attempts outside the window
    _rate_limit_store[ip] = [t for t in attempts if now - t < _RATE_LIMIT_WINDOW]
    if len(_rate_limit_store[ip]) >= _RATE_LIMIT_MAX:
        return True
    _rate_limit_store[ip].append(now)
    return False


# --- HMAC cookie signing ---

_COOKIE_NAME = "tpot_admin"
_COOKIE_MAX_AGE = 30 * 24 * 60 * 60  # 30 days


def _sign(payload: str, secret: str) -> str:
    """Create HMAC-SHA256 signature for a payload."""
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _make_cookie_value(secret: str) -> str:
    """Create a signed cookie value: payload:signature."""
    payload = f"admin:{int(time.time())}"
    signature = _sign(payload, secret)
    return f"{payload}:{signature}"


def _verify_cookie(cookie_value: str, secret: str) -> bool:
    """Verify a signed cookie value."""
    if not cookie_value or not secret:
        return False
    parts = cookie_value.rsplit(":", 1)
    if len(parts) != 2:
        return False
    payload, signature = parts
    expected = _sign(payload, secret)
    return hmac.compare_digest(signature, expected)


# --- Admin checking ---


def is_admin(
    cookie_value: str | None = None,
    admin_key_header: str | None = None,
) -> bool:
    """Check if the request is from an admin via cookie or X-Admin-Key header."""
    secret = settings.admin_secret
    if not secret:
        return False

    # Check X-Admin-Key header first (direct secret match)
    if admin_key_header and hmac.compare_digest(admin_key_header, secret):
        return True

    # Check signed cookie
    if cookie_value and _verify_cookie(cookie_value, secret):
        return True

    return False


# --- FastAPI dependency ---


async def require_admin(
    request: Request,
    tpot_admin: str | None = Cookie(default=None),
    x_admin_key: str | None = Header(default=None),
):
    """FastAPI dependency that requires admin access. No-op when admin_secret is empty (dev mode)."""
    if not settings.admin_secret:
        return  # Dev mode: no auth required

    if not is_admin(cookie_value=tpot_admin, admin_key_header=x_admin_key):
        raise HTTPException(status_code=403, detail="Admin access required")


# --- Routes ---


@router.get("/admin")
async def admin_login(
    request: Request,
    response: Response,
    key: str = "",
):
    """Validate admin key, set httpOnly cookie, return admin role."""
    secret = settings.admin_secret
    if not secret:
        raise HTTPException(status_code=403, detail="Admin auth not configured")

    # Rate limiting
    client_ip = request.client.host if request.client else "unknown"
    if _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")

    if not key or not hmac.compare_digest(key, secret):
        raise HTTPException(status_code=403, detail="Invalid admin key")

    # Set signed cookie
    cookie_value = _make_cookie_value(secret)
    is_https = request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https"
    response.set_cookie(
        key=_COOKIE_NAME,
        value=cookie_value,
        httponly=True,
        secure=is_https,
        samesite="lax",
        max_age=_COOKIE_MAX_AGE,
        path="/",
    )
    return {"role": "admin"}


@router.get("/me")
async def me(
    tpot_admin: str | None = Cookie(default=None),
    x_admin_key: str | None = Header(default=None),
):
    """Check current auth status."""
    if is_admin(cookie_value=tpot_admin, admin_key_header=x_admin_key):
        return {"role": "admin"}
    return {"role": "viewer"}


@router.post("/logout")
async def logout(response: Response):
    """Clear admin cookie."""
    response.delete_cookie(
        key=_COOKIE_NAME,
        path="/",
    )
    return {"role": "viewer"}
