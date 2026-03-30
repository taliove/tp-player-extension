# UI Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the audit list page and RDP player UI — card-based list with duration highlighting, keyboard animation feedback, recording cache, menu bar with history, and notes sidebar.

**Architecture:** The list page (`content-list.js`) is rewritten to hide the original table and render compact row-cards. The player page gets new modules (`cache-manager.js`, `notes.js`, `history.js`) loaded via the existing sequential script chain. The player DOM (`content-player.js:getPlayerHTML`) is expanded with a menu bar and sidebar. All new CSS goes into `css/list.css` (list page) and additions to `css/player.css` (player page).

**Tech Stack:** Vanilla JS (no frameworks), Cache API for recording storage, localStorage for notes/history/preferences, CSS animations for keyboard feedback.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `content-list.js` | Rewrite | Hide original table, extract data from DOM rows, render card list, read cache/notes status |
| `css/list.css` | Create | Card list styles, avatar gradients, duration colors, active pulse animation |
| `content-player.js` | Modify | Update `getPlayerHTML()` for menu bar + sidebar + animation containers; add `css/list.css` to script chain; add new JS modules to load chain |
| `css/player.css` | Modify | Add menu bar, sidebar, keyboard animation, shortcut hint, dropdown styles |
| `js/cache-manager.js` | Create | Cache API wrapper with LRU eviction, metadata in localStorage |
| `js/downloader.js` | Modify | Integrate cache layer — check cache before fetch, store after fetch |
| `js/notes.js` | Create | Read/write notes per recording ID from localStorage |
| `js/history.js` | Create | Read/write play history (last 20) from localStorage |
| `js/app.js` | Modify | Wire up: keyboard animations, shortcut hint, menu interactions, sidebar notes/info, history recording, cache status display |
| `manifest.json` | Modify | Add `css/list.css` to `content_scripts[0]` and new JS files to `web_accessible_resources` |

---

## Task 1: List Page — CSS & Card Rendering

**Files:**
- Create: `css/list.css`
- Rewrite: `content-list.js`
- Modify: `manifest.json`

- [ ] **Step 1: Create `css/list.css` with card styles**

```css
/* === Teleport Audit List — Card View === */

/* Hide original table when cards are active */
.tp-cards-active #table-record,
.tp-cards-active .table-responsive {
    display: none !important;
}

/* Card container */
.tp-card-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0;
    margin: 0;
}

/* Individual card row */
.tp-card {
    display: flex;
    align-items: center;
    background: #fff;
    border-radius: 8px;
    padding: 10px 16px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    transition: box-shadow 0.15s ease, transform 0.15s ease;
}

.tp-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transform: translateY(-1px);
}

/* Left section: avatar + user info */
.tp-card-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
}

/* Avatar circle */
.tp-card-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
}

/* User info */
.tp-card-user {
    min-width: 0;
}

.tp-card-name {
    font-size: 14px;
    font-weight: 500;
    color: #1a1a2e;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tp-card-time {
    font-size: 11px;
    color: #999;
    margin-top: 1px;
}

/* Right section: duration + action */
.tp-card-right {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;
}

/* Duration display */
.tp-card-duration {
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
    min-width: 80px;
}

.tp-card-duration.long {
    color: #0a84ff;
}

.tp-card-duration.short {
    color: #30d158;
}

/* Play button */
.tp-card-play {
    padding: 6px 16px;
    border: none;
    border-radius: 6px;
    background: #0a84ff;
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease;
}

.tp-card-play:hover {
    background: #409cff;
}

/* "使用中" active status */
.tp-card-active-badge {
    padding: 4px 12px;
    border-radius: 12px;
    background: rgba(48, 209, 88, 0.12);
    color: #30d158;
    font-size: 12px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
}

.tp-card-pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #30d158;
    animation: tp-pulse 1.5s ease-in-out infinite;
}

@keyframes tp-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
}

/* Cache indicator */
.tp-card-cached {
    font-size: 10px;
    color: #0a84ff;
    margin-right: 4px;
}

/* Note tag indicator on list */
.tp-card-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    font-weight: 500;
    margin-left: 6px;
}

.tp-card-tag.pass {
    background: rgba(48, 209, 88, 0.12);
    color: #30d158;
}

.tp-card-tag.fail {
    background: rgba(255, 69, 58, 0.12);
    color: #ff453a;
}

.tp-card-tag.pending {
    background: rgba(255, 159, 10, 0.12);
    color: #ff9f0a;
}
```

- [ ] **Step 2: Rewrite `content-list.js` — data extraction and card rendering**

Replace the entire file with:

