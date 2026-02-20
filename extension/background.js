const DEFAULT_CONFIG = { backendUrl: "http://localhost:8000", authUser: "", authPass: "" };

async function getConfig() {
  return chrome.storage.sync.get(DEFAULT_CONFIG);
}

function todayKey() {
  const d = new Date();
  return "count_" + d.toISOString().slice(0, 10);
}

async function incrementCount() {
  const key = todayKey();
  const stored = await chrome.storage.local.get({ [key]: 0 });
  const count = stored[key] + 1;
  await chrome.storage.local.set({ [key]: count });
  chrome.action.setBadgeText({ text: String(count) });
  chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
  return count;
}

async function getCount() {
  const key = todayKey();
  const stored = await chrome.storage.local.get({ [key]: 0 });
  return stored[key];
}

async function handleScreenshot(message, sender) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);

    const dpr = message.dpr || 1;
    const sx = Math.round(message.rect.x * dpr);
    const sy = Math.round(message.rect.y * dpr);
    const sw = Math.round(message.rect.width * dpr);
    const sh = Math.round(message.rect.height * dpr);

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    bitmap.close();

    const pngBlob = await canvas.convertToBlob({ type: "image/png" });
    const buffer = await pngBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

    return { screenshot: btoa(binary) };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleSaveTweet(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/tweets";
  console.log("[tpot] Saving tweet to:", url);
  const headers = { "Content-Type": "application/json" };
  if (config.authUser && config.authPass) {
    headers["Authorization"] = "Basic " + btoa(config.authUser + ":" + config.authPass);
  }
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(message.tweet) });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("[tpot] Save failed:", resp.status, text.slice(0, 200));
      throw new Error("HTTP " + resp.status + ": " + text.slice(0, 200));
    }
    const data = await resp.json();
    console.log("[tpot] Tweet saved:", data.tweet_id);
    await incrementCount();
    return data;
  } catch (err) {
    console.error("[tpot] Save error:", err.message, "Backend URL:", url);
    await queueRetry(message.tweet);
    return { error: err.message, queued: true };
  }
}

async function handleGetStatus() {
  const config = await getConfig();
  const count = await getCount();
  try {
    const resp = await fetch(config.backendUrl.replace(/\/+$/, "") + "/api/health", {
      signal: AbortSignal.timeout(5000),
    });
    return { connected: resp.ok, dailyCount: count, backendUrl: config.backendUrl };
  } catch {
    return { connected: false, dailyCount: count, backendUrl: config.backendUrl };
  }
}

async function queueRetry(tweet) {
  const stored = await chrome.storage.local.get({ retryQueue: [] });
  const queue = stored.retryQueue;
  queue.push({ tweet, queuedAt: Date.now() });
  const oneHourAgo = Date.now() - 3600000;
  await chrome.storage.local.set({ retryQueue: queue.filter((i) => i.queuedAt > oneHourAgo) });
}

async function processRetryQueue() {
  const stored = await chrome.storage.local.get({ retryQueue: [] });
  if (stored.retryQueue.length === 0) return;
  const remaining = [];
  for (const item of stored.retryQueue) {
    if (Date.now() - item.queuedAt > 3600000) continue;
    const resp = await handleSaveTweet({ tweet: item.tweet });
    if (resp.error && !resp.queued) remaining.push(item);
  }
  await chrome.storage.local.set({ retryQueue: remaining });
}

chrome.alarms.create("retryQueue", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "retryQueue") processRetryQueue();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURE_SCREENSHOT") { handleScreenshot(message, sender).then(sendResponse); return true; }
  if (message.type === "SAVE_TWEET") { handleSaveTweet(message).then(sendResponse); return true; }
  if (message.type === "GET_STATUS") { handleGetStatus().then(sendResponse); return true; }
});

getCount().then((c) => { if (c > 0) { chrome.action.setBadgeText({ text: String(c) }); chrome.action.setBadgeBackgroundColor({ color: "#6366f1" }); } });
