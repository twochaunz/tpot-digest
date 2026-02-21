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

    const tweetUrl = tweetId && authorHandle
      ? "https://x.com/" + authorHandle + "/status/" + tweetId
      : null;

    return {
      tweet_id: tweetId,
      author_handle: authorHandle,
      author_display_name: authorDisplayName,
      text: text,
      url: tweetUrl,
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

  function extractPostedDate(article) {
    const timeEl = article ? article.querySelector("time[datetime]") : null;
    if (!timeEl) return null;
    const dt = new Date(timeEl.getAttribute("datetime"));
    if (isNaN(dt.getTime())) return null;
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }

  function toLocalDateStr(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  async function loadTopicsForDate(dateStr, topicSelect, newTopicInput) {
    // Reset select, keep "—" and "+ New topic"
    const prevValue = topicSelect.value;
    topicSelect.innerHTML = '<option value="">\u2014</option>';
    const resp = await sendMessage({ type: "GET_TOPICS", date: dateStr });
    const topics = (resp && resp.topics) || [];
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
    // Restore previous selection if it still exists, else reset
    if (prevValue && topicSelect.querySelector('option[value="' + prevValue + '"]')) {
      topicSelect.value = prevValue;
    } else {
      topicSelect.value = "";
      topicSelect.style.display = "";
      newTopicInput.style.display = "none";
    }
  }

  async function showActionCard(tweetDbId, authorHandle, article) {
    const existing = document.querySelector(".tpot-action-card");
    if (existing) existing.remove();
    const existingToast = document.querySelector(".tpot-toast");
    if (existingToast) existingToast.remove();

    const today = toLocalDateStr(new Date());
    const postedDate = extractPostedDate(article);
    let usePostedDate = !!postedDate && postedDate !== today;
    const activeDate = usePostedDate ? postedDate : today;

    const [topicsResp, catsResp] = await Promise.all([
      sendMessage({ type: "GET_TOPICS", date: activeDate }),
      sendMessage({ type: "GET_CATEGORIES" }),
    ]);
    let topics = (topicsResp && topicsResp.topics) || [];
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
    topicSelect.innerHTML = '<option value="">\u2014</option>';
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

    // Category combobox
    const catLabel = document.createElement("label");
    catLabel.textContent = "Category";
    card.appendChild(catLabel);

    const catContainer = document.createElement("div");
    catContainer.style.position = "relative";

    // Hidden fields to track selection
    let selectedCatId = null;
    let selectedCatName = "";

    const catInput = document.createElement("input");
    catInput.type = "text";
    catInput.placeholder = categories.length > 0 ? "Search or create category\u2026" : "Type a category name\u2026";
    catInput.autocomplete = "off";
    catContainer.appendChild(catInput);

    const catDropdown = document.createElement("div");
    catDropdown.className = "tpot-cat-dropdown";
    catDropdown.style.cssText = "display:none;position:absolute;left:0;right:0;top:100%;background:#1a1a2e;border:1px solid #3a3a5c;border-radius:6px;max-height:160px;overflow-y:auto;z-index:999;margin-top:2px;";
    catContainer.appendChild(catDropdown);

    function renderCatDropdown(query) {
      catDropdown.innerHTML = "";
      const q = (query || "").trim().toLowerCase();
      const matches = categories.filter((c) => !q || c.name.toLowerCase().includes(q));
      const exactMatch = categories.some((c) => c.name.toLowerCase() === q);

      matches.forEach((c) => {
        const item = document.createElement("div");
        item.textContent = c.name;
        item.style.cssText = "padding:6px 10px;cursor:pointer;font-size:13px;color:#e0e0e0;";
        item.addEventListener("mouseenter", () => { item.style.background = "#2a2a4a"; });
        item.addEventListener("mouseleave", () => { item.style.background = ""; });
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectedCatId = c.id;
          selectedCatName = c.name;
          catInput.value = c.name;
          catDropdown.style.display = "none";
        });
        catDropdown.appendChild(item);
      });

      // Show "Create X" option if typed text doesn't exactly match an existing category
      if (q && !exactMatch) {
        const createItem = document.createElement("div");
        createItem.textContent = "Create \u201c" + query.trim() + "\u201d";
        createItem.style.cssText = "padding:6px 10px;cursor:pointer;font-size:13px;color:#8b8bff;font-style:italic;border-top:1px solid #3a3a5c;";
        createItem.addEventListener("mouseenter", () => { createItem.style.background = "#2a2a4a"; });
        createItem.addEventListener("mouseleave", () => { createItem.style.background = ""; });
        createItem.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectedCatId = "__create__";
          selectedCatName = query.trim();
          catInput.value = query.trim();
          catDropdown.style.display = "none";
        });
        catDropdown.appendChild(createItem);
      }

      catDropdown.style.display = catDropdown.children.length > 0 ? "" : "none";
    }

    catInput.addEventListener("focus", () => renderCatDropdown(catInput.value));
    catInput.addEventListener("input", () => {
      selectedCatId = null;
      selectedCatName = "";
      renderCatDropdown(catInput.value);
    });
    catInput.addEventListener("blur", () => {
      setTimeout(() => { catDropdown.style.display = "none"; }, 150);
    });

    card.appendChild(catContainer);

    // Date — toggle + date input
    const dateLabel = document.createElement("label");
    dateLabel.textContent = "Date";
    card.appendChild(dateLabel);

    const dateRow = document.createElement("div");
    dateRow.style.cssText = "display:flex;gap:6px;align-items:center;";

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = activeDate;
    dateInput.style.flex = "1";

    // Toggle button: posted date vs today
    const dateToggle = document.createElement("button");
    dateToggle.style.cssText = "background:#2a2a4a;border:1px solid #3a3a5c;border-radius:6px;color:#a0a0c0;font-size:11px;padding:4px 8px;cursor:pointer;white-space:nowrap;font-family:inherit;";
    function updateToggleLabel() {
      if (usePostedDate) {
        dateToggle.textContent = "Posted";
        dateToggle.title = "Using tweet's posted date. Click for today.";
      } else {
        dateToggle.textContent = "Today";
        dateToggle.title = "Using today's date. Click for posted date.";
      }
    }
    updateToggleLabel();

    // Only show toggle if posted date differs from today
    if (postedDate && postedDate !== today) {
      dateToggle.addEventListener("click", (e) => {
        e.preventDefault();
        usePostedDate = !usePostedDate;
        dateInput.value = usePostedDate ? postedDate : today;
        updateToggleLabel();
        // Re-fetch topics for the new date
        loadTopicsForDate(dateInput.value, topicSelect, newTopicInput);
      });
    } else {
      dateToggle.style.display = "none";
    }

    dateRow.appendChild(dateInput);
    dateRow.appendChild(dateToggle);
    card.appendChild(dateRow);

    // Re-fetch topics when date input changes manually
    dateInput.addEventListener("change", () => {
      // Update toggle state to reflect manual override
      if (dateInput.value === today) {
        usePostedDate = false;
      } else if (dateInput.value === postedDate) {
        usePostedDate = true;
      }
      updateToggleLabel();
      loadTopicsForDate(dateInput.value, topicSelect, newTopicInput);
    });

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

    const unsaveBtn = document.createElement("button");
    unsaveBtn.className = "tpot-ac-btn secondary";
    unsaveBtn.textContent = "Unsave";
    unsaveBtn.addEventListener("click", async () => {
      unsaveBtn.disabled = true;
      unsaveBtn.textContent = "Removing\u2026";
      try {
        await sendMessage({ type: "DELETE_TWEET", tweetDbId: tweetDbId });
        // Reset save button back to "+"
        document.querySelectorAll(".tpot-save-btn").forEach((b) => {
          if (b.dataset.tpotDbId === String(tweetDbId)) {
            b.classList.remove("saved");
            delete b.dataset.tpotDbId;
            delete b.dataset.tpotChecked;
          }
        });
        // Remove from saved cache
        for (const [tid, dbId] of savedTweets) {
          if (dbId === tweetDbId) { savedTweets.delete(tid); break; }
        }
        header.textContent = "\u2717 Removed";
        document.removeEventListener("mousedown", onClickOutside, true);
        setTimeout(() => { if (card.parentNode) card.remove(); }, 800);
      } catch (err) {
        unsaveBtn.textContent = "Error";
        unsaveBtn.disabled = false;
        setTimeout(() => { unsaveBtn.textContent = "Unsave"; }, 1500);
      }
    });
    actions.appendChild(unsaveBtn);

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

        let catId = null;

        if (selectedCatId === "__create__" && selectedCatName) {
          // Create new category
          const createResp = await sendMessage({
            type: "CREATE_CATEGORY",
            category: { name: selectedCatName },
          });
          if (createResp.error) throw new Error(createResp.error);
          catId = createResp.category.id;
        } else if (selectedCatId && selectedCatId !== "__create__") {
          catId = Number(selectedCatId);
        } else if (catInput.value.trim() && !selectedCatId) {
          // User typed something but didn't select -- create it
          const createResp = await sendMessage({
            type: "CREATE_CATEGORY",
            category: { name: catInput.value.trim() },
          });
          if (createResp.error) throw new Error(createResp.error);
          catId = createResp.category.id;
        }

        const updates = {};
        if (memoInput.value.trim()) updates.memo = memoInput.value.trim();
        if (dateInput.value !== today) updates.saved_at = dateInput.value + "T12:00:00";
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

  // ── Saved Tweet Tracking ───────────────────────────────────────────

  // Map of twitter tweet_id -> backend db id for tweets already saved
  const savedTweets = new Map();
  let checkPending = false;

  async function checkSavedStatus() {
    if (checkPending) return;
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const unchecked = [];
    articles.forEach((article) => {
      const btn = article.querySelector(".tpot-save-btn");
      if (btn && btn.dataset.tpotChecked) return;
      const link = article.querySelector('a[href*="/status/"]');
      if (!link) return;
      const m = link.getAttribute("href").match(/status\/(\d+)/);
      if (m && !savedTweets.has(m[1])) unchecked.push(m[1]);
    });
    if (unchecked.length === 0) return;

    checkPending = true;
    try {
      const resp = await sendMessage({ type: "CHECK_SAVED", tweetIds: unchecked });
      if (resp && resp.saved) {
        for (const [tid, dbId] of Object.entries(resp.saved)) {
          savedTweets.set(tid, dbId);
        }
      }
      // Update buttons that are now known to be saved
      articles.forEach((article) => {
        const btn = article.querySelector(".tpot-save-btn");
        if (!btn) return;
        btn.dataset.tpotChecked = "1";
        const link = article.querySelector('a[href*="/status/"]');
        if (!link) return;
        const m = link.getAttribute("href").match(/status\/(\d+)/);
        if (m && savedTweets.has(m[1])) {
          btn.classList.add("saved");
          btn.dataset.tpotDbId = savedTweets.get(m[1]);
        }
      });
    } catch (err) {
      // Silently ignore check failures
    }
    checkPending = false;
  }

  // ── Save Handler ───────────────────────────────────────────────────

  async function handleSave(button, article) {
    if (button.classList.contains("saving")) return;

    // If already saved, unsave directly
    if (button.classList.contains("saved") && button.dataset.tpotDbId) {
      const dbId = Number(button.dataset.tpotDbId);
      button.classList.add("saving");
      button.classList.remove("saved");
      try {
        await sendMessage({ type: "DELETE_TWEET", tweetDbId: dbId });
        for (const [tid, id] of savedTweets) {
          if (id === dbId) { savedTweets.delete(tid); break; }
        }
        delete button.dataset.tpotDbId;
        delete button.dataset.tpotChecked;
        button.classList.remove("saving");
      } catch (err) {
        button.classList.remove("saving");
        button.classList.add("saved");
        showToast("Unsave failed: " + err.message, true);
      }
      return;
    }

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
      // Default saved_at to the tweet's posted date if available
      const postedDate = extractPostedDate(article);
      if (postedDate) tweetPayload.saved_at = postedDate + "T12:00:00";
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
      button.dataset.tpotDbId = saveResp.id;
      savedTweets.set(tweetData.tweet_id, saveResp.id);

      if (saveResp && saveResp.status === "duplicate") {
        showToast("Tweet already saved — @" + tweetData.author_handle, false);
      } else {
        showActionCard(saveResp.id, tweetData.author_handle, article);
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
    checkSavedStatus();
  }

  let scanTimer = null;
  new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 150);
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
