const ALARM_NAME = "zen-closer-sweep";
const ALARM_PERIOD_MINUTES = 60;
const DEFAULT_SETTINGS = { maxAgeDays: 7 };

// --- Storage helpers ---

async function getStorageData() {
  const data = await browser.storage.local.get({
    tabTimestamps: {},
    settings: DEFAULT_SETTINGS,
  });
  return data;
}

async function saveTimestamps(tabTimestamps) {
  await browser.storage.local.set({ tabTimestamps });
}

// --- Initialization ---

async function initializeTimestamps() {
  const { tabTimestamps } = await getStorageData();
  const tabs = await browser.tabs.query({});
  const now = Date.now();
  const existingIds = new Set(Object.keys(tabTimestamps).map(Number));
  const currentTabIds = new Set(tabs.map((t) => t.id));

  // Add timestamps for tabs we aren't already tracking
  for (const tab of tabs) {
    if (!existingIds.has(tab.id)) {
      tabTimestamps[tab.id] = now;
    }
  }

  // Remove entries for tabs that no longer exist
  for (const id of existingIds) {
    if (!currentTabIds.has(id)) {
      delete tabTimestamps[id];
    }
  }

  await saveTimestamps(tabTimestamps);
}

// --- Badge ---

const ONE_HOUR = 60 * 60 * 1000;

async function updateBadge() {
  const { tabTimestamps, settings } = await getStorageData();
  const maxAge = (settings.maxAgeDays ?? DEFAULT_SETTINGS.maxAgeDays) * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const tabs = await browser.tabs.query({});

  const protectedUrls = new Set();
  for (const tab of tabs) {
    if (tab.active || tab.pinned) {
      if (tab.url) protectedUrls.add(tab.url);
    }
  }

  let atRisk = 0;
  for (const tab of tabs) {
    if (tab.pinned || tab.active) continue;
    if (tab.url && protectedUrls.has(tab.url)) continue;
    const lastActive = tabTimestamps[tab.id];
    if (lastActive === undefined) continue;
    const remaining = maxAge - (now - lastActive);
    if (remaining > 0 && remaining <= ONE_HOUR) atRisk++;
  }

  if (atRisk > 0) {
    browser.browserAction.setBadgeText({ text: String(atRisk) });
    browser.browserAction.setBadgeBackgroundColor({ color: "#e05565" });
  } else {
    browser.browserAction.setBadgeText({ text: "" });
  }
}

// --- Sweep ---

async function sweep() {
  const { tabTimestamps, settings } = await getStorageData();
  const maxAge = (settings.maxAgeDays ?? DEFAULT_SETTINGS.maxAgeDays) * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const tabs = await browser.tabs.query({});
  const currentTabIds = new Set(tabs.map((t) => t.id));

  // Build a set of URLs that have an active or pinned tab somewhere
  const protectedUrls = new Set();
  for (const tab of tabs) {
    if (tab.active || tab.pinned) {
      if (tab.url) protectedUrls.add(tab.url);
    }
  }

  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (tab.active) continue;
    if (tab.url && protectedUrls.has(tab.url)) continue;

    const lastActive = tabTimestamps[tab.id];
    if (lastActive === undefined) continue;

    if (now - lastActive >= maxAge) {
      try {
        await browser.tabs.remove(tab.id);
      } catch (_) {
        // Tab may already be gone
      }
      delete tabTimestamps[tab.id];
    }
  }

  // Clean up orphaned entries
  for (const id of Object.keys(tabTimestamps)) {
    if (!currentTabIds.has(Number(id))) {
      delete tabTimestamps[id];
    }
  }

  await saveTimestamps(tabTimestamps);
  await updateBadge();
}

// --- Event listeners ---

browser.runtime.onInstalled.addListener(async () => {
  await initializeTimestamps();
  await updateBadge();
  browser.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
});

browser.runtime.onStartup.addListener(async () => {
  await initializeTimestamps();
  await updateBadge();
  // Ensure alarm exists after restart
  const existing = await browser.alarms.get(ALARM_NAME);
  if (!existing) {
    browser.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  }
});

browser.tabs.onCreated.addListener(async (tab) => {
  const { tabTimestamps } = await getStorageData();
  tabTimestamps[tab.id] = Date.now();
  await saveTimestamps(tabTimestamps);
});

browser.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabTimestamps } = await getStorageData();
  const now = Date.now();
  tabTimestamps[activeInfo.tabId] = now;

  // Also reset timestamps for all tabs with the same URL (Zen synced tabs)
  const activatedTab = await browser.tabs.get(activeInfo.tabId);
  if (activatedTab.url) {
    const siblings = await browser.tabs.query({ url: activatedTab.url });
    for (const sib of siblings) {
      tabTimestamps[sib.id] = now;
    }
  }

  await saveTimestamps(tabTimestamps);
  await updateBadge();
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  const { tabTimestamps } = await getStorageData();
  delete tabTimestamps[tabId];
  await saveTimestamps(tabTimestamps);
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await sweep();
  }
});