```js
// Content script for /audit/record* pages
// Replaces original table with compact card list, highlighting duration.
(function () {
    'use strict';

    var DURATION_THRESHOLD_MIN = 58;
    var NOTES_KEY = 'tp_player_notes';

    // --- Duration parsing ---
    function parseDurationText(text) {
        // Remove HTML tags (e.g. <i> spinner icon) and trim
        var clean = text.replace(/<[^>]*>/g, '').trim();
        var totalSec = 0;
        var h = clean.match(/(\d+)\s*小时/);
        var m = clean.match(/(\d+)\s*分/);
        var s = clean.match(/(\d+)\s*秒/);
        if (h) totalSec += parseInt(h[1], 10) * 3600;
        if (m) totalSec += parseInt(m[1], 10) * 60;
        if (s) totalSec += parseInt(s[1], 10);
        return totalSec;
    }

    function formatDuration(totalSec) {
        if (totalSec < 60) return totalSec + 's';
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
        return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    }

    // --- User name parsing ---
    function parseUserName(text) {
        // Format: "username (中文名)" or "中文名 (username)"
        var match = text.match(/^(.+?)\s*\((.+?)\)\s*$/);
        if (match) {
            // Check if first part looks like English ID (ascii-only)
            if (/^[a-zA-Z0-9_.\-]+$/.test(match[1])) {
                return { display: match[2], sub: match[1] };
            }
            return { display: match[1], sub: match[2] };
        }
        return { display: text.trim(), sub: '' };
    }

    // --- Avatar gradient from name hash ---
    var GRADIENTS = [
        'linear-gradient(135deg, #667eea, #764ba2)',
        'linear-gradient(135deg, #f093fb, #f5576c)',
        'linear-gradient(135deg, #4facfe, #00f2fe)',
        'linear-gradient(135deg, #a18cd1, #fbc2eb)',
        'linear-gradient(135deg, #ffecd2, #fcb69f)',
        'linear-gradient(135deg, #89f7fe, #66a6ff)',
        'linear-gradient(135deg, #fbc2eb, #a6c1ee)',
        'linear-gradient(135deg, #fdcbf1, #e6dee9)',
        'linear-gradient(135deg, #a1c4fd, #c2e9fb)',
        'linear-gradient(135deg, #d4fc79, #96e6a1)',
    ];

    function hashCode(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    function getGradient(name) {
        return GRADIENTS[hashCode(name) % GRADIENTS.length];
    }

    function getInitial(displayName) {
        // Use first character (handles Chinese)
        return displayName.charAt(0).toUpperCase();
    }

    // --- Date formatting ---
    function formatDate(dateStr) {
        // "2026-03-28 21:13:12" → "03-28 21:13"
        var m = dateStr.match(/\d{4}-(\d{2}-\d{2})\s+(\d{2}:\d{2})/);
        return m ? m[1] + ' ' + m[2] : dateStr;
    }

    // --- Notes reading (for tag display) ---
    function readNotes() {
        try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || {}; }
        catch (e) { return {}; }
    }

    // --- Extract row data from original table ---
    function extractRowData(tr) {
        var rowId = tr.getAttribute('data-row-id');
        if (!rowId) return null;

        var cells = tr.querySelectorAll('td');
        if (cells.length < 10) return null;

        var userText = cells[2] ? cells[2].textContent.trim() : '';
        var dateText = cells[6] ? cells[6].textContent.trim() : '';
        var durationHtml = cells[7] ? cells[7].innerHTML : '';
        var durationText = cells[7] ? cells[7].textContent.trim() : '';
        var statusEl = cells[8] ? cells[8].querySelector('.label') : null;
        var isActive = statusEl && statusEl.classList.contains('label-success');
        var replayBtn = cells[9] ? cells[9].querySelector('a[data-action="replay"]') : null;
        var recordId = replayBtn ? replayBtn.getAttribute('data-record-id') : null;

        // For active sessions without replay button, try to get ID from row number
        // The recordId in the original table is from the row's ID column
        if (!recordId) {
            var idCell = cells[0];
            recordId = idCell ? idCell.textContent.trim() : null;
        }

        var totalSec = parseDurationText(durationHtml);

        return {
            rowId: rowId,
            user: parseUserName(userText),
            date: dateText,
            dateFormatted: formatDate(dateText),
            durationSec: totalSec,
            durationFormatted: formatDuration(totalSec),
            isActive: isActive,
            recordId: recordId,
            durationRaw: durationText,
        };
    }

    // --- Render a single card ---
    function renderCard(data, notes) {
        var card = document.createElement('div');
        card.className = 'tp-card';
        card.setAttribute('data-row-id', data.rowId);

        var isLong = data.durationSec >= DURATION_THRESHOLD_MIN * 60;
        var noteData = data.recordId && notes[data.recordId];
        var tagHtml = '';
        if (noteData && noteData.tag) {
            var tagLabels = { pass: '通过', fail: '不通过', pending: '待定' };
            tagHtml = '<span class="tp-card-tag ' + noteData.tag + '">' + tagLabels[noteData.tag] + '</span>';
        }

        var rightHtml;
        if (data.isActive) {
            rightHtml = ''
                + '<div class="tp-card-duration ' + (isLong ? 'long' : 'short') + '">' + data.durationRaw + '</div>'
                + '<div class="tp-card-active-badge"><span class="tp-card-pulse"></span>使用中</div>';
        } else {
            rightHtml = ''
                + '<div class="tp-card-duration ' + (isLong ? 'long' : 'short') + '">' + data.durationFormatted + '</div>'
                + '<button class="tp-card-play" data-rid="' + (data.recordId || '') + '">&#9654; 播放</button>';
        }

        card.innerHTML = ''
            + '<div class="tp-card-left">'
            + '  <div class="tp-card-avatar" style="background: ' + getGradient(data.user.display) + ';">'
            + getInitial(data.user.display)
            + '  </div>'
            + '  <div class="tp-card-user">'
            + '    <div class="tp-card-name" title="' + data.user.sub + '">' + data.user.display + tagHtml + '</div>'
            + '    <div class="tp-card-time">' + data.dateFormatted + '</div>'
            + '  </div>'
            + '</div>'
            + '<div class="tp-card-right">' + rightHtml + '</div>';

        // Play button click handler
        var playBtn = card.querySelector('.tp-card-play');
        if (playBtn) {
            playBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var rid = this.getAttribute('data-rid');
                if (rid) {
                    window.open(
                        '/audit/replay/1/' + rid + '?tp_web_player=1&rid=' + rid,
                        '_blank'
                    );
                }
            });
        }

        return card;
    }

    // --- Render all cards from table ---
    function renderCardList() {
        var tbody = document.querySelector('#table-record tbody');
        if (!tbody) return;

        var notes = readNotes();
        var rows = tbody.querySelectorAll('tr[data-row-id]');

        // Create or find card container
        var container = document.getElementById('tp-card-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'tp-card-container';
            container.className = 'tp-card-list';
            // Insert before the table
            var tableWrapper = document.querySelector('.table-responsive') || document.getElementById('table-record');
            if (tableWrapper && tableWrapper.parentElement) {
                tableWrapper.parentElement.insertBefore(container, tableWrapper);
            }
        }

        // Clear existing cards
        container.innerHTML = '';

        // Add class to parent to hide original table
        var pageBody = document.querySelector('.box-body') || document.body;
        pageBody.classList.add('tp-cards-active');

        // Render each row as a card
        for (var i = 0; i < rows.length; i++) {
            var data = extractRowData(rows[i]);
            if (data) {
                container.appendChild(renderCard(data, notes));
            }
        }
    }

    // --- Initialize ---
    function init() {
        renderCardList();

        // Watch for table changes (pagination, refresh, new rows)
        var tableEl = document.getElementById('table-record');
        if (tableEl) {
            new MutationObserver(renderCardList).observe(tableEl, { childList: true, subtree: true });
        }
    }

    // Try immediately
    if (document.getElementById('table-record')) {
        init();
    } else {
        // Wait for table to appear
        var bodyObs = new MutationObserver(function () {
            if (document.getElementById('table-record')) {
                bodyObs.disconnect();
                init();
            }
        });
        bodyObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
})();
```

- [ ] **Step 3: Update `manifest.json` — add `css/list.css` to list page content script**

In `manifest.json`, update the first content script entry to also inject `css/list.css`:

```json
{
    "matches": ["*://*/audit/record*"],
    "js": ["content-list.js"],
    "css": ["css/list.css"],
    "run_at": "document_idle"
}
```

- [ ] **Step 4: Test list page manually**

1. Go to `chrome://extensions` → reload the extension
2. Navigate to the Teleport audit record list page
3. Verify: original table is hidden, cards appear
4. Verify: user names show Chinese name primary, English ID in tooltip
5. Verify: duration ≥58min shows blue, <58min shows green
6. Verify: "使用中" rows show green pulse dot + "使用中" badge, no play button
7. Verify: clicking "播放" opens player in new tab
8. Verify: pagination/refresh re-renders cards correctly

- [ ] **Step 5: Commit**

```bash
git add content-list.js css/list.css manifest.json
git commit -m "feat(list): replace table with compact card list, highlight duration"
```

---

## Task 2: Player Keyboard Animations + Shortcut Hints

**Files:**
- Modify: `content-player.js` (add animation container DOM)
- Modify: `css/player.css` (add animation + hint styles)
- Modify: `js/app.js` (wire up animation triggers)

- [ ] **Step 1: Add animation container DOM to `getPlayerHTML()` in `content-player.js`**

In `content-player.js`, inside the `#canvas-container` div (after `#error-overlay`), add:

