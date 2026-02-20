# Post-Save Action Card Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 3-second toast with an action card that lets users assign topic, category, date, and memo inline after saving a tweet.

**Architecture:** Backend gets a `memo` column, a PATCH endpoint for updating tweets, and the `save_tweet` handler passes memo through. Extension service worker gets new message types for fetching topics/categories and assigning tweets. Content script replaces the success toast with a DOM-built action card that auto-dismisses in 3s unless hovered.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), Chrome Extension Manifest V3 (content script + service worker), vanilla JS/CSS (no frameworks in extension).

---

### Task 1: Backend — Add memo column and migration

**Files:**
- Modify: `backend/app/models/tweet.py:29` (add memo column after feed_source)
- Modify: `backend/app/schemas/tweet.py:22` (add memo to TweetSave)
- Modify: `backend/app/schemas/tweet.py:43` (add memo to TweetOut)
- Modify: `backend/app/routers/tweets.py:43-58` (pass memo to Tweet constructor)
- Create: `backend/alembic/versions/002_add_memo.py`

**Step 1: Write failing test**

Add to `backend/tests/test_tweets_api.py`:

```python
@pytest.mark.asyncio
async def test_save_tweet_with_memo(client: AsyncClient):
    payload = {
        "tweet_id": "memo1",
        "author_handle": "test",
        "text": "test tweet",
        "screenshot_base64": TINY_PNG,
        "memo": "great example of AI hype",
    }
    resp = await client.post("/api/tweets", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["memo"] == "great example of AI hype"
```

**Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py::test_save_tweet_with_memo -v`
Expected: FAIL (memo field not recognized)

**Step 3: Implement**

Add to `backend/app/models/tweet.py` after line 28 (feed_source):
```python
    memo: Mapped[str | None] = mapped_column(Text)
```

Add to `backend/app/schemas/tweet.py` TweetSave (after screenshot_error):
```python
    memo: str | None = None
```

Add to `backend/app/schemas/tweet.py` TweetOut (after feed_source):
```python
    memo: str | None
```

In `backend/app/routers/tweets.py` save_tweet, add `memo=body.memo` to the Tweet constructor.

Create `backend/alembic/versions/002_add_memo.py`:
```python
"""add memo column to tweets

Revision ID: 002_memo
Revises: 001_v2
Create Date: 2026-02-20
"""
from alembic import op
import sqlalchemy as sa

revision = "002_memo"
down_revision = "001_v2"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("tweets", sa.Column("memo", sa.Text()))

def downgrade() -> None:
    op.drop_column("tweets", "memo")
```

**Step 4: Run test to verify it passes**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py::test_save_tweet_with_memo -v`
Expected: PASS

**Step 5: Run full test suite**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All pass

**Step 6: Commit**

```bash
git add backend/app/models/tweet.py backend/app/schemas/tweet.py backend/app/routers/tweets.py backend/alembic/versions/002_add_memo.py backend/tests/test_tweets_api.py
git commit -m "feat: add memo field to tweets"
```

---

### Task 2: Backend — Add PATCH /api/tweets/{id} endpoint

**Files:**
- Modify: `backend/app/schemas/tweet.py` (add TweetUpdate schema)
- Modify: `backend/app/routers/tweets.py` (add PATCH endpoint)
- Modify: `backend/tests/test_tweets_api.py` (add tests)

**Step 1: Write failing tests**

Add to `backend/tests/test_tweets_api.py`:

```python
@pytest.mark.asyncio
async def test_patch_tweet_memo(client: AsyncClient):
    await client.post("/api/tweets", json={
        "tweet_id": "patch1",
        "author_handle": "test",
        "text": "test",
        "screenshot_base64": TINY_PNG,
    })
    tweets = (await client.get("/api/tweets")).json()
    tid = tweets[0]["id"]

    resp = await client.patch(f"/api/tweets/{tid}", json={"memo": "use as opener"})
    assert resp.status_code == 200
    assert resp.json()["memo"] == "use as opener"


@pytest.mark.asyncio
async def test_patch_tweet_saved_at(client: AsyncClient):
    await client.post("/api/tweets", json={
        "tweet_id": "patch2",
        "author_handle": "test",
        "text": "test",
        "screenshot_base64": TINY_PNG,
    })
    tweets = (await client.get("/api/tweets")).json()
    tid = tweets[0]["id"]

    resp = await client.patch(f"/api/tweets/{tid}", json={"saved_at": "2026-02-18T12:00:00Z"})
    assert resp.status_code == 200
    assert "2026-02-18" in resp.json()["saved_at"]
```

**Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py::test_patch_tweet_memo -v`
Expected: FAIL (404, no PATCH route)

**Step 3: Implement**

Add to `backend/app/schemas/tweet.py`:
```python
class TweetUpdate(BaseModel):
    memo: str | None = None
    saved_at: datetime | None = None
```

Add to `backend/app/routers/tweets.py` (after delete_tweet, before assign_tweets):
```python
from app.schemas.tweet import TweetAssignRequest, TweetOut, TweetSave, TweetUnassignRequest, TweetUpdate

@router.patch("/{tweet_id}", response_model=TweetOut)
async def update_tweet(tweet_id: int, body: TweetUpdate, db: AsyncSession = Depends(get_db)):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(tweet, field, value)
    await db.commit()
    await db.refresh(tweet)
    return tweet
```

Update the import line at top of tweets.py to include TweetUpdate.

**Step 4: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py -v`
Expected: All pass

**Step 5: Run full test suite**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All pass

**Step 6: Commit**

```bash
git add backend/app/schemas/tweet.py backend/app/routers/tweets.py backend/tests/test_tweets_api.py
git commit -m "feat: add PATCH /api/tweets/{id} for memo and saved_at"
```

---

### Task 3: Extension — Service worker message handlers

**Files:**
- Modify: `extension/background.js` (add GET_TOPICS, GET_CATEGORIES, CREATE_TOPIC, UPDATE_TWEET, ASSIGN_TWEET handlers + register in listener)

**Step 1: Add handler functions to `extension/background.js`**

Add before the `chrome.runtime.onMessage.addListener` block:

```javascript
async function handleGetTopics(message) {
  const config = await getConfig();
  const dateStr = message.date || new Date().toISOString().slice(0, 10);
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/topics?date=" + dateStr;
  try {
    const resp = await fetch(url, { headers: authHeaders(config) });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    return { topics: await resp.json() };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleGetCategories() {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/categories";
  try {
    const resp = await fetch(url, { headers: authHeaders(config) });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    return { categories: await resp.json() };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleCreateTopic(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/topics";
  const headers = { "Content-Type": "application/json", ...authHeaders(config) };
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(message.topic) });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    return { topic: await resp.json() };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleAssignTweet(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/tweets/assign";
  const headers = { "Content-Type": "application/json", ...authHeaders(config) };
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(message.assignment) });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function handleUpdateTweet(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/tweets/" + message.tweetDbId;
  const headers = { "Content-Type": "application/json", ...authHeaders(config) };
  try {
    const resp = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(message.updates) });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}
```

**Step 2: Register new handlers in the message listener**

Update the `chrome.runtime.onMessage.addListener` block to add:

```javascript
  if (message.type === "GET_TOPICS") { handleGetTopics(message).then(sendResponse); return true; }
  if (message.type === "GET_CATEGORIES") { handleGetCategories().then(sendResponse); return true; }
  if (message.type === "CREATE_TOPIC") { handleCreateTopic(message).then(sendResponse); return true; }
  if (message.type === "ASSIGN_TWEET") { handleAssignTweet(message).then(sendResponse); return true; }
  if (message.type === "UPDATE_TWEET") { handleUpdateTweet(message).then(sendResponse); return true; }
```

**Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: service worker handlers for topics, categories, assign, update"
```

---

### Task 4: Extension — Action card CSS

**Files:**
- Modify: `extension/content.css` (move toast to top-right, add action card styles)

**Step 1: Update toast position and add action card styles**

Change `.tpot-toast` position from `bottom: 24px` to `top: 24px`. Change slide animation from `translateY(20px)` to `translateY(-20px)`.

Add action card styles after the toast styles:

```css
.tpot-action-card {
  position: fixed;
  top: 24px;
  right: 24px;
  width: 280px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #1a1a2e;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  z-index: 100000;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  border-left: 3px solid #22c55e;
  animation: tpot-slide-down 0.25s ease-out;
}

.tpot-action-card .tpot-ac-header {
  font-size: 13px;
  font-weight: 600;
  color: #22c55e;
  margin-bottom: 10px;
}

.tpot-action-card label {
  display: block;
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 3px;
  margin-top: 8px;
}

.tpot-action-card label:first-of-type {
  margin-top: 0;
}

