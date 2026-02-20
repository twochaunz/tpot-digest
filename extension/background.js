/* tpot-digest — Manifest V3 service worker */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  backendUrl: "http://localhost:8000",
  authUser: "",
  authPass: "",
};

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...stored };
}

// ---------------------------------------------------------------------------
// Daily save counter
// ---------------------------------------------------------------------------

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return "count_" + yyyy + "-" + mm + "-" + dd;
}

async function incrementDailyCount() {
  const key = todayKey();
  const stored = await chrome.storage.local.get({ [key]: 0 });
  const newCount = stored[key] + 1;
  await chrome.storage.local.set({ [key]: newCount });
  // Update badge
  chrome.action.setBadgeText({ text: String(newCount) });
  chrome.action.setBadgeBackgroundColor({ color: "#E8A838" });
  return newCount;
}

async function getDailyCount() {
  const key = todayKey();
  const stored = await chrome.storage.local.get({ [key]: 0 });
  return stored[key];
}

// ---------------------------------------------------------------------------
// Screenshot capture & crop
// ---------------------------------------------------------------------------

async function handleScreenshot(message, sender) {
  try {
    // Capture the visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
      format: "png",
    });

    // Crop to the tweet bounding rect
    const cropped = await cropImage(dataUrl, message.rect, message.dpr);
    return { screenshot: cropped };
  } catch (err) {
    console.error("[tpot-digest] Screenshot capture failed:", err);
    return { error: err.message };
  }
}

async function cropImage(dataUrl, rect, dpr) {
  // Fetch the full screenshot as a bitmap
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  // Calculate crop coordinates accounting for device pixel ratio
  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.round(rect.width * dpr);
  const sh = Math.round(rect.height * dpr);

  // Use OffscreenCanvas to crop
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  // Convert to PNG blob, then base64
  const pngBlob = await canvas.convertToBlob({ type: "image/png" });
  const buffer = await pngBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Convert to base64 (raw, no data-URL prefix)
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Backend communication
// ---------------------------------------------------------------------------

async function handleSaveTweet(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/ingest";

  const headers = { "Content-Type": "application/json" };
  if (config.authUser && config.authPass) {
    headers["Authorization"] =
      "Basic " + btoa(config.authUser + ":" + config.authPass);
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(message.tweet),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error("HTTP " + resp.status + ": " + text.slice(0, 200));
    }

    const data = await resp.json();
    await incrementDailyCount();
    return data;
  } catch (err) {
    console.error("[tpot-digest] Save to backend failed:", err);
    // Queue for retry
    await queueForRetry(message.tweet);
    return { error: err.message, queued: true };
  }
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

async function handleGetStatus() {
  const config = await getConfig();
  const healthUrl = config.backendUrl.replace(/\/+$/, "") + "/api/health";
  const dailyCount = await getDailyCount();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(healthUrl, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    return {
      connected: resp.ok,
      dailyCount: dailyCount,
      backendUrl: config.backendUrl,
    };
  } catch {
    return {
      connected: false,
      dailyCount: dailyCount,
      backendUrl: config.backendUrl,
    };
  }
}

// ---------------------------------------------------------------------------
// Retry queue
// ---------------------------------------------------------------------------

async function queueForRetry(tweet) {
  const stored = await chrome.storage.local.get({ retryQueue: [] });
  const queue = stored.retryQueue;
  queue.push({
    tweet: tweet,
    queuedAt: Date.now(),
  });
  // Keep only items less than 1 hour old
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const filtered = queue.filter((item) => item.queuedAt > oneHourAgo);
  await chrome.storage.local.set({ retryQueue: filtered });
}

async function processRetryQueue() {
  const stored = await chrome.storage.local.get({ retryQueue: [] });
  const queue = stored.retryQueue;
  if (queue.length === 0) return;

  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/ingest";

  const headers = { "Content-Type": "application/json" };
  if (config.authUser && config.authPass) {
    headers["Authorization"] =
      "Basic " + btoa(config.authUser + ":" + config.authPass);
  }

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const remaining = [];

  for (const item of queue) {
    // Drop items older than 1 hour
    if (item.queuedAt <= oneHourAgo) continue;

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(item.tweet),
      });

      if (resp.ok) {
        await incrementDailyCount();
        console.log("[tpot-digest] Retry succeeded for tweet:", item.tweet.tweet_id);
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  await chrome.storage.local.set({ retryQueue: remaining });
}

// ---------------------------------------------------------------------------
// Alarm for periodic retry
// ---------------------------------------------------------------------------

chrome.alarms.create("retryQueue", { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "retryQueue") {
    processRetryQueue();
  }
});

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURE_SCREENSHOT") {
    handleScreenshot(message, sender).then(sendResponse);
    return true; // async response
  }

  if (message.type === "SAVE_TWEET") {
    handleSaveTweet(message).then(sendResponse);
    return true; // async response
  }

  if (message.type === "GET_STATUS") {
    handleGetStatus().then(sendResponse);
    return true; // async response
  }
});

// ---------------------------------------------------------------------------
// Initialize badge on startup
// ---------------------------------------------------------------------------

getDailyCount().then((count) => {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: "#E8A838" });
  }
});

console.log("[tpot-digest] Service worker loaded");