```js
+ '    <div id="action-overlay"></div>'
+ '    <div id="shortcut-hint">'
+ '      <kbd>Space</kbd> 暂停/播放'
+ '      <span class="hint-sep">|</span>'
+ '      <kbd>← →</kbd> 快退/快进 10s'
+ '      <span class="hint-sep">|</span>'
+ '      <kbd>+/-</kbd> 变速'
+ '    </div>'
```

Insert these two lines right before the closing `</div>` of `#canvas-container` (before `'  </div>'` for canvas-container).

- [ ] **Step 2: Add animation CSS to `css/player.css`**

Append to the end of `css/player.css`:

```css
/* === Keyboard Action Overlay (YouTube-style) === */
#action-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 15;
}

.action-icon {
    width: 64px;
    height: 64px;
    background: rgba(0, 0, 0, 0.65);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    color: #fff;
    animation: actionPop 0.5s ease forwards;
}

@keyframes actionPop {
    0% { opacity: 0.8; transform: scale(1); }
    100% { opacity: 0; transform: scale(1.5); }
}

/* Seek indicator (left/right) */
.seek-indicator {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    font-size: 14px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.8);
    background: rgba(0, 0, 0, 0.5);
    padding: 6px 14px;
    border-radius: 20px;
    pointer-events: none;
    z-index: 15;
    animation: seekFade 0.5s ease forwards;
}

.seek-indicator.left { left: 40px; }
.seek-indicator.right { right: 40px; }

@keyframes seekFade {
    0% { opacity: 0.9; }
    100% { opacity: 0; }
}

/* === Shortcut Hint Bar === */
#shortcut-hint {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.6);
    padding: 6px 16px;
    border-radius: 8px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.55);
    z-index: 15;
    pointer-events: none;
    opacity: 1;
    transition: opacity 0.5s ease;
    white-space: nowrap;
}

#shortcut-hint.hidden {
    opacity: 0;
}

#shortcut-hint kbd {
    background: rgba(255, 255, 255, 0.15);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-family: inherit;
    margin: 0 2px;
}

#shortcut-hint .hint-sep {
    margin: 0 6px;
    color: rgba(255, 255, 255, 0.25);
}
```

- [ ] **Step 3: Wire up animations in `js/app.js`**

Add these functions and modify the keyboard handler in `js/app.js`.

After the `var toastContainer = ...` DOM reference line, add:

```js
var actionOverlay = document.getElementById('action-overlay');
var shortcutHint = document.getElementById('shortcut-hint');
```

Add animation helper functions (before the `// --- Init & load ---` section):

```js
// --- Keyboard action animations ---
function showActionIcon(symbol) {
    var el = document.createElement('div');
    el.className = 'action-icon';
    el.textContent = symbol;
    actionOverlay.innerHTML = '';
    actionOverlay.appendChild(el);
    el.addEventListener('animationend', function () { el.remove(); });
}

function showSeekIndicator(direction) {
    // Remove any existing indicator
    var existing = canvasContainer.querySelector('.seek-indicator');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'seek-indicator ' + direction;
    el.textContent = direction === 'left' ? '« 10s' : '10s »';
    canvasContainer.appendChild(el);
    el.addEventListener('animationend', function () { el.remove(); });
}

function showShortcutHint() {
    if (!shortcutHint) return;
    shortcutHint.classList.remove('hidden');
    setTimeout(function () {
        shortcutHint.classList.add('hidden');
    }, 3000);
}
```

Modify the keyboard handler `switch` cases to add animation calls:

```js
case 'Space':
    e.preventDefault();
    var isNowPlaying = player.togglePlayPause();
    btnPlay.textContent = isNowPlaying ? '\u23F8' : '\u25B6';
    showActionIcon(isNowPlaying ? '\u25B6' : '\u23F8');
    break;
case 'ArrowLeft':
    e.preventDefault();
    var wl = player.playing;
    player.seek(Math.max(0, player.currentMs - 10000));
    if (wl) player.play();
    showSeekIndicator('left');
    break;
case 'ArrowRight':
    e.preventDefault();
    var wr = player.playing;
    player.seek(Math.min(player.totalMs, player.currentMs + 10000));
    if (wr) player.play();
    showSeekIndicator('right');
    break;
```

Also update the `btnPlay` click handler to show the action icon:

```js
btnPlay.addEventListener('click', function () {
    var isNowPlaying = player.togglePlayPause();
    btnPlay.textContent = isNowPlaying ? '\u23F8' : '\u25B6';
    showActionIcon(isNowPlaying ? '\u25B6' : '\u23F8');
});
```

At the end of `init()`, after `player.play()` and `btnPlay.textContent = '\u23F8'`, add:

```js
showShortcutHint();
```

- [ ] **Step 4: Test keyboard animations**

1. Reload extension, open a recording
2. Press Space — verify play/pause circle icon appears center, fades out in 0.5s
3. Press ← — verify "« 10s" appears on left side, fades
4. Press → — verify "10s »" appears on right side, fades
5. Verify shortcut hint bar appears at bottom on load, fades after 3s
6. Verify animations don't interfere with playback

- [ ] **Step 5: Commit**

```bash
git add content-player.js css/player.css js/app.js
git commit -m "feat(player): add YouTube-style play/pause animation and shortcut hints"
```

---

## Task 3: Recording Cache — Cache Manager Module

**Files:**
- Create: `js/cache-manager.js`

- [ ] **Step 1: Create `js/cache-manager.js`**

