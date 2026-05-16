/* Organizer Time Collector — background.js (MV3 service worker)
   - Tracks active tab domain + title time blocks
   - Sends blocks to organizer via window.handleAutoTimeLog(payload)
   - Updates badge via window.getOrganizerBadgeState()
*/

const STATE_KEY = "otc_state_v1";
const QUEUE_KEY = "otc_queue_v1";

const MIN_SEGMENT_SECONDS = 15; // ignore micro-switches
const ROUNDING = "nearest_minute"; // nearest_minute | ceiling_minute
const ORGANIZER_URL_HINTS = [
  "organizer.html",
  "Auto‑Tracking Organizer",
  "Auto-Tracking Organizer",
];

let current = null; // { tabId, windowId, url, title, startedAtMs }
let lastActiveInfo = null; // last known active tab info for recovery

// -------------------------
// Helpers
// -------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeUrl(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

function domainFromUrl(url) {
  const u = safeUrl(url);
  if (!u) return "";
  return u.hostname || "";
}

function niceTitle(title) {
  return String(title || "").trim();
}

function nowISO(ms = Date.now()) {
  return new Date(ms).toISOString();
}

function secondsBetween(aMs, bMs) {
  return Math.max(0, Math.floor((bMs - aMs) / 1000));
}

function minutesFromSeconds(sec) {
  if (sec <= 0) return 0;
  const raw = sec / 60;
  if (ROUNDING === "ceiling_minute") return Math.max(1, Math.ceil(raw));
  return Math.max(1, Math.round(raw));
}

async function loadKV(key, fallback) {
  const obj = await chrome.storage.local.get(key);
  return obj[key] ?? fallback;
}

async function saveKV(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function pushQueue(item) {
  const q = await loadKV(QUEUE_KEY, []);
  q.unshift(item);
  await saveKV(QUEUE_KEY, q.slice(0, 500)); // cap
}

async function popQueue() {
  const q = await loadKV(QUEUE_KEY, []);
  const item = q.shift();
  await saveKV(QUEUE_KEY, q);
  return item;
}

async function peekQueue() {
  const q = await loadKV(QUEUE_KEY, []);
  return q[0] || null;
}

function isOrganizerTab(tab) {
  const url = tab?.url || "";
  const title = tab?.title || "";
  return ORGANIZER_URL_HINTS.some((h) => url.includes(h) || title.includes(h));
}

// -------------------------
// Organizer injection
// -------------------------
async function sendPayloadToOrganizerTabs(payload) {
  const tabs = await chrome.tabs.query({});
  const organizerTabs = tabs.filter(isOrganizerTab);

  if (!organizerTabs.length) return false;

  let delivered = false;

  for (const tab of organizerTabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        args: [payload],
        func: (p) => {
          try {
            if (typeof window.handleAutoTimeLog === "function") {
              window.handleAutoTimeLog(p);
              return true;
            }
          } catch {}
          return false;
        },
      });
      delivered = true;
    } catch {
      // ignore failures (restricted pages, file access not enabled, etc.)
    }
  }

  return delivered;
}

async function getBadgeStateFromOrganizer() {
  const tabs = await chrome.tabs.query({});
  const organizerTabs = tabs.filter(isOrganizerTab);
  if (!organizerTabs.length) return null;

  // Ask the first organizer tab for badge state
  const tab = organizerTabs[0];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => {
        try {
          if (typeof window.getOrganizerBadgeState === "function") {
            return window.getOrganizerBadgeState();
          }
        } catch {}
        return null;
      },
    });

    return results?.[0]?.result ?? null;
  } catch {
    return null;
  }
}

// -------------------------
// Time tracking core
// -------------------------
async function startTrackingForTab(tab) {
  if (!tab?.id || !tab?.url) return;

  current = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title || "",
    startedAtMs: Date.now(),
  };

  lastActiveInfo = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title || "",
  };

  await saveKV(STATE_KEY, { current, lastActiveInfo });
}

