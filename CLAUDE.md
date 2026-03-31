# Teleport RDP Web Player - Chrome Extension

## Project Overview

Chrome Extension (Manifest V3) that plays Teleport RDP recordings directly in the browser, replacing the desktop tp-player app.

## Architecture

- **content-list.js** - Injects "Browser Play" buttons on `/audit/record*` pages
- **content-player.js** - Takes over `/audit/replay/*` pages when `?tp_web_player=1` is present, replaces DOM with custom player
- **js/player-bundle.js** - Core player: download, parse, decode, render RDP frames on canvas
- **css/player.css** - macOS-style player UI
- **lib/pako.min.js** - zlib decompression
- **lib/rle.js** - RLE bitmap decoding

## Key Design Decisions

- Runs in page's main world (same-origin fetch with cookies) to avoid CORS issues
- Content script at `document_start` for early DOM takeover
- No background service worker needed - all logic in content scripts
- Frame rendering: zlib + RLE decode -> canvas drawImage

## Development

```bash
# Load as unpacked extension in Chrome
chrome://extensions -> Developer mode -> Load unpacked -> select this directory
```

## Conventions

- Vanilla JS, no build tools, no frameworks
- Chinese UI labels (target users are Chinese)
- All resources declared in `web_accessible_resources`
- Git commits must NOT include `Co-Authored-By` or any Claude/AI attribution