```js
// Teleport RDP Web Player — Cache Manager
// Uses Cache API for binary recording files, localStorage for metadata.
// LRU eviction when total size exceeds limit.

TPP.createCacheManager = function (rid) {
    var CACHE_NAME = 'tp-player-cache';
    var META_KEY = 'tp_cache_meta';
    var MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB default

    function readMeta() {
        try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
        catch (e) { return {}; }
    }

    function writeMeta(meta) {
        try { localStorage.setItem(META_KEY, JSON.stringify(meta)); }
        catch (e) { /* quota */ }
    }

    function cacheKey(filename) {
        return '/tp-cache/' + rid + '/' + filename;
    }

    function getFromCache(filename) {
        return caches.open(CACHE_NAME).then(function (cache) {
            return cache.match(cacheKey(filename));
        }).then(function (resp) {
            if (!resp) return null;
            // Update last access time
            var meta = readMeta();
            if (meta[rid]) {
                meta[rid].lastAccess = Date.now();
                writeMeta(meta);
            }
            return resp.arrayBuffer();
        });
    }

    function putInCache(filename, arrayBuffer) {
        var key = cacheKey(filename);
        var resp = new Response(arrayBuffer, {
            headers: { 'Content-Type': 'application/octet-stream' }
        });
        return caches.open(CACHE_NAME).then(function (cache) {
            return cache.put(key, resp);
        }).then(function () {
            // Update metadata
            var meta = readMeta();
            if (!meta[rid]) {
                meta[rid] = { totalSize: 0, lastAccess: Date.now(), files: {} };
            }
            meta[rid].files[filename] = arrayBuffer.byteLength;
            meta[rid].totalSize = 0;
            var files = meta[rid].files;
            for (var f in files) {
                if (files.hasOwnProperty(f)) meta[rid].totalSize += files[f];
            }
            meta[rid].lastAccess = Date.now();
            writeMeta(meta);
            return evictIfNeeded();
        });
    }

    function evictIfNeeded() {
        var meta = readMeta();
        var totalSize = 0;
        var entries = [];
        for (var r in meta) {
            if (meta.hasOwnProperty(r)) {
                totalSize += meta[r].totalSize || 0;
                entries.push({ rid: r, lastAccess: meta[r].lastAccess || 0, size: meta[r].totalSize || 0 });
            }
        }
        if (totalSize <= MAX_BYTES) return Promise.resolve();

        // Sort by lastAccess ascending (oldest first)
        entries.sort(function (a, b) { return a.lastAccess - b.lastAccess; });

        var toDelete = [];
        while (totalSize > MAX_BYTES && entries.length > 0) {
            var oldest = entries.shift();
            if (oldest.rid === String(rid)) continue; // Don't evict current recording
            toDelete.push(oldest.rid);
            totalSize -= oldest.size;
        }

        return caches.open(CACHE_NAME).then(function (cache) {
            var promises = [];
            for (var i = 0; i < toDelete.length; i++) {
                var delRid = toDelete[i];
                var files = meta[delRid] ? meta[delRid].files : {};
                for (var f in files) {
                    if (files.hasOwnProperty(f)) {
                        promises.push(cache.delete('/tp-cache/' + delRid + '/' + f));
                    }
                }
                delete meta[delRid];
            }
            writeMeta(meta);
            return Promise.all(promises);
        });
    }

    function isCached(filename) {
        return caches.open(CACHE_NAME).then(function (cache) {
            return cache.match(cacheKey(filename));
        }).then(function (resp) {
            return !!resp;
        });
    }

    function isAnyCached() {
        var meta = readMeta();
        return !!meta[rid];
    }

    function getCacheSize() {
        var meta = readMeta();
        return meta[rid] ? meta[rid].totalSize || 0 : 0;
    }

    function clearCurrent() {
        var meta = readMeta();
        var files = meta[rid] ? meta[rid].files : {};
        return caches.open(CACHE_NAME).then(function (cache) {
            var promises = [];
            for (var f in files) {
                if (files.hasOwnProperty(f)) {
                    promises.push(cache.delete(cacheKey(f)));
                }
            }
            delete meta[rid];
            writeMeta(meta);
            return Promise.all(promises);
        });
    }

    function clearAll() {
        writeMeta({});
        return caches.delete(CACHE_NAME);
    }

    // Static: check if a given rid is cached (for list page)
    function isRidCached(checkRid) {
        var meta = readMeta();
        return !!meta[checkRid];
    }

    return {
        getFromCache: getFromCache,
        putInCache: putInCache,
        isCached: isCached,
        isAnyCached: isAnyCached,
        getCacheSize: getCacheSize,
        clearCurrent: clearCurrent,
        clearAll: clearAll,
        isRidCached: isRidCached,
    };
};

// Static method for list page to check cache without creating full manager
TPP.isCached = function (checkRid) {
    try {
        var meta = JSON.parse(localStorage.getItem('tp_cache_meta')) || {};
        return !!meta[checkRid];
    } catch (e) { return false; }
};
```

- [ ] **Step 2: Commit**

```bash
git add js/cache-manager.js
git commit -m "feat(cache): add cache manager with LRU eviction"
```

---

## Task 4: Recording Cache — Integrate with Downloader

**Files:**
- Modify: `js/downloader.js`
- Modify: `content-player.js` (add cache-manager.js to script chain)

- [ ] **Step 1: Update `js/downloader.js` to accept a cache manager**

Replace `TPP.createDownloader` to accept an optional `cacheManager` parameter:

```js
// Teleport RDP Web Player — Downloader
TPP.createDownloader = function(serverBase, rid, cacheManager) {
    function buildUrl(act, filename, extraParams) {
        var params = new URLSearchParams(
            Object.assign({ act: act, type: 'rdp', rid: String(rid), f: filename }, extraParams || {})
        );
        return serverBase + '/audit/get-file?' + params;
    }

    function fetchWithRetry(url, options, retries) {
        var retriesLeft = retries !== undefined ? retries : TPP.MAX_RETRIES;
        var controller = new AbortController();
        var timeoutId = setTimeout(function () { controller.abort(); }, TPP.FETCH_TIMEOUT_MS);
        return fetch(url, Object.assign({ credentials: 'include', signal: controller.signal }, options || {}))
            .then(function (resp) {
                clearTimeout(timeoutId);
                if (resp.status === 401 || resp.status === 403) {
                    throw Object.assign(new Error('\u8ba4\u8bc1\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55'), { code: 'AUTH_EXPIRED' });
                }
                if (resp.status === 416) return null;
                if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
                return resp;
            })
            .catch(function (err) {
                clearTimeout(timeoutId);
                if (err.code === 'AUTH_EXPIRED' || retriesLeft <= 0) throw err;
                if (err.name === 'AbortError' && retriesLeft <= 0) throw new Error('\u8bf7\u6c42\u8d85\u65f6');
                return new Promise(function (r) { setTimeout(r, TPP.RETRY_DELAY_MS); })
                    .then(function () { return fetchWithRetry(url, options, retriesLeft - 1); });
            });
    }

    function getFileSize(filename) {
        return fetchWithRetry(buildUrl('size', filename))
            .then(function (resp) { return resp.text(); })
            .then(function (text) {
                var size = parseInt(text, 10);
                if (isNaN(size) || size < 0) throw new Error('\u65e0\u6548\u7684\u6587\u4ef6\u5927\u5c0f: ' + text);
                return size;
            });
    }

    function readFile(filename) {
        // Try cache first
        if (cacheManager) {
            return cacheManager.getFromCache(filename).then(function (buf) {
                if (buf) return buf;
                return fetchAndCache(filename);
            });
        }
        return fetchAndCache(filename);
    }

    function fetchAndCache(filename) {
        return fetchWithRetry(buildUrl('read', filename))
            .then(function (resp) {
                if (!resp) return null;
                return resp.arrayBuffer();
            })
            .then(function (buf) {
                if (buf && cacheManager) {
                    cacheManager.putInCache(filename, buf).catch(function () { /* ignore cache errors */ });
                }
                return buf;
            });
    }

    function readFileWithProgress(filename, onProgress) {
        // Try cache first
        if (cacheManager) {
            return cacheManager.getFromCache(filename).then(function (buf) {
                if (buf) {
                    if (onProgress) onProgress(buf.byteLength, buf.byteLength);
                    return buf;
                }
                return fetchWithProgressAndCache(filename, onProgress);
            });
        }
        return fetchWithProgressAndCache(filename, onProgress);
    }

    function fetchWithProgressAndCache(filename, onProgress) {
        return getFileSize(filename).then(function (size) {
            return fetchWithRetry(buildUrl('read', filename)).then(function (resp) {
                if (!resp) return null;
                var reader = resp.body.getReader();
                var chunks = [];
                var received = 0;
                function pump() {
                    return reader.read().then(function (result) {
                        if (result.done) return;
                        chunks.push(result.value);
                        received += result.value.byteLength;
                        if (onProgress) onProgress(received, size);
                        return pump();
                    });
                }
                return pump().then(function () {
                    var buf = new Uint8Array(received);
                    var offset = 0;
                    for (var i = 0; i < chunks.length; i++) {
                        buf.set(chunks[i], offset);
                        offset += chunks[i].byteLength;
                    }
                    var arrayBuf = buf.buffer;
                    if (cacheManager) {
                        cacheManager.putInCache(filename, arrayBuf).catch(function () {});
                    }
                    return arrayBuf;
                });
            });
        });
    }

    return { getFileSize: getFileSize, readFile: readFile, readFileWithProgress: readFileWithProgress };
};
```