async function stopAndRecordCurrent(reason = "switch") {
  if (!current) return;

  const endMs = Date.now();
  const sec = secondsBetween(current.startedAtMs, endMs);

  // Reset current first
  const finished = current;
  current = null;
  await saveKV(STATE_KEY, { current, lastActiveInfo });

  if (sec < MIN_SEGMENT_SECONDS) return;

  const mins = minutesFromSeconds(sec);

  const domain = domainFromUrl(finished.url);
  const title = niceTitle(finished.title);
  const pretty = domain
    ? `${domain}${title ? " — " + title : ""}`
    : title || "Auto capture";

  const payload = {
    type: "other",
    title: pretty,
    minutes: mins,
    startedAtISO: nowISO(finished.startedAtMs),
    endedAtISO: nowISO(endMs),
    note: `Auto-captured from browser (${reason})`,
    domain,
  };

  // queue then attempt delivery
  await pushQueue(payload);
  await flushQueue();
}

async function flushQueue() {
  // Try deliver queued items in order until fail
  for (let i = 0; i < 50; i++) {
    const item = await peekQueue();
    if (!item) return;

    const ok = await sendPayloadToOrganizerTabs(item);
    if (!ok) return;

    await popQueue();
    await sleep(20);
  }
}

// -------------------------
// Badge
// -------------------------
async function setBadge(text, color = "#3fa6a3") {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text: String(text || "") });
  } catch {}
}

async function updateBadge() {
  const state = await getBadgeStateFromOrganizer();

  if (!state) {
    // If no organizer open: show dot if queue has items, else blank
    const item = await peekQueue();
    await setBadge(item ? "•" : "");
    return;
  }

  const due = Number(state.dueToday || 0);
  const timerRunning = !!state.timerRunning;

  // Badge logic:
  // - If timer running: show "▶"
  // - else show due count (if >0)
  // - else blank
  if (timerRunning) {
    await setBadge("▶", "#3fa6a3");
  } else if (due > 0) {
    await setBadge(due > 99 ? "99+" : String(due), "#f28c85");
  } else {
    await setBadge("");
  }
}

// -------------------------
// Event wiring
// -------------------------
async function handleActiveTabChange() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab?.id) return;

  // If same tab, ignore
  if (current?.tabId === tab.id) return;

  await stopAndRecordCurrent("tab change");
  await startTrackingForTab(tab);
  await flushQueue();
  await updateBadge();
}

chrome.tabs.onActivated.addListener(async () => {
  await handleActiveTabChange();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  // If focus lost (-1), stop current segment
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await stopAndRecordCurrent("window blur");
    await updateBadge();
    return;
  }

  await handleActiveTabChange();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!current || tabId !== current.tabId) return;

  // Update title/url while tracking so payload is accurate
  if (changeInfo.title) current.title = changeInfo.title;
  if (changeInfo.url) current.url = changeInfo.url;

  lastActiveInfo = {
    tabId: current.tabId,
    windowId: current.windowId,
    url: current.url,
    title: current.title,
  };

  await saveKV(STATE_KEY, { current, lastActiveInfo });
});

chrome.idle.onStateChanged.addListener(async (newState) => {
  // If user idle/locked, stop segment
  if (newState === "idle" || newState === "locked") {
    await stopAndRecordCurrent(`idle:${newState}`);
    await updateBadge();
  } else if (newState === "active") {
    // restart tracking when active
    await handleActiveTabChange();
  }
});

// Alarms: flush queue + update badge periodically
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "otc_tick") {
    await flushQueue();
    await updateBadge();
  }
});

// Startup
chrome.runtime.onInstalled.addListener(async () => {
  chrome.idle.setDetectionInterval(60);
  await chrome.alarms.create("otc_tick", { periodInMinutes: 1 });
  await handleActiveTabChange();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.idle.setDetectionInterval(60);
  await chrome.alarms.create("otc_tick", { periodInMinutes: 1 });

  // restore from storage
  const saved = await loadKV(STATE_KEY, null);
  if (saved?.current) current = saved.current;
  if (saved?.lastActiveInfo) lastActiveInfo = saved.lastActiveInfo;

  await handleActiveTabChange();
  await updateBadge();
});

// Expose basic debug via messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GET_STATUS") {
      const qTop = await peekQueue();
      sendResponse({
        ok: true,
        current,
        queueTop: qTop,
        queueLength: (await loadKV(QUEUE_KEY, [])).length,
      });
      return;
    }

    if (msg?.type === "FORCE_FLUSH") {
      await flushQueue();
      await updateBadge();
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "STOP_SEGMENT") {
      await stopAndRecordCurrent("manual stop");
      await updateBadge();
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "START_SEGMENT") {
      await handleActiveTabChange();
      await updateBadge();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false });
  })();

  return true; // keep message channel open for async sendResponse
});
