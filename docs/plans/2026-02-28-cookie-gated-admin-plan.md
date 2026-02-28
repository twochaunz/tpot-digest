# Cookie-Gated Admin Access Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add public read-only dashboard access with cookie-based admin authentication so only authenticated admins can edit/organize content.

**Architecture:** Backend creates an HMAC-signed httpOnly cookie when the admin authenticates with a secret key. A FastAPI dependency (`require_admin`) gates all mutation endpoints. Frontend reads role from `/api/auth/me` and conditionally hides edit controls.

**Tech Stack:** Python/FastAPI (backend auth), React Context (frontend role), Chrome Extension (header-based auth)

---

### Task 1: Add ADMIN_SECRET to backend config

**Files:**
- Modify: `backend/app/config.py`

**Step 1: Add admin_secret field to Settings**

In `backend/app/config.py`, add `admin_secret` to the `Settings` class after line 9 (`anthropic_api_key`):

```python
admin_secret: str = ""
```

**Step 2: Add ADMIN_SECRET to docker-compose.prod.yml**

In `docker-compose.prod.yml`, add to the backend service environment (after line 27, `ANTHROPIC_API_KEY`):

```yaml
      ADMIN_SECRET: ${ADMIN_SECRET}
```

**Step 3: Commit**

```bash
git add backend/app/config.py docker-compose.prod.yml
git commit -m "feat: add ADMIN_SECRET config for admin auth"
```

---

### Task 2: Create backend auth module with cookie signing and require_admin dependency

**Files:**
- Create: `backend/app/auth.py`

**Step 1: Write the failing test**

Create `backend/tests/test_auth.py`:

```python
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

import app.db as db_module
from app.db import Base, get_db
from app.main import app
from app.models import Tweet, Topic, TweetAssignment  # noqa: F401

@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DB_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def override_get_db():
    async with async_session() as session:
        yield session

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    _orig_session = db_module.async_session
    db_module.async_session = async_session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)
    db_module.async_session = _orig_session

@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

TEST_SECRET = "test-admin-secret-32chars-long!!"

@pytest.mark.asyncio
async def test_auth_admin_valid_key(client: AsyncClient):
    """GET /api/auth/admin?key=<valid> sets cookie and returns admin role."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = TEST_SECRET
        resp = await client.get(f"/api/auth/admin?key={TEST_SECRET}")
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"
    assert "tpot_admin" in resp.cookies

@pytest.mark.asyncio
async def test_auth_admin_invalid_key(client: AsyncClient):
    """GET /api/auth/admin?key=<wrong> returns 403."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = TEST_SECRET
        resp = await client.get("/api/auth/admin?key=wrong-key")
    assert resp.status_code == 403

@pytest.mark.asyncio
async def test_auth_admin_no_secret_configured(client: AsyncClient):
    """When ADMIN_SECRET is empty, auth endpoint returns 403."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = ""
        resp = await client.get("/api/auth/admin?key=anything")
    assert resp.status_code == 403

@pytest.mark.asyncio
async def test_auth_me_no_cookie(client: AsyncClient):
    """GET /api/auth/me without cookie returns viewer role."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = TEST_SECRET
        resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"

@pytest.mark.asyncio
async def test_auth_me_with_valid_cookie(client: AsyncClient):
    """GET /api/auth/me with valid admin cookie returns admin role."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = TEST_SECRET
        # First authenticate
        login_resp = await client.get(f"/api/auth/admin?key={TEST_SECRET}")
        assert login_resp.status_code == 200
        # Use the cookie from login response
        resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"

@pytest.mark.asyncio
async def test_auth_logout(client: AsyncClient):
    """POST /api/auth/logout clears the admin cookie."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = TEST_SECRET
        # Login first
        await client.get(f"/api/auth/admin?key={TEST_SECRET}")
        # Logout
        resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"

@pytest.mark.asyncio
async def test_auth_x_admin_key_header(client: AsyncClient):
    """X-Admin-Key header is accepted as alternative to cookie."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = TEST_SECRET
        resp = await client.get(
            "/api/auth/me",
            headers={"X-Admin-Key": TEST_SECRET},
        )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"
```

**Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_auth.py -v`
Expected: FAIL — `app.auth` module doesn't exist yet

**Step 3: Write the auth module**

Create `backend/app/auth.py`:

```python
import hashlib
import hmac
import time

from fastapi import APIRouter, Cookie, Header, HTTPException, Request, Response

from app.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "tpot_admin"
# In-memory rate limiting: {ip: [timestamps]}
_rate_limit: dict[str, list[float]] = {}
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 5  # attempts per window


def _sign(value: str) -> str:
    """HMAC-sign a value with ADMIN_SECRET."""
    return hmac.new(
        settings.admin_secret.encode(), value.encode(), hashlib.sha256
    ).hexdigest()


def _verify_cookie(cookie_value: str | None) -> bool:
    """Verify an HMAC-signed admin cookie."""
    if not cookie_value or not settings.admin_secret:
        return False
    parts = cookie_value.split(":", 1)
    if len(parts) != 2:
        return False
    payload, signature = parts
    expected = _sign(payload)
    return hmac.compare_digest(signature, expected)


def _check_rate_limit(ip: str) -> bool:
    """Return True if request is within rate limit."""
    now = time.time()
    if ip not in _rate_limit:
        _rate_limit[ip] = []
    # Clean old entries
    _rate_limit[ip] = [t for t in _rate_limit[ip] if now - t < RATE_LIMIT_WINDOW]
    if len(_rate_limit[ip]) >= RATE_LIMIT_MAX:
        return False
    _rate_limit[ip].append(now)
    return True


def is_admin(
    cookie_value: str | None = None,
    admin_key_header: str | None = None,
) -> bool:
    """Check if request is from an admin via cookie or header."""
    if not settings.admin_secret:
        return False
    # Check X-Admin-Key header first (for extension/API clients)
    if admin_key_header and hmac.compare_digest(admin_key_header, settings.admin_secret):
        return True
    # Check cookie
    return _verify_cookie(cookie_value)


def require_admin(
    request: Request,
    tpot_admin: str | None = Cookie(None),
    x_admin_key: str | None = Header(None),
):
    """FastAPI dependency that blocks non-admin requests with 403."""
    if not is_admin(cookie_value=tpot_admin, admin_key_header=x_admin_key):
        raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/admin")
async def admin_login(key: str, request: Request, response: Response):
    """Authenticate with admin secret key and set cookie."""
    if not settings.admin_secret:
        raise HTTPException(status_code=403, detail="Admin auth not configured")

    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many attempts")

    if not hmac.compare_digest(key, settings.admin_secret):
        raise HTTPException(status_code=403, detail="Invalid key")

    # Create signed cookie value
    payload = f"admin:{int(time.time())}"
    signed = f"{payload}:{_sign(payload)}"

    response.set_cookie(
        key=COOKIE_NAME,
        value=signed,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        max_age=30 * 24 * 3600,  # 30 days
        path="/",
    )
    return {"role": "admin"}


@router.get("/me")
async def auth_me(
    tpot_admin: str | None = Cookie(None),
    x_admin_key: str | None = Header(None),
):
    """Check current auth status."""
    if is_admin(cookie_value=tpot_admin, admin_key_header=x_admin_key):
        return {"role": "admin"}
    return {"role": "viewer"}


@router.post("/logout")
async def logout(response: Response):
    """Clear admin cookie."""
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"role": "viewer"}
```

**Step 4: Register the auth router in main.py**

In `backend/app/main.py`, add after line 30 (`app.include_router(scripts_router)`):

```python
from app.auth import router as auth_router
app.include_router(auth_router)
```

**Step 5: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_auth.py -v`
Expected: All 7 tests PASS

**Step 6: Commit**

```bash
git add backend/app/auth.py backend/tests/test_auth.py backend/app/main.py
git commit -m "feat: add auth module with cookie signing, rate limiting, and admin endpoints"
```

---