.tpot-action-card select,
.tpot-action-card input[type="date"],
.tpot-action-card input[type="text"],
.tpot-action-card textarea {
  width: 100%;
  padding: 6px 8px;
  border-radius: 5px;
  border: 1px solid #334155;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}

.tpot-action-card select:focus,
.tpot-action-card input:focus,
.tpot-action-card textarea:focus {
  border-color: #6366f1;
}

.tpot-action-card textarea {
  resize: none;
  height: 48px;
}

.tpot-action-card .tpot-ac-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.tpot-action-card .tpot-ac-btn {
  padding: 5px 14px;
  border-radius: 5px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}

.tpot-action-card .tpot-ac-btn.primary {
  background: #6366f1;
  color: #fff;
}

.tpot-action-card .tpot-ac-btn.primary:hover {
  background: #818cf8;
}

.tpot-action-card .tpot-ac-btn.secondary {
  background: transparent;
  color: #94a3b8;
}

.tpot-action-card .tpot-ac-btn.secondary:hover {
  color: #e2e8f0;
}

@keyframes tpot-slide-down {
  from { transform: translateY(-20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

**Step 2: Commit**

```bash
git add extension/content.css
git commit -m "feat: action card and top-right toast CSS"
```

---

### Task 5: Extension — Action card content script logic

**Files:**
- Modify: `extension/content.js` (replace showToast success path with showActionCard, keep showToast for errors)

**Step 1: Add helper to send messages to service worker**

Add after the `detectFeedSource` function (after line 24):

```javascript
  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp);
      });
    });
  }
```

**Step 2: Add showActionCard function**

Replace the `showToast` function (lines 76-86) with both `showToast` (for errors only, moved to top-right) and `showActionCard`:

```javascript
  function showToast(message, isError) {
    const existing = document.querySelector(".tpot-toast");
    if (existing) existing.remove();
    const existing2 = document.querySelector(".tpot-action-card");
    if (existing2) existing2.remove();

    const toast = document.createElement("div");
    toast.className = "tpot-toast " + (isError ? "error" : "success");
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
  }

  async function showActionCard(tweetDbId, authorHandle) {
    // Remove any existing card/toast
    const existing = document.querySelector(".tpot-action-card");
    if (existing) existing.remove();
    const existingToast = document.querySelector(".tpot-toast");
    if (existingToast) existingToast.remove();

    // Fetch topics and categories in parallel
    const today = new Date().toISOString().slice(0, 10);
    const [topicsResp, catsResp] = await Promise.all([
      sendMessage({ type: "GET_TOPICS", date: today }),
      sendMessage({ type: "GET_CATEGORIES" }),
    ]);
    const topics = (topicsResp && topicsResp.topics) || [];
    const categories = (catsResp && catsResp.categories) || [];

    // Build card
    const card = document.createElement("div");
    card.className = "tpot-action-card";

    // Auto-dismiss timer
    let timer = null;
    function startTimer() {
      clearTimeout(timer);
      timer = setTimeout(() => { if (card.parentNode) card.remove(); }, 3000);
    }
    function pauseTimer() { clearTimeout(timer); }
    card.addEventListener("mouseenter", pauseTimer);
    card.addEventListener("mouseleave", startTimer);
    card.addEventListener("focusin", pauseTimer);
    card.addEventListener("focusout", (e) => {
      if (!card.contains(e.relatedTarget)) startTimer();
    });

    // Header
    const header = document.createElement("div");
    header.className = "tpot-ac-header";
    header.textContent = "\u2713 Saved @" + authorHandle;
    card.appendChild(header);

    // Topic select
    const topicLabel = document.createElement("label");
    topicLabel.textContent = "Topic";
    card.appendChild(topicLabel);

    // Container for select OR inline input
    const topicContainer = document.createElement("div");
    const topicSelect = document.createElement("select");
    topicSelect.innerHTML = '<option value="">—</option>';
    topics.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.title;
      topicSelect.appendChild(opt);
    });
    const newOpt = document.createElement("option");
    newOpt.value = "__new__";
    newOpt.textContent = "+ New topic\u2026";
    topicSelect.appendChild(newOpt);
    topicContainer.appendChild(topicSelect);

    // Hidden inline input for new topic
    const newTopicInput = document.createElement("input");
    newTopicInput.type = "text";
    newTopicInput.placeholder = "Topic name";
    newTopicInput.style.display = "none";
    topicContainer.appendChild(newTopicInput);

    topicSelect.addEventListener("change", () => {
      if (topicSelect.value === "__new__") {
        topicSelect.style.display = "none";
        newTopicInput.style.display = "";
        newTopicInput.focus();
      }
    });
    card.appendChild(topicContainer);

    // Category select
    const catLabel = document.createElement("label");
    catLabel.textContent = "Category";
    card.appendChild(catLabel);
    const catSelect = document.createElement("select");
    catSelect.innerHTML = '<option value="">—</option>';
    categories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      catSelect.appendChild(opt);
    });
    card.appendChild(catSelect);

    // Date
    const dateLabel = document.createElement("label");
    dateLabel.textContent = "Date";
    card.appendChild(dateLabel);
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = today;
    card.appendChild(dateInput);

    // Memo
    const memoLabel = document.createElement("label");
    memoLabel.textContent = "Memo";
    card.appendChild(memoLabel);
    const memoInput = document.createElement("textarea");
    memoInput.placeholder = "Optional notes\u2026";
    card.appendChild(memoInput);

    // Actions
    const actions = document.createElement("div");
    actions.className = "tpot-ac-actions";

    const dismissBtn = document.createElement("button");
    dismissBtn.className = "tpot-ac-btn secondary";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.addEventListener("click", () => card.remove());
    actions.appendChild(dismissBtn);

    const assignBtn = document.createElement("button");
    assignBtn.className = "tpot-ac-btn primary";
    assignBtn.textContent = "Assign";
    assignBtn.addEventListener("click", async () => {
      assignBtn.disabled = true;
      assignBtn.textContent = "Saving\u2026";
      pauseTimer();

      try {
        let topicId = topicSelect.value;

        // Create new topic if needed
        if (topicSelect.style.display === "none" && newTopicInput.value.trim()) {
          const createResp = await sendMessage({
            type: "CREATE_TOPIC",
            topic: { title: newTopicInput.value.trim(), date: dateInput.value },
          });
          if (createResp.error) throw new Error(createResp.error);
          topicId = String(createResp.topic.id);
        }

        // Update memo and/or date if changed
        const updates = {};
        if (memoInput.value.trim()) updates.memo = memoInput.value.trim();
        if (dateInput.value !== today) updates.saved_at = dateInput.value + "T00:00:00Z";
        if (Object.keys(updates).length > 0) {
          await sendMessage({ type: "UPDATE_TWEET", tweetDbId: tweetDbId, updates });
        }

        // Assign to topic if selected
        if (topicId && topicId !== "" && topicId !== "__new__") {
          const catId = catSelect.value ? Number(catSelect.value) : null;
          await sendMessage({
            type: "ASSIGN_TWEET",
            assignment: { tweet_ids: [tweetDbId], topic_id: Number(topicId), category_id: catId },
          });
        }

        // Show brief confirmation
        header.textContent = "\u2713 Assigned!";
        setTimeout(() => { if (card.parentNode) card.remove(); }, 800);
      } catch (err) {
        assignBtn.textContent = "Error";
        assignBtn.disabled = false;
        setTimeout(() => { assignBtn.textContent = "Assign"; }, 1500);
      }
    });
    actions.appendChild(assignBtn);
    card.appendChild(actions);

    document.body.appendChild(card);
    startTimer();
  }
```

**Step 3: Update handleSave to use showActionCard**

In `handleSave`, replace lines 138-142 (the success path after `button.classList.add("saved")`) with:

```javascript
      button.classList.remove("saving");
      button.classList.add("saved");

      if (saveResp && saveResp.status === "duplicate") {
        showToast("Tweet already saved — @" + tweetData.author_handle, false);
      } else {
        showActionCard(saveResp.id, tweetData.author_handle);
      }
```

This shows the action card for new saves, and a simple toast for duplicates.

**Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat: post-save action card with topic, category, date, memo"
```

---

### Task 6: Deploy and test end-to-end

**Step 1: Run backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All pass

**Step 2: Push and deploy**

```bash
git push
./scripts/deploy.sh root@46.225.9.10
```

**Step 3: Run migration on production**

```bash
ssh -i ~/wk_clawd root@46.225.9.10 "cd ~/tpot-digest && docker compose -f docker-compose.prod.yml exec backend alembic upgrade head"
```

**Step 4: Reload extension and test**

1. Reload extension in chrome://extensions
2. Save a tweet on Twitter/X
3. Verify action card appears top-right with topic, category, date, memo fields
4. Verify auto-dismiss after 3s without interaction
5. Verify hover pauses the timer
6. Test assigning with existing topic
7. Test creating a new topic inline
8. Test adding a memo
9. Test changing the date
10. Verify dashboard shows the assignment and memo correctly

**Step 5: Final commit**

```bash
git add -A && git commit -m "feat: post-save action card — complete"
```
