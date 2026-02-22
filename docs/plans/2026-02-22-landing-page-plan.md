# Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a public landing page at `/` with a Disney-cartoon-esque teapot character, email waitlist ("tea please"), and secondary sign-in link. Move existing dashboard to `/app`.

**Architecture:** New `/` route renders a light-themed `LandingPage.tsx` with CSS/SVG teapot, email input, and "tea please" submit button. Backend gets a new `waitlist` table + `POST /api/waitlist` endpoint. Caddy basic auth scoped to `/app/*` only, leaving landing page and waitlist endpoint public.

**Tech Stack:** React 19, FastAPI, SQLAlchemy async, PostgreSQL, Alembic, CSS/SVG animations

---

### Task 1: Waitlist Model

**Files:**
- Create: `backend/app/models/waitlist.py`
- Modify: `backend/app/models/__init__.py`

**Step 1: Create the waitlist model**

```python
# backend/app/models/waitlist.py
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class WaitlistEntry(Base):
    __tablename__ = "waitlist"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

**Step 2: Register model in `__init__.py`**

Add to `backend/app/models/__init__.py`:
```python
from app.models.waitlist import WaitlistEntry
```

And add `"WaitlistEntry"` to the `__all__` list.

**Step 3: Commit**

```bash
git add backend/app/models/waitlist.py backend/app/models/__init__.py
git commit -m "feat: add WaitlistEntry model"
```

---

### Task 2: Alembic Migration

**Files:**
- Create: `backend/alembic/versions/004_add_waitlist.py`

**Step 1: Create migration file**

```python
# backend/alembic/versions/004_add_waitlist.py
"""add waitlist table

Revision ID: 004_waitlist
Revises: 003_url
Create Date: 2026-02-22
"""
from alembic import op
import sqlalchemy as sa

revision = "004_waitlist"
down_revision = "003_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "waitlist",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(320), unique=True, index=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("waitlist")
```

**Step 2: Commit**

```bash
git add backend/alembic/versions/004_add_waitlist.py
git commit -m "feat: add waitlist migration"
```

---

### Task 3: Waitlist Schema + Router

**Files:**
- Create: `backend/app/schemas/waitlist.py`
- Create: `backend/app/routers/waitlist.py`
- Modify: `backend/app/main.py`

**Step 1: Create schema**

```python
# backend/app/schemas/waitlist.py
from pydantic import BaseModel, EmailStr


class WaitlistRequest(BaseModel):
    email: EmailStr


class WaitlistResponse(BaseModel):
    message: str
    already_registered: bool = False
```

Note: `EmailStr` requires `pydantic[email]` — check if already installed, otherwise add `email-validator` to requirements.

**Step 2: Create router**

```python
# backend/app/routers/waitlist.py
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.waitlist import WaitlistEntry
from app.schemas.waitlist import WaitlistRequest, WaitlistResponse

router = APIRouter(prefix="/api/waitlist", tags=["waitlist"])


@router.post("", response_model=WaitlistResponse)
async def join_waitlist(body: WaitlistRequest, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(
        select(WaitlistEntry).where(WaitlistEntry.email == body.email)
    )).scalar_one_or_none()

    if existing:
        return WaitlistResponse(message="You're already on the list!", already_registered=True)

    entry = WaitlistEntry(email=body.email)
    db.add(entry)
    await db.commit()
    return WaitlistResponse(message="You're on the list!")
```

**Step 3: Register router in `main.py`**

Add after the categories router import in `backend/app/main.py`:

```python
from app.routers.waitlist import router as waitlist_router
app.include_router(waitlist_router)
```

**Step 4: Install email-validator if needed**

Run: `cd backend && .venv/bin/pip install email-validator`

**Step 5: Commit**

```bash
git add backend/app/schemas/waitlist.py backend/app/routers/waitlist.py backend/app/main.py
git commit -m "feat: add waitlist API endpoint"
```

---

### Task 4: Waitlist API Tests

**Files:**
- Create: `backend/tests/test_waitlist_api.py`
- Modify: `backend/tests/test_tweets_api.py` (update model import for WaitlistEntry)

**Step 1: Write tests**

```python
# backend/tests/test_waitlist_api.py
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app