### Task 3: Apply require_admin dependency to all mutation endpoints

**Files:**
- Modify: `backend/app/routers/tweets.py`
- Modify: `backend/app/routers/topics.py`
- Modify: `backend/app/routers/scripts.py`

**Step 1: Write failing tests that mutation endpoints return 403 without admin auth**

Add to `backend/tests/test_auth.py`:

```python
from unittest.mock import AsyncMock

@pytest.mark.asyncio
async def test_save_tweet_requires_admin(client: AsyncClient):
    """POST /api/tweets returns 403 without admin auth."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = TEST_SECRET
        resp = await client.post("/api/tweets", json={"tweet_id": "123"})
    assert resp.status_code == 403

@pytest.mark.asyncio
async def test_save_tweet_allowed_with_admin_header(client: AsyncClient):
    """POST /api/tweets succeeds with X-Admin-Key header."""
    with patch("app.auth.settings") as mock_settings, \
         patch("app.services.x_api.fetch_tweet", new_callable=AsyncMock):
        mock_settings.admin_secret = TEST_SECRET
        resp = await client.post(
            "/api/tweets",
            json={"tweet_id": "123"},
            headers={"X-Admin-Key": TEST_SECRET},
        )
    assert resp.status_code in (200, 201)  # 201 new or 200 duplicate

@pytest.mark.asyncio
async def test_delete_topic_requires_admin(client: AsyncClient):
    """DELETE /api/topics/{id} returns 403 without admin auth."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = TEST_SECRET
        resp = await client.delete("/api/topics/1")
    assert resp.status_code == 403

@pytest.mark.asyncio
async def test_get_tweets_public(client: AsyncClient):
    """GET /api/tweets is public (no admin required)."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = TEST_SECRET
        resp = await client.get("/api/tweets")
    assert resp.status_code == 200

@pytest.mark.asyncio
async def test_check_saved_public(client: AsyncClient):
    """POST /api/tweets/check is public (read-only operation)."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = TEST_SECRET
        resp = await client.post("/api/tweets/check", json={"tweet_ids": []})
    assert resp.status_code == 200

@pytest.mark.asyncio
async def test_admin_not_required_when_no_secret(client: AsyncClient):
    """When ADMIN_SECRET is empty, mutations are allowed (dev mode)."""
    with patch("app.auth.settings") as mock_settings, \
         patch("app.services.x_api.fetch_tweet", new_callable=AsyncMock):
        mock_settings.admin_secret = ""
        resp = await client.post("/api/tweets", json={"tweet_id": "456"})
    assert resp.status_code in (200, 201)
```

**Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_auth.py::test_save_tweet_requires_admin -v`
Expected: FAIL — currently returns 201 (no auth check)

**Step 3: Update require_admin to be a no-op when ADMIN_SECRET is empty (dev mode)**

In `backend/app/auth.py`, update `require_admin`:

```python
def require_admin(
    request: Request,
    tpot_admin: str | None = Cookie(None),
    x_admin_key: str | None = Header(None),
):
    """FastAPI dependency that blocks non-admin requests with 403.
    No-op when ADMIN_SECRET is not configured (dev mode)."""
    if not settings.admin_secret:
        return  # Dev mode: no auth required
    if not is_admin(cookie_value=tpot_admin, admin_key_header=x_admin_key):
        raise HTTPException(status_code=403, detail="Admin access required")
