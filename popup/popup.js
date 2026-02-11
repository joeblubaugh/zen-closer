function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainHours = hours % 24;
    return `${days}d ${remainHours}h`;
  }
  if (hours > 0) {
    const remainMinutes = minutes % 60;
    return `${hours}h ${remainMinutes}m`;
  }
  if (minutes > 0) return `${minutes}m`;
  return "just now";
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "\u2026";
}

async function render() {
  const { tabTimestamps = {}, settings = { maxAgeDays: 7 } } =
    await browser.storage.local.get({ tabTimestamps: {}, settings: { maxAgeDays: 7 } });
  const tabs = await browser.tabs.query({});
  const now = Date.now();
  const maxAgeMs = settings.maxAgeDays * 24 * 60 * 60 * 1000;

  // Build list sorted by idle time descending (oldest first)
  const entries = tabs.map((tab) => {
    const lastActive = tabTimestamps[tab.id] ?? now;
    const idle = now - lastActive;
    return { tab, lastActive, idle };
  });
  entries.sort((a, b) => b.idle - a.idle);

  const list = document.getElementById("tab-list");
  list.innerHTML = "";

  for (const { tab, idle } of entries) {
    const row = document.createElement("div");
    row.className = "tab-row";

    // Favicon
    const favicon = document.createElement("img");
    favicon.className = "favicon";
    favicon.src = tab.favIconUrl || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
    favicon.width = 16;
    favicon.height = 16;
    row.appendChild(favicon);

    // Title
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = truncate(tab.title || "Untitled", 40);
    title.title = tab.title || "";
    row.appendChild(title);

    // Badge for pinned or active
    if (tab.pinned) {
      const badge = document.createElement("span");
      badge.className = "badge pinned";
      badge.textContent = "pinned";
      row.appendChild(badge);
    } else if (tab.active) {
      const badge = document.createElement("span");
      badge.className = "badge active";
      badge.textContent = "active";
      row.appendChild(badge);
    }

    // Idle time
    const idleEl = document.createElement("span");
    idleEl.className = "idle-time";
    idleEl.textContent = formatDuration(idle);
    row.appendChild(idleEl);

    // Progress bar (how close to expiry, capped at 100%)
    if (!tab.pinned && !tab.active) {
      const progress = document.createElement("div");
      progress.className = "progress";
      const fill = document.createElement("div");
      fill.className = "progress-fill";
      const pct = Math.min(100, (idle / maxAgeMs) * 100);
      fill.style.width = `${pct}%`;
      if (pct >= 90) fill.classList.add("danger");
      else if (pct >= 60) fill.classList.add("warning");
      progress.appendChild(fill);
      row.appendChild(progress);
    }

    list.appendChild(row);
  }

  // Settings
  document.getElementById("max-age").value = settings.maxAgeDays;
}

document.getElementById("max-age").addEventListener("change", async (e) => {
  const value = parseFloat(e.target.value);
  if (isNaN(value) || value <= 0) return;
  await browser.storage.local.set({ settings: { maxAgeDays: value } });
});

render();
