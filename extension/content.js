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

  // ── Toast ──────────────────────────────────────────────────────────

  function showToast(message, isError) {
    const existing = document.querySelector(".tpot-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "tpot-toast " + (isError ? "error" : "success");
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
  }

  // ── Save Handler ───────────────────────────────────────────────────

  async function handleSave(button, article) {
    if (button.classList.contains("saved") || button.classList.contains("saving")) return;
    button.classList.add("saving");

    try {
      const tweetData = extractTweetData(article);
      if (!tweetData.tweet_id) throw new Error("Could not extract tweet ID");

      // Request screenshot from service worker
      const rect = article.getBoundingClientRect();
      const screenshotResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "CAPTURE_SCREENSHOT",
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          dpr: window.devicePixelRatio || 1,
        }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(resp);
        });
      });

      const screenshot = screenshotResp && screenshotResp.screenshot
        ? screenshotResp.screenshot
        : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      // Save tweet via service worker
      const saveResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "SAVE_TWEET",
          tweet: { ...tweetData, screenshot_base64: screenshot },
        }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(resp);
        });
      });

      if (saveResp && saveResp.error) throw new Error(saveResp.error);

      button.classList.remove("saving");
      button.classList.add("saved");

      const status = saveResp && saveResp.status === "duplicate" ? "already saved" : "saved";
      showToast("Tweet " + status + " — @" + tweetData.author_handle, false);
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
