# Cookie-Gated Admin Access

Public read-only dashboard with cookie-based admin authentication for editing.

## Requirements

- Viewers: public read-only access to the full dashboard (same layout, edit controls hidden)
- Admin: full editing access via secret URL param that sets a secure cookie
- Chrome extension authenticates as admin via header
- No user identity, no reactions, no paywall (all deferred to future work)
- Backend enforces all permissions; frontend only hides UI elements

## Backend

### New env var

`ADMIN_SECRET` — long random string (32+ chars). Required in production.

### New endpoints

**`GET /api/auth/admin?key=<secret>`**
- Validates `key` against `ADMIN_SECRET` env var
- Sets httpOnly + Secure + SameSite=Lax cookie (`tpot_admin=<hmac_signed_value>`)
- Returns `{"role": "admin"}`
- Rate-limited (5 attempts per minute per IP) to prevent brute-force

**`GET /api/auth/me`**
- Checks admin cookie → returns `{"role": "admin"}` or `{"role": "viewer"}`

**`POST /api/auth/logout`**
- Clears the admin cookie
- Returns `{"role": "viewer"}`

### New dependency: `require_admin`

FastAPI dependency applied to all mutating routes (POST, PATCH, DELETE) except:
- `POST /api/auth/admin` (the login endpoint itself)
- `GET /api/health`
- `GET /api/auth/me`

Checks for valid admin cookie OR `X-Admin-Key` header (for extension/API clients).
Returns 403 Forbidden if neither is present or valid.

### Cookie security

- **HMAC-signed** with `ADMIN_SECRET` as key (prevents forgery)
- **httpOnly** (invisible to JavaScript, prevents XSS theft)
- **Secure** flag (only sent over HTTPS; disabled in dev)
- **SameSite=Lax** (prevents CSRF; Lax allows navigation from bookmarks)

### Extension auth

`background.js` updated to send `X-Admin-Key: <secret>` header on all API calls.
The admin key is configured in the extension popup alongside the backend URL.

## Frontend

### AuthContext

New React context providing `{role: "admin" | "viewer"}` to the app.
- Calls `GET /api/auth/me` on mount
- Defaults to `"viewer"` while loading (safe default)
- Components use `useAuth()` hook to check role

### Hidden for viewers

- Drag handles on tweet cards (drag-and-drop disabled)
- Right-click context menu (no assign/delete/move actions)
- "Create Topic" form
- Delete buttons on topics
- Topic title inline editing
- Memo editing on tweets
- AssignDropdown
- Script generation/editing UI
- Settings page (admin-only route)

### Kept for viewers

- Navigation keyboard shortcuts (h/l/j/k/arrows, Enter, Shift+Enter)
- Search (Cmd+K)
- Keyboard shortcuts help (?)
- TOC toggle (t)
- Date carousel navigation
- Clicking tweets to open on X
- Reading tweet cards, topic sections, categories

### Implementation approach

Components check `useAuth().role === "admin"` before rendering edit controls.
No new components — just conditional rendering in existing ones.

## Security summary

| Threat | Mitigation |
|--------|-----------|
| Brute-force admin key | Rate limiting on auth endpoint |
| Cookie forgery | HMAC signing with server secret |
| XSS cookie theft | httpOnly flag |
| CSRF attacks | SameSite=Lax |
| Frontend role spoofing | Backend enforces on all mutations (403) |
| Sniffing cookie over HTTP | Secure flag (HTTPS via Caddy) |

## Out of scope (future work)

- User identity / accounts
- Reactions on tweets
- Paywall for recent days
- OAuth / magic link auth
- Multiple admin accounts