- [ ] **Step 2: Add `cache-manager.js` to script load chain in `content-player.js`**

In the `loadScripts` array, insert `extBase + 'js/cache-manager.js'` after `constants.js` (before `downloader.js`):

```js
loadScripts([
    extBase + 'lib/pako.min.js',
    extBase + 'lib/rle.js',
    extBase + 'js/constants.js',
    extBase + 'js/cache-manager.js',  // NEW
    extBase + 'js/downloader.js',
    extBase + 'js/parser.js',
    // ... rest unchanged
], 0);
```

- [ ] **Step 3: Update `js/app.js` to create cache manager and pass to downloader**

Change the downloader creation line:

```js
// Before:
var downloader = TPP.createDownloader(serverBase, rid);

// After:
var cacheManager = TPP.createCacheManager(rid);
var downloader = TPP.createDownloader(serverBase, rid, cacheManager);
```

Also, in the `showLoading` call during first data file download, update to show "从缓存加载" when cached. In `init()`, after the header is parsed, before loading data files:

```js
// Check if first data file is cached
cacheManager.isCached('tp-rdp-1.tpd').then(function (cached) {
    if (cached) {
        showLoading('从缓存加载...', '');
    } else {
        showLoading('\u6b63\u5728\u4e0b\u8f7d\u6570\u636e\u6587\u4ef6 1/' + header.datFileCount + '...', '');
    }
});
```

Note: Since `isCached` is async but the subsequent download is also async, the simplest approach is to update the loading text in the progress callback — if progress jumps immediately to 100%, the user sees "从缓存加载" briefly. The actual implementation: modify the loading text before calling `readFileWithProgress`.

- [ ] **Step 4: Test cache**

1. Open a recording — downloads normally, shows progress
2. Close tab, reopen same recording — should show "从缓存加载", loads instantly
3. Open browser DevTools → Application → Cache Storage → `tp-player-cache` — verify files are stored
4. Check `localStorage.tp_cache_meta` — verify metadata entries

- [ ] **Step 5: Commit**

```bash
git add js/cache-manager.js js/downloader.js js/app.js content-player.js
git commit -m "feat(cache): integrate Cache API with downloader for recording caching"
```

---

## Task 5: Notes Module

**Files:**
- Create: `js/notes.js`

- [ ] **Step 1: Create `js/notes.js`**

```js
// Teleport RDP Web Player — Notes Module
// Stores per-recording notes in localStorage.

TPP.createNotes = function (rid) {
    var NOTES_KEY = 'tp_player_notes';

    function readAll() {
        try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || {}; }
        catch (e) { return {}; }
    }

    function writeAll(data) {
        try { localStorage.setItem(NOTES_KEY, JSON.stringify(data)); }
        catch (e) { /* quota */ }
    }

    function get() {
        var all = readAll();
        return all[rid] || { tag: null, text: '' };
    }

    function save(note) {
        var all = readAll();
        all[rid] = note;
        writeAll(all);
    }

    function setTag(tag) {
        var note = get();
        note.tag = note.tag === tag ? null : tag; // Toggle
        save(note);
        return note;
    }

    function setText(text) {
        var note = get();
        note.text = text;
        save(note);
        return note;
    }

    return {
        get: get,
        save: save,
        setTag: setTag,
        setText: setText,
    };
};
```

- [ ] **Step 2: Commit**

```bash
git add js/notes.js
git commit -m "feat(notes): add notes storage module"
```

---

## Task 6: History Module

**Files:**
- Create: `js/history.js`

- [ ] **Step 1: Create `js/history.js`**

```js
// Teleport RDP Web Player — Play History Module
// Stores last 20 played recordings in localStorage.

TPP.createHistory = function () {
    var HISTORY_KEY = 'tp_play_history';
    var MAX_ENTRIES = 20;

    function readAll() {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
        catch (e) { return []; }
    }

    function writeAll(data) {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(data)); }
        catch (e) { /* quota */ }
    }

    function add(entry) {
        // entry: { rid, user, duration, date, timestamp }
        var list = readAll();
        // Remove existing entry for same rid
        list = list.filter(function (item) { return String(item.rid) !== String(entry.rid); });
        // Add to front
        list.unshift(entry);
        // Trim to max
        if (list.length > MAX_ENTRIES) list = list.slice(0, MAX_ENTRIES);
        writeAll(list);
    }

    function getAll() {
        return readAll();
    }

    function clear() {
        writeAll([]);
    }

    return {
        add: add,
        getAll: getAll,
        clear: clear,
    };
};
```

- [ ] **Step 2: Commit**

```bash
git add js/history.js
git commit -m "feat(history): add play history storage module"
```

---

## Task 7: Player DOM — Menu Bar + Sidebar

**Files:**
- Modify: `content-player.js` (rewrite `getPlayerHTML()`, update script chain)
- Modify: `css/player.css` (add menu bar, sidebar, dropdown styles)

- [ ] **Step 1: Rewrite `getPlayerHTML()` in `content-player.js`**

Replace the `getPlayerHTML` function with the new layout including menu bar and sidebar:

