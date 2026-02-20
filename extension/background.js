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
  const headers = { "Content-Type": "application/json", ...authHeaders(config) };
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

function authHeaders(config) {
  const headers = {};
  if (config.authUser && config.authPass) {
    headers["Authorization"] = "Basic " + btoa(config.authUser + ":" + config.authPass);
  }
  return headers;
}

async function handleGetStatus() {
  const config = await getConfig();
  const count = await getCount();
  try {
    const resp = await fetch(config.backendUrl.replace(/\/+$/, "") + "/api/health", {
      headers: authHeaders(config),
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

async function handleCreateCategory(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/categories";
  const headers = { "Content-Type": "application/json", ...authHeaders(config) };
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(message.category) });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    return { category: await resp.json() };
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

async function handleCheckSaved(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/tweets/check";
  const headers = { "Content-Type": "application/json", ...authHeaders(config) };
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify({ tweet_ids: message.tweetIds }) });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function handleDeleteTweet(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/tweets/" + message.tweetDbId;
  const headers = authHeaders(config);
  try {
    const resp = await fetch(url, { method: "DELETE", headers });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    return { deleted: true };
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURE_SCREENSHOT") { handleScreenshot(message, sender).then(sendResponse); return true; }
  if (message.type === "SAVE_TWEET") { handleSaveTweet(message).then(sendResponse); return true; }
  if (message.type === "GET_STATUS") { handleGetStatus().then(sendResponse); return true; }
  if (message.type === "GET_TOPICS") { handleGetTopics(message).then(sendResponse); return true; }
  if (message.type === "GET_CATEGORIES") { handleGetCategories().then(sendResponse); return true; }
  if (message.type === "CREATE_TOPIC") { handleCreateTopic(message).then(sendResponse); return true; }
  if (message.type === "CREATE_CATEGORY") { handleCreateCategory(message).then(sendResponse); return true; }
  if (message.type === "ASSIGN_TWEET") { handleAssignTweet(message).then(sendResponse); return true; }
  if (message.type === "DELETE_TWEET") { handleDeleteTweet(message).then(sendResponse); return true; }
  if (message.type === "UPDATE_TWEET") { handleUpdateTweet(message).then(sendResponse); return true; }
  if (message.type === "CHECK_SAVED") { handleCheckSaved(message).then(sendResponse); return true; }
});

getCount().then((c) => { if (c > 0) { chrome.action.setBadgeText({ text: String(c) }); chrome.action.setBadgeBackgroundColor({ color: "#6366f1" }); } });
