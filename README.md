# Zen Tab Auto-Closer

A Firefox/Zen Browser extension that automatically closes tabs inactive for a configurable number of days.

## Features

- Closes tabs that have been inactive for 7 days (configurable)
- Pinned tabs and the active tab are never closed
- Popup UI shows all tabs sorted by idle time with progress bars indicating proximity to expiry
- Dark and light mode support

## Installation

1. Open `about:debugging` in Zen or Firefox
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json` from this directory

## Usage

Click the toolbar icon to open the popup. You'll see all open tabs sorted by idle time (oldest first), each showing:

- Favicon and title
- Idle duration (e.g. "3d 12h")
- A progress bar showing how close the tab is to being closed

Adjust the number of days in the settings at the bottom of the popup.

## How It Works

The extension tracks the last activation time for each tab in `browser.storage.local`. A background alarm runs every hour and closes any non-pinned, non-active tab that has been idle longer than the configured threshold.

## Project Structure

```
zen-closer/
├── manifest.json      # Extension manifest (v2)
├── background.js      # Tab tracking, alarms, sweep logic
├── popup/
│   ├── popup.html     # Popup shell
│   ├── popup.js       # Tab list rendering, settings
│   └── popup.css      # Styles (dark/light mode)
└── icons/
    ├── icon.svg       # Source icon (editable)
    ├── icon-48.png    # Toolbar icon
    └── icon-96.png    # High-DPI toolbar icon
```

## Regenerating Icons

After editing `icons/icon.svg`, regenerate the PNGs with [librsvg](https://wiki.gnome.org/Projects/LibRsvg):

```sh
rsvg-convert -w 48 -h 48 icons/icon.svg -o icons/icon-48.png
rsvg-convert -w 96 -h 96 icons/icon.svg -o icons/icon-96.png
```

## Integration Tests

Install the test requirements with `npm install`

Run the tests with `node test.js`