# Import all models so Base.metadata knows about them
from app.models import Tweet, Topic, Category, TweetAssignment  # noqa: F401
from app.models.waitlist import WaitlistEntry  # noqa: F401


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
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_join_waitlist(client: AsyncClient):
    resp = await client.post("/api/waitlist", json={"email": "hello@example.com"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "You're on the list!"
    assert data["already_registered"] is False


@pytest.mark.asyncio
async def test_join_waitlist_duplicate(client: AsyncClient):
    await client.post("/api/waitlist", json={"email": "hello@example.com"})
    resp = await client.post("/api/waitlist", json={"email": "hello@example.com"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["already_registered"] is True


@pytest.mark.asyncio
async def test_join_waitlist_invalid_email(client: AsyncClient):
    resp = await client.post("/api/waitlist", json={"email": "not-an-email"})
    assert resp.status_code == 422
```

**Step 2: Run tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_waitlist_api.py -v`
Expected: 3 tests PASS

**Step 3: Run all tests to verify no regressions**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/tests/test_waitlist_api.py
git commit -m "test: add waitlist API tests"
```

---

### Task 5: Frontend Route Restructuring

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Update routes**

Change `App.tsx` to:

```tsx
import './styles/design-system.css'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DailyView } from './pages/DailyView'
import { SettingsPage } from './pages/SettingsPage'
import { LandingPage } from './pages/LandingPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      retry: 1,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/app" element={<DailyView />} />
          <Route path="/app/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
```

**Step 2: Update internal navigation links**

Search for any `navigate('/')` or `navigate('/settings')` or `Link to="/"` etc. in the frontend and update:
- `/` → `/app`
- `/settings` → `/app/settings`

Known locations:
- `frontend/src/pages/DailyView.tsx` — settings gear icon navigates to `/settings` → change to `/app/settings`
- `frontend/src/pages/SettingsPage.tsx` — back button navigates to `/` → change to `/app`

**Step 3: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/DailyView.tsx frontend/src/pages/SettingsPage.tsx
git commit -m "feat: restructure routes - dashboard to /app, root for landing"
```

---

### Task 6: Frontend Waitlist API Hook

**Files:**
- Create: `frontend/src/api/waitlist.ts`

**Step 1: Create the hook**

```typescript
// frontend/src/api/waitlist.ts
import { useMutation } from '@tanstack/react-query'
import { api } from './client'

interface WaitlistResponse {
  message: string
  already_registered: boolean
}

export function useJoinWaitlist() {
  return useMutation({
    mutationFn: async (email: string): Promise<WaitlistResponse> => {
      const { data } = await api.post('/waitlist', { email })
      return data
    },
  })
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/waitlist.ts
git commit -m "feat: add waitlist API hook"
```

---

### Task 7: Landing Page Component

**Files:**
- Create: `frontend/src/pages/LandingPage.tsx`

This is the main visual component. It contains:
1. The full-page light-themed layout
2. CSS/SVG cartoon teapot with animated steam
3. "tpot" title text
4. Inline email input + "tea please" button
5. Secondary "Sign in" text link (gray, no border)
6. Success/error state handling

**Step 1: Create LandingPage.tsx**

Build the component with:

- **Container**: Full viewport height, centered flex column, warm cream background (`#FFF8F0` or similar), no dependency on design-system.css dark theme
- **Teapot SVG**: Inline SVG of a rounded cartoon teapot with:
  - Round body in warm brown/terracotta
  - Curved spout and handle
  - Two rosy circle cheeks
  - Two dot eyes and a small smile arc
  - Lid on top with a small knob
  - CSS-animated steam wisps (3 wavy lines floating up from spout, using `@keyframes` with translateY + opacity)
- **Title**: "tpot" in a large (48-64px), rounded font-weight-700, warm brown color (`#8B4513` or similar)
- **Email row**: Horizontal flex row with:
  - Input field: rounded corners (24px radius), warm border, placeholder "your@email.com", ~300px wide
  - "tea please" button: rounded, warm golden/brown background (`#D4956A` or similar), white text, sits right next to input
- **Success state**: After submit, replace the email row with the response message text
- **"Sign in"** link: Below the email row, gray text (`#666`), no border, no background, `cursor: pointer`, navigates to `/app`
- **All styles inline** (consistent with existing codebase pattern — no CSS modules)

**Step 2: Verify TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/pages/LandingPage.tsx
git commit -m "feat: add landing page with teapot character and waitlist"
```

---

### Task 8: Caddy Auth Scoping

**Files:**
- Modify: `Caddyfile`

**Step 1: Update Caddyfile**

Change from `basicauth *` (everything) to only protect `/app/*`:

```caddyfile
{$DOMAIN:localhost} {
	# Protect dashboard routes with basic auth
	@app path /app /app/*
	basicauth @app {
		{$AUTH_USER} {$AUTH_PASS_HASH}
	}

	# API routes (must be before frontend catch-all)
	handle /api/* {
		reverse_proxy backend:8000
	}

	# Frontend (catch-all)
	handle {
		reverse_proxy frontend:3000
	}
}
```

This means:
- `/` (landing page) — public
- `/api/waitlist` — public (goes to backend, no Caddy auth)
- `/api/*` — public at Caddy level (backend handles its own auth if needed)
- `/app` and `/app/*` — protected by basic auth

**Step 2: Commit**

```bash
git add Caddyfile
git commit -m "feat: scope Caddy basic auth to /app/* only"
```

---

### Task 9: Update Extension URLs (if needed)

**Files:**
- Check: `extension/popup.js`, `extension/background.js`

**Step 1: Verify extension API calls**

The Chrome extension posts to `/api/tweets` etc. — these URLs haven't changed. Verify that no extension code navigates to `'/'` expecting the dashboard. If it does, update to `/app`.

This is likely a no-op since the extension only calls API endpoints, not frontend routes.

**Step 2: Commit if changes needed**

---

### Task 10: Update Alembic env.py Model Imports

**Files:**
- Modify: `backend/alembic/env.py`

**Step 1: Add WaitlistEntry to imports**

Update line 21 in `backend/alembic/env.py`:

```python
from app.models import Tweet, Topic, Category, TweetAssignment  # noqa: E402, F401
from app.models.waitlist import WaitlistEntry  # noqa: E402, F401
```

**Step 2: Commit**

```bash
git add backend/alembic/env.py
git commit -m "chore: add WaitlistEntry to alembic model imports"
```

---

### Task 11: Final Verification

**Step 1: Run all backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All tests pass

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Visual check**

Run: `docker compose up` and verify:
- `localhost/` shows the landing page (no auth prompt)
- Email submit works and shows success message
- "Sign in" link navigates to `/app` and triggers auth
- `/app` shows the dashboard as before
- `/app/settings` works as before