```js
function getPlayerHTML() {
    return ''
        + '<div id="player-app">'
        // --- Menu Bar ---
        + '  <div id="menu-bar">'
        + '    <span id="menu-title">\u25B6 RDP \u5f55\u5c4f\u56de\u653e</span>'
        + '    <div id="menu-items">'
        + '      <div class="menu-item" id="menu-file">'
        + '        <span class="menu-label">\u6587\u4ef6</span>'
        + '        <div class="menu-dropdown" id="dropdown-file">'
        + '          <div class="menu-option" id="menu-back-list">\u8fd4\u56de\u5217\u8868</div>'
        + '          <div class="menu-divider"></div>'
        + '          <div class="menu-option" id="menu-clear-cache-current">\u6e05\u9664\u5f53\u524d\u7f13\u5b58</div>'
        + '          <div class="menu-option" id="menu-clear-cache-all">\u6e05\u9664\u6240\u6709\u7f13\u5b58</div>'
        + '        </div>'
        + '      </div>'
        + '      <div class="menu-item" id="menu-history">'
        + '        <span class="menu-label">\u5386\u53f2</span>'
        + '        <div class="menu-dropdown menu-dropdown-wide" id="dropdown-history">'
        + '          <div id="history-list"></div>'
        + '          <div id="history-empty" class="menu-empty">\u6682\u65e0\u64ad\u653e\u5386\u53f2</div>'
        + '        </div>'
        + '      </div>'
        + '      <div class="menu-item" id="menu-help">'
        + '        <span class="menu-label">\u5e2e\u52a9</span>'
        + '        <div class="menu-dropdown" id="dropdown-help">'
        + '          <div class="menu-option" id="menu-show-shortcuts">\u5feb\u6377\u952e\u8bf4\u660e</div>'
        + '        </div>'
        + '      </div>'
        + '    </div>'
        + '    <div id="menu-meta"></div>'
        + '  </div>'
        // --- Main content: Canvas + Sidebar ---
        + '  <div id="main-content">'
        // --- Canvas area ---
        + '    <div id="canvas-container">'
        + '      <div id="canvas-wrapper">'
        + '        <canvas id="player-canvas"></canvas>'
        + '      </div>'
        + '      <div id="loading-overlay">'
        + '        <div class="spinner"></div>'
        + '        <div id="loading-text">\u6b63\u5728\u52a0\u8f7d...</div>'
        + '        <div id="loading-progress"></div>'
        + '      </div>'
        + '      <div id="error-overlay" style="display:none">'
        + '        <div id="error-icon">&#9888;</div>'
        + '        <div id="error-text"></div>'
        + '        <button id="error-retry">\u91cd\u8bd5</button>'
        + '      </div>'
        + '      <div id="action-overlay"></div>'
        + '      <div id="shortcut-hint">'
        + '        <kbd>Space</kbd> \u6682\u505c/\u64ad\u653e'
        + '        <span class="hint-sep">|</span>'
        + '        <kbd>\u2190 \u2192</kbd> \u5feb\u9000/\u5feb\u8fdb 10s'
        + '        <span class="hint-sep">|</span>'
        + '        <kbd>+/-</kbd> \u53d8\u901f'
        + '      </div>'
        + '    </div>'
        // --- Sidebar ---
        + '    <div id="sidebar">'
        + '      <div id="sidebar-notes">'
        + '        <div class="sidebar-section-title">\ud83d\udcdd \u7b14\u8bb0</div>'
        + '        <div id="note-tags">'
        + '          <button class="note-tag tag-pass" data-tag="pass">\u901a\u8fc7</button>'
        + '          <button class="note-tag tag-fail" data-tag="fail">\u4e0d\u901a\u8fc7</button>'
        + '          <button class="note-tag tag-pending" data-tag="pending">\u5f85\u5b9a</button>'
        + '        </div>'
        + '        <textarea id="note-text" placeholder="\u8f93\u5165\u5bf9\u8be5\u5019\u9009\u4eba\u7684\u8bc4\u4ef7..."></textarea>'
        + '      </div>'
        + '      <div id="sidebar-info">'
        + '        <div class="sidebar-section-title">\ud83d\udcc4 \u4fe1\u606f</div>'
        + '        <div id="info-list"></div>'
        + '      </div>'
        + '    </div>'
        + '  </div>'
        // --- Control bar ---
        + '  <div id="control-bar">'
        + '    <div id="controls-row-1">'
        + '      <button id="btn-play" title="\u64ad\u653e/\u6682\u505c (Space)">\u25B6</button>'
        + '      <div id="progress-container">'
        + '        <div id="progress-bar">'
        + '          <div id="progress-played"></div>'
        + '          <div id="progress-handle"></div>'
        + '        </div>'
        + '      </div>'
        + '      <span id="time-display">00:00 / 00:00</span>'
        + '    </div>'
        + '    <div id="controls-row-2">'
        + '      <div id="speed-group" class="segmented-control">'
        + '        <button class="seg-btn active" data-speed="1">1x</button>'
        + '        <button class="seg-btn" data-speed="2">2x</button>'
        + '        <button class="seg-btn" data-speed="4">4x</button>'
        + '        <button class="seg-btn" data-speed="8">8x</button>'
        + '        <button class="seg-btn" data-speed="16">16x</button>'
        + '      </div>'
        + '      <div class="ctrl-separator"></div>'
        + '      <div class="toggle-group" id="skip-group">'
        + '        <div id="skip-toggle" class="toggle active"><div class="toggle-knob"></div></div>'
        + '        <span>\u8df3\u8fc7\u9759\u9ed8</span>'
        + '      </div>'
        + '      <div class="ctrl-separator"></div>'
        + '      <div class="zoom-controls">'
        + '        <button id="btn-zoom-out" class="icon-btn" title="\u7f29\u5c0f">\u2212</button>'
        + '        <span id="zoom-display">100%</span>'
        + '        <button id="btn-zoom-in" class="icon-btn" title="\u653e\u5927">+</button>'
        + '        <div class="ctrl-separator"></div>'
        + '        <button id="btn-fit" class="text-btn active" title="\u9002\u5e94\u7a97\u53e3">\u9002\u5e94</button>'
        + '        <button id="btn-original" class="text-btn" title="\u539f\u59cb\u5927\u5c0f">1:1</button>'
        + '      </div>'
        + '    </div>'
        + '  </div>'
        + '  <div id="toast-container"></div>'
        + '</div>'
        + '<script>window.__TP_RID = "' + rid + '"; window.__TP_SERVER = location.origin;<\/script>';
}
```

- [ ] **Step 2: Update the script load chain in `content-player.js`**

Replace the `loadScripts` array with the full list including new modules:

```js
loadScripts([
    extBase + 'lib/pako.min.js',
    extBase + 'lib/rle.js',
    extBase + 'js/constants.js',
    extBase + 'js/cache-manager.js',
    extBase + 'js/downloader.js',
    extBase + 'js/parser.js',
    extBase + 'js/decoder.js',
    extBase + 'js/image-cache.js',
    extBase + 'js/renderer.js',
    extBase + 'js/player.js',
    extBase + 'js/zoom.js',
    extBase + 'js/notes.js',
    extBase + 'js/history.js',
    extBase + 'js/app.js'
], 0);
```

- [ ] **Step 3: Add menu bar, sidebar, and dropdown CSS to `css/player.css`**

Append to `css/player.css`:

```css
/* === Menu Bar === */
#menu-bar {
    height: 36px;
    background: var(--bg-elevated);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    display: flex;
    align-items: center;
    padding: 0 12px;
    border-bottom: 0.5px solid var(--separator);
    flex-shrink: 0;
    z-index: 50;
    gap: 2px;
}

#menu-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin-right: 16px;
    white-space: nowrap;
}

#menu-items {
    display: flex;
    gap: 0;
}

.menu-item {
    position: relative;
}

.menu-label {
    font-size: 12px;
    color: var(--text-secondary);
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: background var(--transition);
}

.menu-label:hover,
.menu-item.open .menu-label {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
}

/* Dropdown */
.menu-dropdown {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    background: var(--bg-secondary);
    border: 0.5px solid var(--separator);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    min-width: 160px;
    padding: 4px 0;
    z-index: 100;
}

.menu-dropdown-wide {
    min-width: 280px;
    max-height: 400px;
    overflow-y: auto;
}

.menu-item.open .menu-dropdown {
    display: block;
}

.menu-option {
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text-primary);
    cursor: pointer;
    transition: background var(--transition);
}

.menu-option:hover {
    background: var(--accent);
    color: #fff;
}

.menu-divider {
    height: 0.5px;
    background: var(--separator);
    margin: 4px 0;
}

.menu-empty {
    padding: 12px;
    font-size: 12px;
    color: var(--text-tertiary);
    text-align: center;
}

/* History item */
.history-item {
    padding: 8px 12px;
    font-size: 12px;
    cursor: pointer;
    transition: background var(--transition);
    display: flex;
    align-items: center;
    gap: 10px;
}

.history-item:hover {
    background: rgba(255, 255, 255, 0.06);
}

.history-item.current {
    background: rgba(10, 132, 255, 0.12);
}

.history-item-user {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
}

.history-item-meta {
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
}

#menu-meta {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* === Main Content (Canvas + Sidebar) === */
#main-content {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
}

/* === Sidebar === */
#sidebar {
    width: 220px;
    background: var(--bg-secondary);
    border-left: 0.5px solid var(--separator);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow: hidden;
}

#sidebar-notes {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 10px;
    min-height: 0;
    overflow: hidden;
}

.sidebar-section-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 8px;
    flex-shrink: 0;
}

/* Note tags */
#note-tags {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
    flex-shrink: 0;
    flex-wrap: wrap;
}

.note-tag {
    font-size: 10px;
    padding: 3px 10px;
    border-radius: 12px;
    border: none;
    cursor: pointer;
    font-weight: 500;
    transition: all var(--transition);
}

.tag-pass {
    background: rgba(48, 209, 88, 0.12);
    color: #30d158;
}
.tag-pass.active {
    background: #30d158;
    color: #fff;
}

.tag-fail {
    background: rgba(255, 69, 58, 0.12);
    color: #ff453a;
}
.tag-fail.active {
    background: #ff453a;
    color: #fff;
}

.tag-pending {
    background: rgba(255, 159, 10, 0.12);
    color: #ff9f0a;
}
.tag-pending.active {
    background: #ff9f0a;
    color: #fff;
}

/* Note textarea */
#note-text {
    flex: 1;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: var(--radius-sm);
    padding: 8px;
    font-size: 12px;
    color: var(--text-primary);
    resize: none;
    font-family: inherit;
    line-height: 1.5;
    min-height: 60px;
}

#note-text::placeholder {
    color: var(--text-tertiary);
}

#note-text:focus {
    outline: none;
    box-shadow: 0 0 0 1px var(--accent);
}

/* Sidebar info section */
#sidebar-info {
    padding: 10px;
    border-top: 0.5px solid var(--separator);
    flex-shrink: 0;
    max-height: 140px;
    overflow-y: auto;
}

#info-list {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.8;
}

#info-list .info-label {
    color: var(--text-tertiary);
    margin-right: 4px;
}

/* Remove old top-bar styles (replaced by menu-bar) */
#top-bar { display: none; }
```

- [ ] **Step 4: Test new layout**

1. Reload extension, open a recording
2. Verify: menu bar appears at top with 文件/历史/帮助
3. Verify: sidebar appears on right (220px), notes section on top, info section on bottom
4. Verify: canvas fills remaining space
5. Verify: control bar unchanged at bottom
6. Verify: all existing playback functionality still works

- [ ] **Step 5: Commit**

```bash
git add content-player.js css/player.css
git commit -m "feat(player): add menu bar with dropdowns and notes sidebar layout"
```

---

## Task 8: Wire Up Menu, History, Notes, and Info in app.js

**Files:**
- Modify: `js/app.js`
- Modify: `manifest.json`

- [ ] **Step 1: Update `manifest.json` — add new files to web_accessible_resources**

The `resources` glob `js/*` already covers `js/cache-manager.js`, `js/notes.js`, `js/history.js`, so no change is needed for web_accessible_resources. However, verify the `css/*` glob covers `css/list.css` — it does since the pattern is `css/*`. No manifest changes needed beyond what was done in Task 1.

- [ ] **Step 2: Add menu, notes, history, and info wiring to `js/app.js`**

After the existing DOM references section, add new DOM references:

```js
// --- New DOM references ---
var menuBar = document.getElementById('menu-bar');
var menuMeta = document.getElementById('menu-meta');
var menuFile = document.getElementById('menu-file');
var menuHistory = document.getElementById('menu-history');
var menuHelp = document.getElementById('menu-help');
var historyList = document.getElementById('history-list');
var historyEmpty = document.getElementById('history-empty');
var noteTags = document.getElementById('note-tags');
var noteText = document.getElementById('note-text');
var infoList = document.getElementById('info-list');
```

After the core instances section, add notes and history instances:

```js
var notes = TPP.createNotes(rid);
var history = TPP.createHistory();
```

Add menu dropdown toggle logic (before `// --- Init & load ---`):

```js
// --- Menu dropdown logic ---
function closeAllMenus() {
    var items = document.querySelectorAll('.menu-item');
    for (var i = 0; i < items.length; i++) items[i].classList.remove('open');
}

function toggleMenu(menuItem) {
    var isOpen = menuItem.classList.contains('open');
    closeAllMenus();
    if (!isOpen) menuItem.classList.add('open');
}

menuFile.querySelector('.menu-label').addEventListener('click', function (e) {
    e.stopPropagation();
    toggleMenu(menuFile);
});
menuHistory.querySelector('.menu-label').addEventListener('click', function (e) {
    e.stopPropagation();
    populateHistory();
    toggleMenu(menuHistory);
});
menuHelp.querySelector('.menu-label').addEventListener('click', function (e) {
    e.stopPropagation();
    toggleMenu(menuHelp);
});

// Close menus on outside click
document.addEventListener('click', function () { closeAllMenus(); });

// Prevent dropdown clicks from closing
document.querySelectorAll('.menu-dropdown').forEach(function (dd) {
    dd.addEventListener('click', function (e) { e.stopPropagation(); });
});

// File menu actions
document.getElementById('menu-back-list').addEventListener('click', function () {
    closeAllMenus();
    window.location.href = '/audit/record';
});

document.getElementById('menu-clear-cache-current').addEventListener('click', function () {
    cacheManager.clearCurrent().then(function () {
        showToast('\u5f53\u524d\u5f55\u50cf\u7f13\u5b58\u5df2\u6e05\u9664', 'info');
        updateInfoPanel();
    });
    closeAllMenus();
});

document.getElementById('menu-clear-cache-all').addEventListener('click', function () {
    cacheManager.clearAll().then(function () {
        showToast('\u6240\u6709\u7f13\u5b58\u5df2\u6e05\u9664', 'info');
        updateInfoPanel();
    });
    closeAllMenus();
});

// Help menu
document.getElementById('menu-show-shortcuts').addEventListener('click', function () {
    closeAllMenus();
    showShortcutHint();
});

// --- History panel ---
function populateHistory() {
    var items = history.getAll();
    historyList.innerHTML = '';
    historyEmpty.style.display = items.length === 0 ? 'block' : 'none';
    for (var i = 0; i < items.length; i++) {
        (function (item) {
            var div = document.createElement('div');
            div.className = 'history-item' + (String(item.rid) === String(rid) ? ' current' : '');
            div.innerHTML = ''
                + '<span class="history-item-user">' + (item.user || 'Unknown') + '</span>'
                + '<span class="history-item-meta">' + (item.duration || '') + ' | ' + (item.date || '') + '</span>';
            div.addEventListener('click', function () {
                closeAllMenus();
                if (String(item.rid) === String(rid)) return;
                // Navigate to the recording
                window.location.href = '/audit/replay/1/' + item.rid + '?tp_web_player=1&rid=' + item.rid;
            });
            historyList.appendChild(div);
        })(items[i]);
    }
}

// --- Notes panel ---
function initNotes() {
    var note = notes.get();

    // Set initial tag state
    var tagBtns = noteTags.querySelectorAll('.note-tag');
    for (var i = 0; i < tagBtns.length; i++) {
        tagBtns[i].classList.toggle('active', tagBtns[i].getAttribute('data-tag') === note.tag);
    }

    // Set initial text
    noteText.value = note.text || '';

    // Tag click handlers
    for (var j = 0; j < tagBtns.length; j++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                var updated = notes.setTag(btn.getAttribute('data-tag'));
                for (var k = 0; k < tagBtns.length; k++) {
                    tagBtns[k].classList.toggle('active', tagBtns[k].getAttribute('data-tag') === updated.tag);
                }
            });
        })(tagBtns[j]);
    }

    // Text input with debounce
    var debounceTimer;
    noteText.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
            notes.setText(noteText.value);
        }, 500);
    });
}

// --- Info panel ---
function updateInfoPanel(header) {
    if (!infoList) return;
    // header may not be available yet; use stored data
    if (header) {
        window.__TP_HEADER = header;
    }
    var h = window.__TP_HEADER;
    if (!h) {
        infoList.innerHTML = '<span class="info-label">\u52a0\u8f7d\u4e2d...</span>';
        return;
    }
    var cacheSize = cacheManager.getCacheSize();
    var cacheSizeMB = (cacheSize / 1024 / 1024).toFixed(1);
    var cacheText = cacheSize > 0 ? '\u5df2\u7f13\u5b58 (' + cacheSizeMB + ' MB)' : '\u672a\u7f13\u5b58';

    infoList.innerHTML = ''
        + '<div><span class="info-label">\u7528\u6237:</span>' + h.userUsername + '</div>'
        + '<div><span class="info-label">\u65f6\u957f:</span>' + formatTime(h.timeMs) + '</div>'
        + '<div><span class="info-label">\u5206\u8fa8\u7387:</span>' + h.width + ' \u00d7 ' + h.height + '</div>'
        + '<div><span class="info-label">\u8fdc\u7a0b:</span>' + h.accUsername + '@' + h.hostIp + '</div>'
        + '<div><span class="info-label">\u7f13\u5b58:</span>' + cacheText + '</div>';
}
```