```

**Step 4: Add require_admin to tweets.py mutation endpoints**

In `backend/app/routers/tweets.py`:

Add import at top (after line 5):
```python
from app.auth import require_admin
```

Add `_admin=Depends(require_admin)` to these route handlers:
- `save_tweet` (line 83): `async def save_tweet(body: TweetSave, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):`
- `delete_tweet` (line 173): `async def delete_tweet(tweet_id: int, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):`
- `update_tweet` (line 182): `async def update_tweet(tweet_id: int, body: TweetUpdate, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):`
- `fetch_grok` (line 194): add `_admin=Depends(require_admin)`
- `refetch_tweet` (line 220): add `_admin=Depends(require_admin)`
- `refetch_all_tweets` (line 254): add `_admin=Depends(require_admin)`
- `assign_tweets` (line 303): add `_admin=Depends(require_admin)`
- `unassign_tweets` (line 337): add `_admin=Depends(require_admin)`

Do NOT add to:
- `list_tweets` (line 114) — GET, read-only
- `check_saved` (line 291) — POST but read-only operation used by extension to check saved status

**Step 5: Add require_admin to topics.py mutation endpoints**

In `backend/app/routers/topics.py`:

Add import at top (after line 3):
```python
from app.auth import require_admin
```

Add `_admin=Depends(require_admin)` to:
- `create_topic` (line 47): add `_admin=Depends(require_admin)`
- `update_topic` (line 85): add `_admin=Depends(require_admin)`
- `fix_all_title_case` (line 152): add `_admin=Depends(require_admin)`
- `delete_topic` (line 167): add `_admin=Depends(require_admin)`

Do NOT add to:
- `list_topics` (line 62) — GET, read-only

**Step 6: Add require_admin to scripts.py mutation endpoints**

In `backend/app/routers/scripts.py`:

Add import at top (after line 3):
```python
from app.auth import require_admin
```

Add `_admin=Depends(require_admin)` to:
- `generate_topic_script` (line 81): add `_admin=Depends(require_admin)`
- `update_script_content` (line 192): add `_admin=Depends(require_admin)`
- `generate_day_scripts` (line 225): add `_admin=Depends(require_admin)`

Do NOT add to:
- `get_active_script` (line 176) — GET, read-only
- `list_script_versions` (line 212) — GET, read-only
- `get_day_scripts` (line 248) — GET, read-only

**Step 7: Run all auth tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_auth.py -v`
Expected: All tests PASS

**Step 8: Run existing tests to ensure no regressions**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All existing tests PASS (they use dev mode where `admin_secret` is empty, so `require_admin` is a no-op)

**Step 9: Commit**

```bash
git add backend/app/auth.py backend/app/routers/tweets.py backend/app/routers/topics.py backend/app/routers/scripts.py backend/tests/test_auth.py
git commit -m "feat: apply require_admin dependency to all mutation endpoints"
```

---

### Task 4: Create frontend AuthContext and useAuth hook

**Files:**
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/contexts/AuthContext.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: Create auth API functions**

Create `frontend/src/api/auth.ts`:

```typescript
import { api } from './client'

export type Role = 'admin' | 'viewer'

export interface AuthStatus {
  role: Role
}

export async function fetchAuthMe(): Promise<AuthStatus> {
  const { data } = await api.get<AuthStatus>('/auth/me')
  return data
}
```

**Step 2: Create AuthContext**

Create `frontend/src/contexts/AuthContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchAuthMe, type Role } from '../api/auth'

interface AuthContextValue {
  role: Role
  isAdmin: boolean
  loading: boolean
}

const AuthContext = createContext<AuthContextValue>({
  role: 'viewer',
  isAdmin: false,
  loading: true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('viewer')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAuthMe()
      .then((data) => setRole(data.role))
      .catch(() => setRole('viewer'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <AuthContext.Provider value={{ role, isAdmin: role === 'admin', loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
```

**Step 3: Wrap App with AuthProvider**

In `frontend/src/App.tsx`, add import and wrap:

```tsx
import { AuthProvider } from './contexts/AuthContext'

// In the App component, wrap BrowserRouter with AuthProvider:
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/app" element={<DailyView />} />
            <Route path="/app/:dateStr" element={<DailyView />} />
            <Route path="/app/:dateStr/:topicNum" element={<DailyView />} />
            <Route path="/app/settings" element={<SettingsPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
```

