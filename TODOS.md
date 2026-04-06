# TODOS.md — Teleport tp-player-extension

## Phase 1.5a

### Storage migration: localStorage → chrome.storage.local
- **What:** Migrate notes.js, history.js, app.js (preferences), cache-manager.js from localStorage to chrome.storage.local via extBridge
- **Why:** localStorage is per-page-scoped. Sidebar and player see different data. Notes tagged in sidebar don't appear in player. This is a current bug.
- **Data migration:** On first load after update, check if localStorage has data with `tp_player_notes` / `tp_play_history` keys. If yes, read them, write to chrome.storage.local, then delete from localStorage. Run once, idempotent.
- **Depends on:** Nothing. Ship in Phase 1.5a.

### resetPlayer() failure fallback
- **What:** When implementing resetPlayer() for tab reuse (Phase 1.5b), wrap the reinitialization in try-catch. If any module fails to reinitialize, fall back to location.reload().
- **Why:** Hot reload requires all modules (downloader, parser, decoder, renderer, notes, history, AI) to reset cleanly. If any fails, the player is in a broken state. Fallback to full page reload prevents stuck UI.
- **Depends on:** Phase 1.5b (tab reuse implementation).

## Deferred to Phase 2

### Multi-server profile support
- **What:** Save multiple server URL + credential sets. Quick-switch between servers.
- **Why:** Some users may review recordings across multiple Teleport instances.
- **Depends on:** Phase 1.5a config management landed.

### Recording data caching
- **What:** Cache previously-loaded recording binary data in IndexedDB for faster replay on re-reviews.
- **Why:** Large recordings take time to download. Caching enables instant replay on second view.
- **Risk:** chrome.storage quota (~10MB per extension). Need eviction strategy.

### Push notifications for new recordings
- **What:** Chrome notifications API when new recordings appear for the user's watched exam topics.
- **Why:** Interviewers currently rely on Feishu messages to know when to review.
- **Depends on:** Phase 1.5a host filtering (defines which topics the user cares about).

### Create DESIGN.md
- **What:** Document the design system: colors, fonts, spacing scale, animation timing, component patterns (cards, tabs, toggles, context menus).
- **Why:** Currently the design system is implicit (spread across CSS files). tokens.css from Phase 1.5a is the starting point. DESIGN.md formalizes it for consistency.
- **Depends on:** Phase 1.5a tokens.css landed.
