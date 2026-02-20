(function () {
  "use strict";

  // Guard against double-injection
  if (window.__tpotDigestInjected) return;
  window.__tpotDigestInjected = true;

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const CLEANUP_CSS_CLASS = "tpot-screenshot-cleanup";

  // ---------------------------------------------------------------------------
  // Utility: parse engagement counts ("1.2K" -> 1200, "3.4M" -> 3400000)
  // ---------------------------------------------------------------------------

  function parseCount(text) {
    if (!text) return 0;
    text = text.trim().replace(/,/g, "");
    const multipliers = { K: 1000, M: 1000000, B: 1000000000 };
    const upper = text.toUpperCase();
    for (const [suffix, mult] of Object.entries(multipliers)) {
      if (upper.endsWith(suffix)) {
        return Math.round(parseFloat(text.slice(0, -1)) * mult);
      }
    }
    const num = parseInt(text, 10);
    return isNaN(num) ? 0 : num;
  }

  // ---------------------------------------------------------------------------
  // Utility: extract URLs from text
  // ---------------------------------------------------------------------------

  function extractUrls(text) {
    if (!text) return [];
    const pattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    return text.match(pattern) || [];
  }

  // ---------------------------------------------------------------------------
  // Detect feed source from URL
  // ---------------------------------------------------------------------------

  function detectFeedSource() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes("/following")) return "following";
    if (path.includes("/search")) return "search";
    if (path === "/home" || path === "/") return "for_you";
    // Profile pages: /@handle or /handle (not a known route)
    const knownRoutes = [
      "/home",
      "/explore",
      "/notifications",
      "/messages",
      "/settings",
      "/i/",
      "/compose",
    ];
    if (!knownRoutes.some((r) => path.startsWith(r))) {
      return "profile";
    }
    return "for_you";
  }

  // ---------------------------------------------------------------------------
  // Extract tweet data from an article element
  // Uses the same selectors as the Playwright scraper (backend/app/scraper/feed.py)
  // ---------------------------------------------------------------------------

  function extractTweetData(article) {
    // Tweet ID from status link
    const timeLink = article.querySelector('a[href*="/status/"]');
    const href = timeLink ? timeLink.getAttribute("href") : "";
    const tweetIdMatch = href.match(/status\/([0-9]+)/);
    const tweetId = tweetIdMatch ? tweetIdMatch[1] : "";

    // Author
    const handleEl = article.querySelector(
      'div[data-testid="User-Name"] a[href^="/"]'
    );
    const authorHandle = handleEl
      ? handleEl.getAttribute("href").replace("/", "")
      : "";

    const displayNameEl = article.querySelector(
      'div[data-testid="User-Name"] span'
    );
    const authorDisplayName = displayNameEl ? displayNameEl.textContent : "";

    // Tweet text
    const textEl = article.querySelector('div[data-testid="tweetText"]');
    const text = textEl ? textEl.textContent : "";

    // Media
    const mediaEls = article.querySelectorAll(
      'img[src*="pbs.twimg.com/media"]'
    );
    const mediaUrls = Array.from(mediaEls).map((el) => el.src);

    // Article URLs from tweet text
    const articleUrls = extractUrls(text);

    // Engagement counts
    const likesEl = article.querySelector(
      'button[data-testid="like"] span'
    );
    const retweetsEl = article.querySelector(
      'button[data-testid="retweet"] span'
    );
    const repliesEl = article.querySelector(
      'button[data-testid="reply"] span'
    );

    // Retweet detection
    const retweetIndicator = article.querySelector(
      'span[data-testid="socialContext"]'
    );
    const isRetweet = retweetIndicator
      ? retweetIndicator.textContent.includes("reposted")
      : false;

    // Quote tweet detection
    const quoteTweet = article.querySelector(
      'div[role="link"][tabindex="0"]'
    );
    const isQuoteTweet = !!quoteTweet;

    return {
      tweet_id: tweetId,
      author_handle: authorHandle,
      author_display_name: authorDisplayName,
      text: text,
      media_urls: mediaUrls,
      article_urls: articleUrls,
      engagement: {
        likes: parseCount(likesEl ? likesEl.textContent : "0"),
        retweets: parseCount(retweetsEl ? retweetsEl.textContent : "0"),
        replies: parseCount(repliesEl ? repliesEl.textContent : "0"),
      },
      is_retweet: isRetweet,
      is_quote_tweet: isQuoteTweet,
      feed_source: detectFeedSource(),
    };
  }

  // ---------------------------------------------------------------------------
  // Screenshot capture
  // ---------------------------------------------------------------------------

  function captureScreenshot(article) {
    return new Promise((resolve, reject) => {
      // Add cleanup class to body to hide UI chrome
      document.body.classList.add(CLEANUP_CSS_CLASS);

      // Brief delay for CSS to take effect
      requestAnimationFrame(() => {
        setTimeout(() => {
          const rect = article.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;

          chrome.runtime.sendMessage(
            {
              type: "CAPTURE_SCREENSHOT",
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              dpr: dpr,
            },
            (response) => {
              // Remove cleanup class
              document.body.classList.remove(CLEANUP_CSS_CLASS);

              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (response && response.error) {
                reject(new Error(response.error));
                return;
              }
              if (response && response.screenshot) {
                resolve(response.screenshot);
              } else {
                reject(new Error("No screenshot data received"));
              }
            }
          );
        }, 100);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Toast notification
  // ---------------------------------------------------------------------------

  function showToast(message, isError) {
    // Remove existing toast
    const existing = document.querySelector(".tpot-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "tpot-toast " + (isError ? "error" : "success");
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 3000);
  }

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------

  async function handleSave(button, article) {
    if (button.classList.contains("saved") || button.classList.contains("saving")) {
      return;
    }

    button.classList.add("saving");

    try {
      // Extract tweet data
      const tweetData = extractTweetData(article);

      if (!tweetData.tweet_id) {
        throw new Error("Could not extract tweet ID");
      }

      // Capture screenshot
      let screenshotBase64;
      try {
        screenshotBase64 = await captureScreenshot(article);
      } catch (screenshotErr) {
        console.warn("[tpot-digest] Screenshot failed, sending without:", screenshotErr);
        // Use a 1x1 transparent PNG as fallback
        screenshotBase64 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      }

      // Send to background service worker
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: "SAVE_TWEET",
            tweet: {
              ...tweetData,
              screenshot_base64: screenshotBase64,
            },
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(resp);
          }
        );
      });

      if (response && response.error) {
        throw new Error(response.error);
      }

      button.classList.remove("saving");
      button.classList.add("saved");

      const status = response && response.status === "duplicate" ? "already saved" : "saved";
      showToast(
        "Tweet " + status + " — @" + tweetData.author_handle,
        false
      );
    } catch (err) {
      button.classList.remove("saving");
      console.error("[tpot-digest] Save failed:", err);
      showToast("Save failed: " + err.message, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Save button injection
  // ---------------------------------------------------------------------------

  function injectSaveButton(article) {
    // Skip if already injected
    if (article.querySelector(".tpot-save-btn")) return;

    const btn = document.createElement("button");
    btn.className = "tpot-save-btn";
    btn.title = "Save to tpot-digest";
    btn.setAttribute("aria-label", "Save tweet to tpot-digest");

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleSave(btn, article);
    });

    article.appendChild(btn);
  }

  // ---------------------------------------------------------------------------
  // Scan for tweets and inject buttons
  // ---------------------------------------------------------------------------

  function scanForTweets() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    articles.forEach(injectSaveButton);
  }

  // ---------------------------------------------------------------------------
  // MutationObserver to catch dynamically loaded tweets
  // ---------------------------------------------------------------------------

  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) {
      scanForTweets();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial scan
  scanForTweets();

  console.log("[tpot-digest] Content script loaded");
})();
