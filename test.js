#!/usr/bin/env node
/**
 * Integration Tests
 *
 * Usage:
 *   node test.js
 *
 * Requires: geckodriver, selenium-webdriver, selenium-webext-bridge
 */

const path = require('path');
const {
  launchBrowser, cleanupBrowser, createTestServer,
  sleep, waitForCondition, TestResults
} = require('selenium-webext-bridge');

const EXT_DIR = path.join(__dirname);

// This extension doesn't have an ID in the manifest, so we discover it by name.
const EXT_NAME = 'Zen Tab Auto-Closer';

async function main() {
  console.log('Integration Tests');

  const results = new TestResults();
  const server = await createTestServer({ port: 8080 });
  let browser;
  let extBaseUrl;

  try {
    console.log('Setting up Firefox');
    browser = await launchBrowser({
      extensions: [EXT_DIR]
    });
    const { driver, testBridge: bridge } = browser;

    console.log('Setup complete.\n');

    try {
      extBaseUrl = await bridge.getExtensionUrlByName(EXT_NAME);

      if (extBaseUrl) {
        results.pass('Get extension URL');
      } else {
        results.fail('Get extension URL',
          `Extension not found: "${EXT_NAME}"`);
      }
    } catch (e) {
      results.error('Get extension URL', e);
    }

    if (!extBaseUrl) {
      throw new Error('Extension URL missing');
    }

    const popupUrl = `${extBaseUrl}/popup/popup.html`;

    console.log('----- Popup Page -----');

    await driver.get(popupUrl);
    await sleep(1500);

    // Popup loads.
    try {
      const structure = await driver.executeScript(() => {
        return {
          hasSearch: document.getElementById('search') !== null,
          hasTabList: document.getElementById('tab-list') !== null,
          hasMaxAge: document.getElementById('max-age') !== null,
          hasTitle: document.querySelector('h1') !== null
        };
      });

      if (structure.hasSearch && structure.hasTabList && structure.hasMaxAge && structure.hasTitle) {
        results.pass('Popup loads and contains expected components');
      } else {
        results.fail('Popup loads and contains expected components', JSON.stringify(structure));
      }
    } catch (e) {
      results.error('Popup loads and contains expected components', e);
    }

    // Default max age = 7 days.
    try {
      const maxAge = await driver.executeScript(() => {
        return document.getElementById('max-age').value;
      });

      if (maxAge === '7') {
        results.pass('Max age default is 7 days');
      } else {
        results.fail('Max age default is 7 days', `got: "${maxAge}"`);
      }
    } catch (e) {
      results.error('Max age default is 7 days', e);
    }

    // Popup lists open tabs.
    try {
      const tabRows = await driver.executeScript(() => {
        return document.querySelectorAll('#tab-list .tab-row').length;
      });

      if (tabRows >= 1) {
        results.pass(`Popup lists open tabs (${tabRows} rows)`);
      } else {
        results.fail('Popup lists open tabs', `found ${tabRows} rows`);
      }
    } catch (e) {
      results.error('Popup lists open tabs', e);
    }

    console.log('----- Settings -----');

    try {
      await driver.executeScript(() => {
        const input = document.getElementById('max-age');
        input.value = '3';
        input.dispatchEvent(new Event('change'));
      });
      await sleep(500);

      const stored = await driver.executeScript(async () => {
        const data = await browser.storage.local.get('settings');
        return data.settings;
      });

      if (stored && stored.maxAgeDays === 3) {
        results.pass('Max age setting persists to storage');
      } else {
        results.fail('Max age setting persists to storage', JSON.stringify(stored));
      }

      // Reset to default
      await driver.executeScript(async () => {
        await browser.storage.local.set({ settings: { maxAgeDays: 7 } });
      });
    } catch (e) {
      results.error('Max age setting persists to storage', e);
    }

    console.log('----- Tab Tracker -----');

    await bridge.reset();

    // Create a tab and verify timestamp is added.
    try {
      const tab = await bridge.createTab('http://127.0.0.1:8080/tracked-tab');
      await sleep(1500);
      const tabId = tab.id;

      // Check for the expected timestamp.
      await driver.get(popupUrl);
      await sleep(1000);

      const tracked = await driver.executeScript(async (id) => {
        const data = await browser.storage.local.get('tabTimestamps');
        const ts = data.tabTimestamps || {};
        return ts[id] !== undefined;
      }, tabId);

      if (tracked) {
        results.pass('New tab gets a timestamp');
      } else {
        results.fail('New tab gets a timestamp',
          `tab ${tabId} not found in tabTimestamps`);
        }

      // Clean up our work.
      await driver.executeScript(async (id) => {
        await browser.tabs.remove(id);
      }, tabId);
      await sleep(500);
    } catch (e) {
      results.error('New tab gets a timestamp', e);
    }

    // Tab is removed from timestamp tracking when closed.
    try {
      await bridge.reset();

      const tab = await bridge.createTab('http://127.0.0.1:8080/close-tracking-test');
      await sleep(1000);
      const tabId = tab.id;

      await bridge.closeTab(tabId);
      await sleep(1000);

      await driver.get(popupUrl);
      await sleep(1000);

      const stillTracked = await driver.executeScript(async (id) => {
        // Cleans up entries for closed tabs.
        const bg = await browser.runtime.getBackgroundPage();
        await bg.initializeTimestamps();

        const data = await browser.storage.local.get('tabTimestamps');
        const ts = data.tabTimestamps || {};
        return ts[id] !== undefined;
      }, tabId);

      if (!stillTracked) {
        results.pass('Tab is removed from timestamp tracking when closed');
      } else {
        results.fail('Tab is removed from timestamp tracking when closed',
          'timestamp still present');
      }
    } catch (e) {
      results.error('Tab is removed from timestamp tracking when closed', e);
    }

    console.log('----- Popup Display -----');

    await bridge.reset();

    // Create a tab.
    const displayTab = await bridge.createTab('http://127.0.0.1:8080/display-test');
    await sleep(500);
    await bridge.executeInTab(displayTab.id, 'document.title = "Test Page"');
    await sleep(500);

    await driver.get(popupUrl);
    await sleep(1500);

    // Tab row displays title and idle time.
    try {
      const rows = await driver.executeScript(() => {
        const rows = document.querySelectorAll('#tab-list .tab-row');
        return Array.from(rows).map(row => {
          const title = row.querySelector('.tab-title');
          const idle = row.querySelector('.idle-time');
          return {
            title: title ? title.textContent : null,
            idle: idle ? idle.textContent : null
          };
        });
      });

      const displayRow = rows.find(r => r.title && r.title.includes('Test Page'));
      if (displayRow && displayRow.idle) {
        results.pass('Tab row displays title and idle time');
      } else {
        results.fail('Tab row displays title and idle time',
          `rows: ${JSON.stringify(rows.slice(0, 3))}`);
        }
    } catch (e) {
      results.error('Tab row displays title and idle time', e);
    }

    // Badge is displayed for active tab.
    try {
      const hasActiveBadge = await driver.executeScript(() => {
        const badges = document.querySelectorAll('.badge.active');
        return badges.length > 0;
      });

      if (hasActiveBadge) {
        results.pass('Badge is displayed for active tab');
      } else {
        results.fail('Badge is displayed for active tab', 'badge not found');
      }
    } catch (e) {
      results.error('Badge is displayed for active tab', e);
    }

    // Progress bar displays for non-active, non-pinned tabs
    try {
      const hasProgress = await driver.executeScript(() => {
        return document.querySelectorAll('.progress').length > 0;
      });

      if (hasProgress) {
        results.pass('Progress bar displays for non-active, non-pinned tabs');
      } else {
        results.fail('Progress bar displays for non-active, non-pinned tabs',
          'no progress bars found');
      }
    } catch (e) {
      results.error('Progress bar displays for non-active, non-pinned tabs', e);
    }

    // Search tabs in popup.
    try {
      await driver.executeScript(() => {
        const input = document.getElementById('search');
        input.value = 'Test Page';
        input.dispatchEvent(new Event('input'));
      });
      await sleep(500);

      const filtered = await driver.executeScript(() => {
        const rows = document.querySelectorAll('#tab-list .tab-row');
        return {
          count: rows.length,
          firstTitle: rows[0] ? rows[0].querySelector('.tab-title').textContent : ''
        };
      });

      if (filtered.count >= 1 && filtered.firstTitle.includes('Test Page')) {
        results.pass('Search tabs in popup');
      } else {
        results.fail('Search tabs in popup', JSON.stringify(filtered));
      }
    } catch (e) {
      results.error('Search tabs in popup', e);
    }

    // Clean up display tab.
    try {
      await driver.executeScript(async (id) => {
        await browser.tabs.remove(id);
      }, displayTab.id);
    } catch (e) {
      console.log("Error thrown, not much we can do about it");
    }

    console.log('----- Clean Up (aka Sweep) -----');

    await bridge.reset();

    // Create a tab, backdate its timestamp, then run clean up.
    try {
      const expiredTab = await bridge.createTab('http://127.0.0.1:8080/expired-tab');
      await sleep(1000);
      const expiredTabId = expiredTab.id;

      // We need extension open to use its API.
      await driver.get(popupUrl);
      await sleep(1000);

      // Activate the popup's own tab so the expired tab is NOT active.
      await driver.executeScript(async () => {
        const currentTab = await browser.tabs.getCurrent();
        if (currentTab) await browser.tabs.update(currentTab.id, { active: true });
      });
      await sleep(500);

      // Backdate the tab's timestamp and run clean up.
      const sweepResult = await driver.executeScript(async (tabId) => {
        const data = await browser.storage.local.get('tabTimestamps');
        const ts = data.tabTimestamps || {};
        ts[tabId] = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
        await browser.storage.local.set({
          tabTimestamps: ts,
          settings: { maxAgeDays: 7 }
        });

        const bg = await browser.runtime.getBackgroundPage();
        await bg.sweep();

        // Check if the tab still exists.
        try {
          await browser.tabs.get(tabId);
          return { closed: false };
        } catch (e) {
          return { closed: true };
        }
      }, expiredTabId);

      if (sweepResult.closed) {
        results.pass('Clean up closes expired tab');
      } else {
        results.fail('Clean up closes expired tab', `tab ${expiredTabId} still open`);
      }
    } catch (e) {
      results.error('Clean up closes expired tab', e);
    }

    // Clean up does NOT close active tab even if expired.
    try {
      // Get the active tab ID.
      const result = await driver.executeScript(async () => {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const activeTabId = tabs[0] ? tabs[0].id : null;
        if (!activeTabId) {
          return { error: 'no active tab found' };
        }

        // Backdate tab.
        const data = await browser.storage.local.get('tabTimestamps');
        const ts = data.tabTimestamps || {};
        ts[activeTabId] = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
        await browser.storage.local.set({ tabTimestamps: ts });

        // Run Clean up.
        const bg = await browser.runtime.getBackgroundPage();
        await bg.sweep();

        // Check if the active tab still exists or not.
        try {
          await browser.tabs.get(activeTabId);
          return { survived: true, tabId: activeTabId };
        } catch (e) {
          return { survived: false, tabId: activeTabId };
        }
      });

      if (result.error) {
        results.fail('Clean up does not close active tab', result.error);
      } else if (result.survived) {
        results.pass('Clean up does not close active tab');
      } else {
        results.fail('Clean up does not close active tab', 'active tab was closed');
      }
    } catch (e) {
      results.error('Clean up does not close active tab', e);
    }

    // Clean up does NOT close pinned tab even if expired.
    try {
      await bridge.reset();

      const pinnedTab = await bridge.createTab('http://127.0.0.1:8080/pinned-tab');
      await sleep(500);
      await bridge.pinTab(pinnedTab.id);
      await sleep(500);

      // Run clean up with backdated timestamp.
      await driver.get(popupUrl);
      await sleep(1000);

      const result = await driver.executeScript(async (tabId) => {
        // Activate popup's tab so pinned tab is not active.
        const currentTab = await browser.tabs.getCurrent();
        if (currentTab) await browser.tabs.update(currentTab.id, { active: true });

        // Backdate the pinned tab.
        const data = await browser.storage.local.get('tabTimestamps');
        const ts = data.tabTimestamps || {};
        ts[tabId] = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
        await browser.storage.local.set({ tabTimestamps: ts });

        // Run clean up.
        const bg = await browser.runtime.getBackgroundPage();
        await bg.sweep();

        // Check on pinned tab.
        try {
          await browser.tabs.get(tabId);
          return { survived: true };
        } catch (e) {
          return { survived: false };
        }
      }, pinnedTab.id);

      if (result.survived)
        results.pass('Clean up does not close pinned tab');
      else
        results.fail('Clean up does not close pinned tab', 'pinned tab was closed');

      // Remove remaining tab.
      await driver.executeScript(async (tabId) => {
        await browser.tabs.update(tabId, { pinned: false });
        await browser.tabs.remove(tabId);
      }, pinnedTab.id);
      await sleep(300);
    } catch (e) {
      results.error('Clean up does not close pinned tab', e);
    }

    // Clean up closes only tabs older than maxAge.
    try {
      await bridge.reset();

      const freshTab = await bridge.createTab('http://127.0.0.1:8080/fresh-tab');
      const oldTab = await bridge.createTab('http://127.0.0.1:8080/old-tab');
      await sleep(1000);

      await driver.get(popupUrl);
      await sleep(1000);

      // Activate popup tab so created tabs are not longer active.
      await driver.executeScript(async () => {
        const currentTab = await browser.tabs.getCurrent();
        if (currentTab) await browser.tabs.update(currentTab.id, { active: true });
      });
      // Give storage a chance to sesttle.
      await sleep(1000);

      const result = await driver.executeScript(async (freshId, oldId) => {
        // Backdate only the old tab
        const data = await browser.storage.local.get('tabTimestamps');
        const ts = data.tabTimestamps || {};
        ts[freshId] = Date.now(); // just now
        ts[oldId] = Date.now() - (10 * 24 * 60 * 60 * 1000); // 10 days ago
        await browser.storage.local.set({
          tabTimestamps: ts,
          settings: { maxAgeDays: 7 }
        });

        const bg = await browser.runtime.getBackgroundPage();
        await bg.sweep();

        let freshOpen = false, oldOpen = false;
        try { await browser.tabs.get(freshId); freshOpen = true; } catch (e) {}
        try { await browser.tabs.get(oldId); oldOpen = true; } catch (e) {}
        return { freshOpen, oldOpen };
      }, freshTab.id, oldTab.id);

      if (result.freshOpen && !result.oldOpen) {
        results.pass('Clean-up closes old tabs only');
      } else {
        results.fail('Clean-up closes old tabs only',
          `fresh: ${result.freshOpen}, old: ${result.oldOpen}`);
      }

      // Clean up fresh tab.
      try {
        await driver.executeScript(async (id) => {
          await browser.tabs.remove(id);
        }, freshTab.id);
      } catch (e) {}
    } catch (e) {
      results.error('Clean-up closes old tabs only', e);
    }

    console.log('----- At-Risk Tab Count -----');

    try {
      await bridge.reset();

      const atRiskTab = await bridge.createTab('http://127.0.0.1:8080/at-risk-tab');
      await sleep(1000);

      await driver.get(popupUrl);
      await sleep(1000);

      // Activate popup's tab so the at-risk tab is not active
      await driver.executeScript(async () => {
        const currentTab = await browser.tabs.getCurrent();
        if (currentTab) await browser.tabs.update(currentTab.id, { active: true });
      });
      await sleep(300);

      // Set tab timestamp to 30 min before expiry and trigger badge update
      const almostExpired = 7 * 24 * 60 * 60 * 1000 - (30 * 60 * 1000);
      const badgeText = await driver.executeScript(async (tabId, ageMs) => {
        const data = await browser.storage.local.get('tabTimestamps');
        const ts = data.tabTimestamps || {};
        ts[tabId] = Date.now() - ageMs;
        await browser.storage.local.set({
          tabTimestamps: ts,
          settings: { maxAgeDays: 7 }
        });

        const bg = await browser.runtime.getBackgroundPage();
        await bg.updateBadge();

        return await browser.browserAction.getBadgeText({});
      }, atRiskTab.id, almostExpired);

      if (badgeText && parseInt(badgeText) >= 1) {
        results.pass(`Badge shows at-risk tab count ("${badgeText}")`);
      } else {
        results.fail('Badge shows at-risk tab count', `badge: "${badgeText}"`);
      }

      // Clean up!
      try {
        await driver.executeScript(async (id) => {
          await browser.tabs.remove(id);
        }, atRiskTab.id);
      } catch (e) {}
    } catch (e) {
      results.error('Badge shows at-risk tab count', e);
    }
  } catch (e) {
    results.error('Test Suite', e);
  } finally {
    await cleanupBrowser(browser);
    server.close();
  }

  console.log('');
  const allPassed = results.summary();
  process.exit(results.exitCode());
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
