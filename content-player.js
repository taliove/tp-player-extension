// Content script for /audit/replay/* pages
// When ?tp_web_player=1 is in the URL, replaces the original page with our web player.
//
// How it works:
//   1. Runs at document_start (before original page loads)
//   2. Replaces the entire document with our player HTML
//   3. Injects pako.min.js, rle.js, and split JS modules from extension resources
//   4. Scripts run in the page's main world → fetch() is same-origin → cookies included
//
// This avoids all CORS/cookie issues because the page URL stays on the Teleport server.

(function () {
    'use strict';

    var params = new URLSearchParams(location.search);
    if (!params.has('tp_web_player')) return; // not our page — let original replay work

    var rid = params.get('rid') || location.pathname.split('/').pop();
    var extBase = chrome.runtime.getURL('');

    // Immediately hide page to prevent FOUC — visible only after player.css loads
    var _hideStyle = document.createElement('style');
    _hideStyle.textContent = 'html{visibility:hidden!important;background:#1c1c1e}';
    (document.head || document.documentElement).appendChild(_hideStyle);

    // Replace the entire document at document_start (before original page loads)
    document.addEventListener('DOMContentLoaded', function () {
        takeover();
    });

    // Also try immediately in case DOMContentLoaded already fired
    if (document.readyState !== 'loading') {
        takeover();
    }

    var taken = false;
    function takeover() {
        if (taken) return;
        taken = true;

        // Stop original page from loading (prevents stray scripts/errors)
        window.stop();

        // Clear the page
        document.head.innerHTML = '';
        document.body.innerHTML = '';

        // Keep hidden until player.css loads (re-inject after head clear)
        var hideStyle = document.createElement('style');
        hideStyle.textContent = 'html{visibility:hidden!important;background:#1c1c1e}';
        document.head.appendChild(hideStyle);

        // -- Head --
        appendMeta('charset', 'UTF-8');
        appendMeta('name', 'viewport', 'width=device-width, initial-scale=1.0');
        appendLink(extBase + 'css/player.css');
        document.title = 'RDP 录屏回放';

        // -- Body (player HTML) --
        document.body.innerHTML = getPlayerHTML();

        // -- Scripts (load in order: libs → constants → modules → app) --
        function loadScripts(srcs, idx) {
            if (idx >= srcs.length) return;
            loadScript(srcs[idx], function() { loadScripts(srcs, idx + 1); });
        }
        loadScripts([
            extBase + 'lib/pako.min.js',
            extBase + 'lib/rle.js',
            extBase + 'js/constants.js',
            extBase + 'js/ext-bridge.js',
            extBase + 'js/ai-settings.js',
            extBase + 'js/prompt-templates.js',
            extBase + 'js/report-cache.js',
            extBase + 'js/ai-analyzer.js',
            extBase + 'js/report-panel.js',
            extBase + 'js/host-resolver.js',
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
    }

    function appendMeta(attr, name, content) {
        var meta = document.createElement('meta');
        if (attr === 'charset') { meta.setAttribute('charset', name); }
        else { meta.name = name; meta.content = content; }
        document.head.appendChild(meta);
    }

    function appendLink(href) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    }

    function loadScript(src, onload) {
        var script = document.createElement('script');
        script.src = src;
        if (onload) script.onload = onload;
        document.body.appendChild(script);
    }

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
            + '          <div class="menu-option" id="menu-show-shortcuts">\u5feb\u6377\u952e\u8bf4\u660e \u2714</div>'
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
            + '      <div id="shortcut-hint" class="hidden">'
            + '        <kbd>Space</kbd> \u6682\u505c/\u64ad\u653e'
            + '        <span class="hint-sep">|</span>'
            + '        <kbd>\u2190 \u2192</kbd> \u5feb\u9000/\u5feb\u8fdb 10s'
            + '        <span class="hint-sep">|</span>'
            + '        <kbd>+/-</kbd> \u53d8\u901f'
            + '      </div>'
            + '    </div>'
            + '    <button id="btn-sidebar-expand" title="\u5c55\u5f00\u4fa7\u680f">\u276e</button>'
            // --- Sidebar ---
            + '    <div id="sidebar-resize-handle"></div>'
            + '    <div id="sidebar">'
            + '      <div id="sidebar-header">'
            + '        <div id="sidebar-tabs">'
            + '          <button class="sidebar-tab active" data-tab="notes">\u7b14\u8bb0</button>'
            + '          <button class="sidebar-tab" data-tab="info">\u4fe1\u606f</button>'
            + '          <button class="sidebar-tab" data-tab="ai-report">AI \u62a5\u544a</button>'
            + '        </div>'
            + '        <button id="btn-sidebar-toggle" class="sidebar-toggle-btn" title="\u6536\u8d77\u4fa7\u680f">\u276f</button>'
            + '      </div>'
            + '      <div id="sidebar-panels">'
            + '        <div id="panel-notes" class="sidebar-panel active">'
            + '          <div id="note-tags">'
            + '            <span class="note-tag tag-pass" data-tag="pass">\u901a\u8fc7</span>'
            + '            <span class="note-tag tag-fail" data-tag="fail">\u6dd8\u6c70</span>'
            + '            <span class="note-tag tag-pending" data-tag="pending">\u5f85\u5b9a</span>'
            + '          </div>'
            + '          <textarea id="note-text" placeholder="\u8f93\u5165\u8bc4\u4f30\u7b14\u8bb0..."></textarea>'
            + '        </div>'
            + '        <div id="panel-info" class="sidebar-panel">'
            + '          <div id="info-list">'
            + '            <span class="info-label">\u52a0\u8f7d\u4e2d...</span>'
            + '          </div>'
            + '        </div>'
            + '        <div id="panel-ai-report" class="sidebar-panel">'
            + '          <div id="ai-report-content">'
            + '            <div id="ai-report-idle">'
            + '              <div class="ai-report-status-icon">\ud83e\udd16</div>'
            + '              <div class="ai-report-status-text">AI \u5206\u6790\u5c31\u7eea</div>'
            + '              <div id="ai-frame-estimate"></div>'
            + '              <button id="btn-ai-analyze" class="ai-btn-primary" disabled>\u6570\u636e\u52a0\u8f7d\u4e2d...</button>'
            + '              <div class="ai-auto-group" id="ai-auto-group">'
            + '                <span>\u81ea\u52a8\u5206\u6790</span>'
            + '                <div class="toggle" id="chk-ai-auto"><div class="toggle-knob"></div></div>'
            + '              </div>'
            + '              <button id="btn-ai-settings" class="ai-btn-secondary" style="margin-top:8px">&#9881; \u8bbe\u7f6e</button>'
            + '            </div>'
            + '            <div id="ai-report-progress" style="display:none">'
            + '              <div class="ai-progress-bar-container">'
            + '                <div id="ai-progress-bar" class="ai-progress-bar"></div>'
            + '              </div>'
            + '              <div id="ai-progress-text">\u51c6\u5907\u4e2d...</div>'
            + '              <button id="btn-ai-cancel" class="ai-btn-secondary">\u53d6\u6d88</button>'
            + '            </div>'
            + '            <div id="ai-report-result" style="display:none"></div>'
            + '            <div id="ai-settings-panel" style="display:none">'
            + '              <div class="ai-report-section-title">API \u914d\u7f6e</div>'
            + '              <div class="ai-settings-form">'
            + '                <label class="ai-settings-label">\u534f\u8bae</label>'
            + '                <div class="ai-settings-radio">'
            + '                  <label><input type="radio" name="ai-protocol" value="claude" checked> Claude API</label>'
            + '                  <label><input type="radio" name="ai-protocol" value="openai"> OpenAI \u517c\u5bb9</label>'
            + '                </div>'
            + '                <label class="ai-settings-label">Endpoint</label>'
            + '                <input type="text" id="ai-set-endpoint" class="ai-settings-input" placeholder="https://api.anthropic.com">'
            + '                <label class="ai-settings-label">API Key</label>'
            + '                <div class="ai-settings-key-row">'
            + '                  <input type="password" id="ai-set-apikey" class="ai-settings-input" placeholder="sk-...">'
            + '                  <button id="btn-ai-toggle-key" class="ai-btn-icon">&#128065;</button>'
            + '                </div>'
            + '                <label class="ai-settings-label">Model</label>'
            + '                <input type="text" id="ai-set-model" class="ai-settings-input" placeholder="claude-sonnet-4-6-20250514">'
            + '              </div>'
            + '              <div class="ai-report-section-title" style="margin-top:12px">\u5c97\u4f4d\u6a21\u677f</div>'
            + '              <select id="ai-set-template" class="ai-settings-input"></select>'
            + '              <div class="ai-report-section-title" style="margin-top:12px">\u9ad8\u7ea7</div>'
            + '              <div class="ai-settings-form">'
            + '                <label class="ai-settings-label">\u672b\u6bb5\u5bc6\u91c7\u65f6\u957f (\u5206\u949f)</label>'
            + '                <input type="number" id="ai-set-end-minutes" class="ai-settings-input" min="1" max="30" value="5">'
            + '                <label class="ai-settings-label">\u8df3\u8fc7\u5f00\u5934 (\u79d2)</label>'
            + '                <input type="number" id="ai-set-skip-start" class="ai-settings-input" min="0" max="600" value="300">'
            + '                <label class="ai-settings-label">\u6700\u5927\u91c7\u5e27\u6570</label>'
            + '                <input type="number" id="ai-set-max-frames" class="ai-settings-input" min="10" max="200" value="80">'
            + '                <label class="ai-settings-label">API \u8d85\u65f6 (\u79d2)</label>'
            + '                <input type="number" id="ai-set-timeout" class="ai-settings-input" min="30" max="600" value="120">'
            + '              </div>'
            + '              <div class="ai-settings-actions">'
            + '                <button id="btn-ai-import" class="ai-btn-secondary">\u4ece\u6587\u4ef6\u5bfc\u5165</button>'
            + '                <button id="btn-ai-test" class="ai-btn-secondary">\u6d4b\u8bd5\u8fde\u63a5</button>'
            + '                <input type="file" id="ai-import-file" accept=".json" style="display:none">'
            + '              </div>'
            + '              <div class="ai-settings-actions" style="margin-top:8px">'
            + '                <button id="btn-ai-save-settings" class="ai-btn-primary">\u4fdd\u5b58</button>'
            + '                <button id="btn-ai-cancel-settings" class="ai-btn-secondary">\u8fd4\u56de</button>'
            + '              </div>'
            + '            </div>'
            + '          </div>'
            + '        </div>'
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
            + '    <div id="shortcut-bar">'
            + '      <kbd>Space</kbd> \u6682\u505c/\u64ad\u653e'
            + '      <span class="hint-sep">|</span>'
            + '      <kbd>\u2190 \u2192</kbd> \u5feb\u9000/\u5feb\u8fdb 10s'
            + '      <span class="hint-sep">|</span>'
            + '      <kbd>+/-</kbd> \u53d8\u901f'
            + '    </div>'
            + '  </div>'
            + '  <div id="toast-container"></div>'
            + '</div>'
            + '<script>window.__TP_RID = "' + rid + '"; window.__TP_SERVER = location.origin;<\/script>';
    }
    // --- Extension API Bridge (isolated world) ---
    // Relays requests from main world scripts to Chrome extension APIs
    window.addEventListener('message', function(event) {
        if (event.source !== window) return;
        if (!event.data || event.data.type !== '__tp_to_ext') return;
        var msg = event.data;
        var id = msg.id;

        function respond(result, error) {
            window.postMessage({
                type: '__tp_from_ext',
                id: id,
                result: result,
                error: error || null
            }, location.origin);
        }

        // Guard: if extension was reloaded, chrome.runtime becomes invalid
        if (!chrome.runtime || !chrome.runtime.id) {
            respond(null, 'Extension context invalidated — please refresh the page');
            return;
        }

        var payload = msg.payload || {};
        try {
            if (msg.action === 'storage-get') {
                chrome.storage.local.get(payload.keys, function(data) {
                    if (chrome.runtime.lastError) {
                        respond(null, chrome.runtime.lastError.message);
                    } else {
                        respond(data);
                    }
                });
            } else if (msg.action === 'storage-set') {
                // Only allow known storage keys
                var allowedKeys = ['tp_ai_settings', 'tp_report_cache'];
                var keys = Object.keys(payload.data || {});
                for (var ak = 0; ak < keys.length; ak++) {
                    if (allowedKeys.indexOf(keys[ak]) < 0) {
                        respond(null, 'Blocked: storage key "' + keys[ak] + '" not in allowlist');
                        return;
                    }
                }
                chrome.storage.local.set(payload.data, function() {
                    if (chrome.runtime.lastError) {
                        respond(null, chrome.runtime.lastError.message);
                    } else {
                        respond(true);
                    }
                });
            } else if (msg.action === 'fetch-proxy') {
                // Validate URL: only allow known AI API hosts and same-origin
                var allowedHosts = ['api.anthropic.com', 'api.openai.com'];
                var fetchUrl;
                try { fetchUrl = new URL(payload.url); } catch(e) { respond(null, 'Invalid URL'); return; }
                var isSameOrigin = fetchUrl.origin === location.origin;
                var isAllowedHost = allowedHosts.indexOf(fetchUrl.hostname) >= 0;
                var isCustomEndpoint = fetchUrl.pathname.indexOf('/v1/messages') >= 0
                    || fetchUrl.pathname.indexOf('/v1/chat/completions') >= 0;
                if (!isSameOrigin && !isAllowedHost && !isCustomEndpoint) {
                    respond(null, 'Blocked: URL host not in allowlist');
                    return;
                }

                var controller = new AbortController();
                var timer = setTimeout(function() { controller.abort(); }, payload.timeoutMs || 120000);
                fetch(payload.url, {
                    method: payload.method || 'POST',
                    headers: payload.headers || {},
                    body: payload.body || null,
                    signal: controller.signal
                }).then(function(resp) {
                    clearTimeout(timer);
                    return resp.text().then(function(text) {
                        respond({ status: resp.status, ok: resp.ok, text: text });
                    });
                }).catch(function(err) {
                    clearTimeout(timer);
                    respond(null, err.name === 'AbortError'
                        ? 'API request timeout (' + ((payload.timeoutMs || 120000) / 1000) + 's)'
                        : err.message);
                });
            } else if (msg.action === 'send-message') {
                chrome.runtime.sendMessage(payload.msg).then(function(response) {
                    respond(response);
                }).catch(function(err) {
                    respond(null, err.message);
                });
            } else {
                respond(null, 'Unknown bridge action: ' + msg.action);
            }
        } catch (e) {
            respond(null, 'Bridge error: ' + e.message);
        }
    });
})();
