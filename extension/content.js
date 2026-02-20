(function () {
  "use strict";
  if (window.__tpotDigestV2) return;
  window.__tpotDigestV2 = true;

  // ── Utilities ──────────────────────────────────────────────────────

  function parseCount(text) {
    if (!text) return 0;
    text = text.trim().replace(/,/g, "");
    const upper = text.toUpperCase();
    if (upper.endsWith("K")) return Math.round(parseFloat(text) * 1000);
    if (upper.endsWith("M")) return Math.round(parseFloat(text) * 1000000);
    return parseInt(text, 10) || 0;
  }

  function detectFeedSource() {
    const path = window.location.pathname;
    if (path === "/home" || path === "/") return "for_you";
    if (path.includes("/following")) return "following";
    if (path.includes("/search")) return "search";
    if (path.includes("/status/")) return "thread";
    return "profile";
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp);
      });
    });
  }

  // ── Tweet Data Extraction ──────────────────────────────────────────

  function extractTweetData(article) {
    const timeLink = article.querySelector('a[href*="/status/"]');
    const href = timeLink ? timeLink.getAttribute("href") : "";
    const idMatch = href.match(/status\/(\d+)/);
    const tweetId = idMatch ? idMatch[1] : "";

    const handleEl = article.querySelector('div[data-testid="User-Name"] a[href^="/"]');
    const authorHandle = handleEl ? handleEl.getAttribute("href").replace("/", "") : "";

    const nameEl = article.querySelector('div[data-testid="User-Name"] span');
    const authorDisplayName = nameEl ? nameEl.textContent : "";

    const textEl = article.querySelector('div[data-testid="tweetText"]');
    const text = textEl ? textEl.textContent : "";

    const mediaEls = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
    const mediaUrls = Array.from(mediaEls).map((el) => el.src);

    const likesEl = article.querySelector('button[data-testid="like"] span');
    const retweetsEl = article.querySelector('button[data-testid="retweet"] span');
    const repliesEl = article.querySelector('button[data-testid="reply"] span');

    const isQuoteTweet = !!article.querySelector('div[role="link"][tabindex="0"]');

    // Thread detection: check if viewing a thread page
    const threadMatch = window.location.pathname.match(/\/status\/(\d+)/);
    const threadId = threadMatch && detectFeedSource() === "thread" ? threadMatch[1] : null;

    return {
      tweet_id: tweetId,
      author_handle: authorHandle,
      author_display_name: authorDisplayName,
      text: text,
      media_urls: mediaUrls.length > 0 ? mediaUrls : null,
      engagement: {
        likes: parseCount(likesEl ? likesEl.textContent : "0"),
        retweets: parseCount(retweetsEl ? retweetsEl.textContent : "0"),
        replies: parseCount(repliesEl ? repliesEl.textContent : "0"),
      },
      is_quote_tweet: isQuoteTweet,
      is_reply: false,
      thread_id: threadId,
      feed_source: detectFeedSource(),
    };
  }

  // ── Toast (errors and duplicates only) ─────────────────────────────

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

  // ── Action Card ────────────────────────────────────────────────────

  async function showActionCard(tweetDbId, authorHandle) {
    const existing = document.querySelector(".tpot-action-card");
    if (existing) existing.remove();
    const existingToast = document.querySelector(".tpot-toast");
    if (existingToast) existingToast.remove();

    const today = new Date().toISOString().slice(0, 10);
    const [topicsResp, catsResp] = await Promise.all([
      sendMessage({ type: "GET_TOPICS", date: today }),
      sendMessage({ type: "GET_CATEGORIES" }),
    ]);
    const topics = (topicsResp && topicsResp.topics) || [];
    const categories = (catsResp && catsResp.categories) || [];

    const card = document.createElement("div");
    card.className = "tpot-action-card";

    // Dismiss on click outside
    function onClickOutside(e) {
      if (!card.contains(e.target)) {
        card.remove();
        document.removeEventListener("mousedown", onClickOutside, true);
      }
    }
    setTimeout(() => document.addEventListener("mousedown", onClickOutside, true), 0);

    // Header
    const header = document.createElement("div");
    header.className = "tpot-ac-header";
    header.textContent = "\u2713 Saved @" + authorHandle;
    card.appendChild(header);

    // Topic select
    const topicLabel = document.createElement("label");
    topicLabel.textContent = "Topic";
    card.appendChild(topicLabel);

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

    const catContainer = document.createElement("div");
    const catSelect = document.createElement("select");
    catSelect.innerHTML = '<option value="">—</option>';
    categories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      catSelect.appendChild(opt);
    });
    const newCatOpt = document.createElement("option");
    newCatOpt.value = "__new__";
    newCatOpt.textContent = "+ New category\u2026";
    catSelect.appendChild(newCatOpt);
    catContainer.appendChild(catSelect);

    const newCatInput = document.createElement("input");
    newCatInput.type = "text";
    newCatInput.placeholder = "Category name";
    newCatInput.style.display = "none";
    catContainer.appendChild(newCatInput);

    catSelect.addEventListener("change", () => {
      if (catSelect.value === "__new__") {
        catSelect.style.display = "none";
        newCatInput.style.display = "";
        newCatInput.focus();
      }
    });
    card.appendChild(catContainer);

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
    dismissBtn.addEventListener("click", () => {
      card.remove();
      document.removeEventListener("mousedown", onClickOutside, true);
    });
    actions.appendChild(dismissBtn);

    const assignBtn = document.createElement("button");
    assignBtn.className = "tpot-ac-btn primary";
    assignBtn.textContent = "Assign";
    assignBtn.addEventListener("click", async () => {
      assignBtn.disabled = true;
      assignBtn.textContent = "Saving\u2026";

      try {
        let topicId = topicSelect.value;

        if (topicSelect.style.display === "none" && newTopicInput.value.trim()) {
          const createResp = await sendMessage({
            type: "CREATE_TOPIC",
            topic: { title: newTopicInput.value.trim(), date: dateInput.value },
          });
          if (createResp.error) throw new Error(createResp.error);
          topicId = String(createResp.topic.id);
        }

        let catId = catSelect.value ? Number(catSelect.value) : null;

        if (catSelect.style.display === "none" && newCatInput.value.trim()) {
          const createResp = await sendMessage({
            type: "CREATE_CATEGORY",
            category: { name: newCatInput.value.trim() },
          });
          if (createResp.error) throw new Error(createResp.error);
          catId = createResp.category.id;
        }

        const updates = {};
        if (memoInput.value.trim()) updates.memo = memoInput.value.trim();
        if (dateInput.value !== today) updates.saved_at = dateInput.value + "T00:00:00Z";
        if (Object.keys(updates).length > 0) {
          await sendMessage({ type: "UPDATE_TWEET", tweetDbId: tweetDbId, updates });
        }

        if (topicId && topicId !== "" && topicId !== "__new__") {
          await sendMessage({
            type: "ASSIGN_TWEET",
            assignment: { tweet_ids: [tweetDbId], topic_id: Number(topicId), category_id: catId },
          });
        }

        header.textContent = "\u2713 Assigned!";
        document.removeEventListener("mousedown", onClickOutside, true);
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
  }

  // ── Save Handler ───────────────────────────────────────────────────

  async function handleSave(button, article) {
    if (button.classList.contains("saved") || button.classList.contains("saving")) return;
    button.classList.add("saving");

    try {
      const tweetData = extractTweetData(article);
      if (!tweetData.tweet_id) throw new Error("Could not extract tweet ID");

      // Request screenshot from service worker (exclude action bar with engagement icons)
      const rect = article.getBoundingClientRect();
      const actionBar = article.querySelector('div[role="group"]');
      const cropHeight = actionBar
        ? actionBar.getBoundingClientRect().top - rect.top
        : rect.height;
      const screenshotResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "CAPTURE_SCREENSHOT",
          rect: { x: rect.x, y: rect.y, width: rect.width, height: cropHeight },
          dpr: window.devicePixelRatio || 1,
        }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(resp);
        });
      });

      const screenshot = screenshotResp && screenshotResp.screenshot
        ? screenshotResp.screenshot
        : null;
      const screenshotError = screenshotResp && screenshotResp.error
        ? screenshotResp.error
        : null;

      // Save tweet via service worker
      const tweetPayload = { ...tweetData };
      if (screenshot) tweetPayload.screenshot_base64 = screenshot;
      if (screenshotError) tweetPayload.screenshot_error = screenshotError;
      const saveResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "SAVE_TWEET",
          tweet: tweetPayload,
        }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(resp);
        });
      });

      if (saveResp && saveResp.error) throw new Error(saveResp.error);

      button.classList.remove("saving");
      button.classList.add("saved");

      if (saveResp && saveResp.status === "duplicate") {
        showToast("Tweet already saved — @" + tweetData.author_handle, false);
      } else {
        showActionCard(saveResp.id, tweetData.author_handle);
      }
    } catch (err) {
      button.classList.remove("saving");
      showToast("Save failed: " + err.message, true);
    }
  }

  // ── Button Injection ───────────────────────────────────────────────

  function injectSaveButton(article) {
    if (article.querySelector(".tpot-save-btn")) return;

    // Find the action bar (reply, retweet, like, bookmark, share)
    const actionBar = article.querySelector('div[role="group"]');
    if (!actionBar) return;

    // Find bookmark button to insert our save button before it
    const bookmarkBtn = actionBar.querySelector('button[data-testid="bookmark"]');

    const wrapper = document.createElement("div");
    wrapper.className = "tpot-save-wrapper";

    const btn = document.createElement("button");
    btn.className = "tpot-save-btn";
    btn.title = "Save to tpot-digest";

    // Block ALL events from reaching Twitter's navigation handlers
    const block = (e) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    ["pointerdown", "pointerup", "mousedown", "mouseup"].forEach((type) => {
      btn.addEventListener(type, block, true);
      wrapper.addEventListener(type, block, true);
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleSave(btn, article);
    });

    wrapper.appendChild(btn);

    if (bookmarkBtn) {
      // Walk up from the bookmark button to find the direct child of the action bar
      let container = bookmarkBtn;
      while (container.parentElement && container.parentElement !== actionBar) {
        container = container.parentElement;
      }
      actionBar.insertBefore(wrapper, container);
    } else {
      actionBar.appendChild(wrapper);
    }
  }

  // ── Observer ───────────────────────────────────────────────────────

  function scan() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(injectSaveButton);
  }

  new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
  scan();
})();
