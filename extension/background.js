const DEFAULT_CONFIG = { backendUrl: "http://localhost:8000", authUser: "", authPass: "" };

async function getConfig() {
  return chrome.storage.sync.get(DEFAULT_CONFIG);
}

function localDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayKey() {
  return "count_" + localDate();
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
  const dateStr = message.date || localDate();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/topics?date=" + dateStr;
  try {
    const resp = await fetch(url, { headers: authHeaders(config) });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    return { topics: await resp.json() };
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

async function handleSetOg(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/topics/" + message.topicId;
  const headers = { "Content-Type": "application/json", ...authHeaders(config) };
  try {
    const resp = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ og_tweet_id: message.tweetDbId }),
    });
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SAVE_TWEET") { handleSaveTweet(message).then(sendResponse); return true; }
  if (message.type === "GET_STATUS") { handleGetStatus().then(sendResponse); return true; }
  if (message.type === "GET_TOPICS") { handleGetTopics(message).then(sendResponse); return true; }
  if (message.type === "CREATE_TOPIC") { handleCreateTopic(message).then(sendResponse); return true; }
  if (message.type === "ASSIGN_TWEET") { handleAssignTweet(message).then(sendResponse); return true; }
  if (message.type === "DELETE_TWEET") { handleDeleteTweet(message).then(sendResponse); return true; }
  if (message.type === "SET_OG") { handleSetOg(message).then(sendResponse); return true; }
  if (message.type === "UPDATE_TWEET") { handleUpdateTweet(message).then(sendResponse); return true; }
  if (message.type === "CHECK_SAVED") { handleCheckSaved(message).then(sendResponse); return true; }
  // Backward compat: old content.js may send GET_CATEGORIES (now hardcoded in content.js)
  if (message.type === "GET_CATEGORIES") { sendResponse({ categories: [] }); return false; }
});

getCount().then((c) => { if (c > 0) { chrome.action.setBadgeText({ text: String(c) }); chrome.action.setBadgeBackgroundColor({ color: "#6366f1" }); } });