**Step 4: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add frontend/src/api/auth.ts frontend/src/contexts/AuthContext.tsx frontend/src/App.tsx
git commit -m "feat: add AuthContext with useAuth hook for role-based UI"
```

---

### Task 5: Hide editing controls for viewers in DayFeedPanel

This is the main component that orchestrates drag-and-drop, context menus, and topic creation.

**Files:**
- Modify: `frontend/src/components/DayFeedPanel.tsx`

**Step 1: Read the full DayFeedPanel.tsx**

Read `frontend/src/components/DayFeedPanel.tsx` to understand the full component.

**Step 2: Add useAuth and conditionally disable editing**

In `frontend/src/components/DayFeedPanel.tsx`:

Add import:
```typescript
import { useAuth } from '../contexts/AuthContext'
```

Inside the component function, add:
```typescript
const { isAdmin } = useAuth()
```

Changes needed (specific code depends on reading the full file — apply these patterns):

1. **DndContext**: Wrap in conditional — only render `DndContext` when `isAdmin`, otherwise render children without drag-and-drop wrapper
2. **ContextMenu**: Only render when `isAdmin`: `{isAdmin && contextMenu && <ContextMenu ... />}`
3. **TopicContextMenu**: Only render when `isAdmin`: `{isAdmin && topicContextMenu && <TopicContextMenu ... />}`
4. **CreateTopicForm**: Only render when `isAdmin`: `{isAdmin && <CreateTopicForm ... />}`
5. **UndoToast**: Only render when `isAdmin` (undo is for editing operations)
6. **DragOverlay**: Only render when `isAdmin`
7. Pass `isAdmin` down to child components that need it (TopicSection, UnsortedSection)

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/components/DayFeedPanel.tsx
git commit -m "feat: hide drag-drop, context menu, and create topic for viewers"
```

---

### Task 6: Hide editing controls in TopicSection for viewers

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx`

**Step 1: Read TopicSection.tsx fully**

Read the full file to understand all edit controls.

**Step 2: Add isAdmin prop and conditionally hide edit controls**

In `frontend/src/components/TopicSection.tsx`:

Add `isAdmin?: boolean` to the `TopicSectionProps` interface.

Changes:
1. **Title editing**: Double-click to edit should only work when `isAdmin`. Change the double-click handler: `onDoubleClick={isAdmin ? () => setEditing(true) : undefined}`
2. **Context menu on header**: Only trigger when `isAdmin`: `onContextMenu={isAdmin ? (e) => { e.preventDefault(); onTopicContextMenu?.(e, topicId, title) } : undefined}`
3. **Drag handles on tweet cards**: Pass `selectable={isAdmin}` or similar prop to disable selection/drag for viewers

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/components/TopicSection.tsx
git commit -m "feat: hide topic editing and drag controls for viewers"
```

---

### Task 7: Hide editing controls in UnsortedSection for viewers

**Files:**
- Modify: `frontend/src/components/UnsortedSection.tsx`

**Step 1: Read UnsortedSection.tsx fully**

Read the full file.

**Step 2: Add isAdmin prop and conditionally hide edit controls**

Changes:
1. Add `isAdmin?: boolean` to props
2. Disable drag-and-drop selection when not admin
3. Hide context menu trigger when not admin
4. Hide any assign/delete controls when not admin

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/components/UnsortedSection.tsx
git commit -m "feat: hide editing controls in unsorted section for viewers"
```

---

### Task 8: Update Chrome extension to use X-Admin-Key header

**Files:**
- Modify: `extension/background.js`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

**Step 1: Update DEFAULT_CONFIG to include adminKey**

In `extension/background.js`, line 1:

```javascript
const DEFAULT_CONFIG = { backendUrl: "http://localhost:8000", authUser: "", authPass: "", adminKey: "" };
```

**Step 2: Update authHeaders to send X-Admin-Key**

In `extension/background.js`, replace `authHeaders` function (lines 58-64):

```javascript
function authHeaders(config) {
  const headers = {};
  if (config.adminKey) {
    headers["X-Admin-Key"] = config.adminKey;
  } else if (config.authUser && config.authPass) {
    headers["Authorization"] = "Basic " + btoa(config.authUser + ":" + config.authPass);
  }
  return headers;
}
```

**Step 3: Add Admin Key field to popup.html**

In `extension/popup.html`, after line 15 (password input), add:

```html
      <label>Admin Key</label>
      <input type="password" id="adminKey" placeholder="(required for saving)">
