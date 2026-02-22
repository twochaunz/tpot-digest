# tpot Landing Page Design

## Problem

tpot.wonchan.com currently drops visitors straight into a Caddy basic auth prompt. There's no public-facing page. We need a landing page that introduces tpot, collects waitlist signups, and provides a secondary sign-in path for existing users.

## Design

### Visual Style

Disney-cartoon-esque, light theme. Warm cream/off-white background with subtle gradient. Playful, whimsical, inviting.

### Layout (centered, top to bottom)

1. **Teapot character** (CSS/SVG) — cartoon teapot with rosy cheeks, big eyes, little smile. Animated steam wisps rising from the spout.
2. **"tpot"** — large, rounded, playful font in warm brown/deep tea color.
3. **Email input + "tea please" button** — inline row. Rounded input field for email, "tea please" button in warm inviting color (tea-brown or golden). This is the primary CTA.
4. **"Sign in"** — plain text link below, gray/dark gray, no border, no background. Clearly secondary. Navigates to `/app` which triggers Caddy basic auth.

### Animations

- Gentle steam floating up from teapot spout (CSS keyframes)
- Subtle teapot wobble on hover
- Optional sparkles/stars

### Waitlist Flow

1. User types email, clicks "tea please"
2. POST to `/api/waitlist` with the email
3. Success: input area transforms to a thank-you message
4. Duplicate email: friendly "You're already on the list!" message

## Technical Architecture

### Routing Changes

- `/` — `LandingPage.tsx` (public, no auth)
- `/app` — `DailyView.tsx` (existing dashboard, protected by Caddy basic auth)
- `/app/settings` — `SettingsPage.tsx` (existing settings, protected)

### Caddy Changes

- Basic auth only on `/app/*` paths instead of `*`
- `/api/waitlist` endpoint is public (no auth)
- `/api/health` remains public

### Backend

- New `waitlist` table: `id`, `email` (unique), `created_at`
- New model: `backend/app/models/waitlist.py`
- New router: `backend/app/routers/waitlist.py` — `POST /api/waitlist`
- New schema: `backend/app/schemas/waitlist.py`
- Alembic migration for the new table

### Frontend

- New page: `frontend/src/pages/LandingPage.tsx`
- New CSS: light theme styles scoped to the landing page (does not touch existing dark dashboard CSS)
- SVG teapot character built inline or as a component
- Route changes in `App.tsx`: `/` -> LandingPage, `/app` -> DailyView, `/app/settings` -> SettingsPage
- New API hook: `useJoinWaitlist()` mutation

### What Does NOT Change

- Existing dashboard stays dark theme
- Caddy basic auth mechanism stays the same (just scoped to `/app/*`)
- Extension continues posting to `/api/tweets` as before
- All existing functionality untouched