In `init()`, after the header is parsed and `renderer.init` / `zoom.init` are called, add:

```js
// Update menu meta
menuMeta.textContent = header.userUsername + ' | ' + new Date(header.timestamp * 1000).toLocaleString('zh-CN');

// Record to history
history.add({
    rid: rid,
    user: header.userUsername + ' (' + header.accUsername + ')',
    duration: formatTime(header.timeMs),
    date: new Date(header.timestamp * 1000).toLocaleDateString('zh-CN'),
    timestamp: Date.now()
});

// Update info panel
updateInfoPanel(header);
```

At the very end of the IIFE (after `init()`), add:

```js
initNotes();
```

Also update the keyboard handler to skip when textarea is focused (the existing check already handles `TEXTAREA` — verify it's there):

```js
if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
```

This is already present, so no change needed.

- [ ] **Step 3: Test everything together**

1. Reload extension, open a recording
2. Menu bar: click 文件 → dropdown appears. Click 返回列表 → navigates back
3. Menu bar: click 历史 → shows current recording. Open another recording, go back to first → history shows both
4. Menu bar: click 帮助 → 快捷键说明 → shortcut hint bar reappears
5. Sidebar notes: click 通过/不通过/待定 tags — toggles correctly
6. Sidebar notes: type in textarea — close and reopen same recording — text is preserved
7. Sidebar info: shows user, duration, resolution, remote, cache status
8. File → 清除当前缓存 → cache status updates to "未缓存"
9. All existing playback features still work

- [ ] **Step 4: Commit**

```bash
git add js/app.js manifest.json
git commit -m "feat(player): wire up menu bar, history, notes sidebar, and info panel"
```

---

## Task 9: List Page — Show Cache & Note Status

**Files:**
- Modify: `content-list.js`

- [ ] **Step 1: Add cache and note indicators to card rendering**

In `content-list.js`, the `renderCard` function already reads notes and shows tags. Add cache indicator support.

In the `renderCard` function, before the `rightHtml` construction, add:

```js
var cachedHtml = '';
try {
    var cacheMeta = JSON.parse(localStorage.getItem('tp_cache_meta')) || {};
    if (data.recordId && cacheMeta[data.recordId]) {
        cachedHtml = '<span class="tp-card-cached" title="\u5df2\u7f13\u5b58">\u25cf</span>';
    }
} catch (e) { /* ignore */ }
```

Then in the play button HTML, prepend `cachedHtml`:

```js
rightHtml = ''
    + '<div class="tp-card-duration ' + (isLong ? 'long' : 'short') + '">' + data.durationFormatted + '</div>'
    + cachedHtml
    + '<button class="tp-card-play" data-rid="' + (data.recordId || '') + '">&#9654; \u64ad\u653e</button>';
```

- [ ] **Step 2: Test**

1. Play a recording (gets cached)
2. Go back to list — the card for that recording should show a blue dot
3. Cards with notes should show the tag label (通过/不通过/待定)

- [ ] **Step 3: Commit**

```bash
git add content-list.js
git commit -m "feat(list): show cache and note indicators on cards"
```

---

## Task 10: Final Integration Test & Cleanup

**Files:**
- All modified files

- [ ] **Step 1: Full manual test checklist**

Test on a real Teleport instance:

**List page:**
- [ ] Original table hidden, cards render correctly
- [ ] User names display Chinese name, English ID in tooltip
- [ ] Duration ≥58min is blue, <58min is green
- [ ] "使用中" sessions show pulse dot, no play button
- [ ] Cached recordings show blue dot
- [ ] Notes tags show on cards
- [ ] Play button opens player in new tab
- [ ] Pagination/refresh re-renders cards
- [ ] Works at 1024px, 1440px, 1920px widths

**Player:**
- [ ] Menu bar: 文件/历史/帮助 dropdowns work
- [ ] Menu bar: 返回列表 navigates correctly
- [ ] Menu bar: 清除缓存 works
- [ ] Menu bar: right side shows user + date
- [ ] History: shows recent recordings, clicking switches playback
- [ ] Sidebar: notes tags toggle (pass/fail/pending)
- [ ] Sidebar: textarea saves with debounce, persists on reload
- [ ] Sidebar: info section shows metadata + cache status
- [ ] Keyboard: Space shows YouTube-style play/pause animation
- [ ] Keyboard: ← → shows seek indicators
- [ ] Keyboard: shortcuts don't fire when typing in textarea
- [ ] Shortcut hint: appears on load, fades after 3s
- [ ] Cache: first load downloads, second load is instant from cache
- [ ] All existing features: zoom, speed, skip silence, progress bar seek

- [ ] **Step 2: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration test fixes"
```