```

**Step 4: Update popup.js to load/save adminKey**

In `extension/popup.js`:

Add `adminKey` element reference (after line 4):
```javascript
const adminKey = document.getElementById("adminKey");
```

Update config load (line 10) to include `adminKey: ""` in defaults and set it:
```javascript
chrome.storage.sync.get({ backendUrl: "http://localhost:8000", authUser: "", authPass: "", adminKey: "" }, (cfg) => {
    backendUrl.value = cfg.backendUrl;
    authUser.value = cfg.authUser;
    authPass.value = cfg.authPass;
    adminKey.value = cfg.adminKey;
});
```

Update save handler (line 28) to include adminKey:
```javascript
chrome.storage.sync.set({
    backendUrl: backendUrl.value.trim() || "http://localhost:8000",
    authUser: authUser.value.trim(),
    authPass: authPass.value,
    adminKey: adminKey.value,
}, () => { ... });
```

**Step 5: Commit**

```bash
git add extension/background.js extension/popup.html extension/popup.js
git commit -m "feat: add X-Admin-Key header support to Chrome extension"
```

---

### Task 9: Handle admin login via URL parameter in frontend

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx`

**Step 1: Update AuthProvider to check URL for admin key**

When the user visits `/app?admin=<secret>`, the frontend should call `GET /api/auth/admin?key=<secret>` to set the cookie, then remove the param from the URL.

Update `frontend/src/contexts/AuthContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchAuthMe, type Role } from '../api/auth'
import { api } from '../api/client'

interface AuthContextValue {
  role: Role
  isAdmin: boolean
  loading: boolean
}

const AuthContext = createContext<AuthContextValue>({
  role: 'viewer',
  isAdmin: false,
  loading: true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('viewer')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      // Check URL for admin key
      const params = new URLSearchParams(window.location.search)
      const adminKey = params.get('admin')
      if (adminKey) {
        try {
          await api.get('/auth/admin', { params: { key: adminKey } })
        } catch {
          // Invalid key — continue as viewer
        }
        // Remove admin param from URL without reload
        params.delete('admin')
        const newUrl = params.toString()
          ? `${window.location.pathname}?${params}`
          : window.location.pathname
        window.history.replaceState({}, '', newUrl)
      }

      // Check current auth status
      try {
        const data = await fetchAuthMe()
        setRole(data.role)
      } catch {
        setRole('viewer')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  return (
    <AuthContext.Provider value={{ role, isAdmin: role === 'admin', loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
```

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx
git commit -m "feat: handle admin login via URL parameter"
```

---

### Task 10: Make Settings page admin-only

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`

**Step 1: Read SettingsPage.tsx**

Read the file to understand its structure.

**Step 2: Add admin guard**

Add at the top of the component:
```tsx
import { useAuth } from '../contexts/AuthContext'

// Inside component:
const { isAdmin } = useAuth()

if (!isAdmin) {
  return <div style={{ padding: '2rem', textAlign: 'center' }}>Admin access required</div>
}
```

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "feat: restrict settings page to admin only"
```

---

### Task 11: End-to-end verification

**Step 1: Run all backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -v`
Expected: All tests PASS

**Step 2: Run frontend TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Manual verification checklist**

Start the dev server and verify:
- [ ] `/app` loads as viewer (no edit controls visible)
- [ ] `/app?admin=<ADMIN_SECRET>` sets cookie and shows edit controls
- [ ] Refreshing keeps admin session (cookie persists)
- [ ] Drag-and-drop works for admin
- [ ] Context menu appears for admin
- [ ] Create topic form visible for admin
- [ ] All navigation keyboard shortcuts work for both roles
- [ ] Viewer cannot call mutation endpoints directly (403)
- [ ] Extension with admin key can save tweets
- [ ] Extension without admin key gets 403 on save

**Step 4: Commit any fixes from verification**

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```
