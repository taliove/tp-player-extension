// Teleport Assessment Reviewer — Standalone Player Init
// Sets __TP_RID from URL params, reads server URL from chrome.storage,
// sets __TP_SERVER, then dynamically loads app.js.
// Handles switch-recording messages for single-tab reuse.
(function() {
    'use strict';

    // Set RID from URL params (inline scripts are blocked by extension CSP)
    var params = new URLSearchParams(location.search);
    window.__TP_RID = params.get('rid') || '';
    window.__TP_FROM_EXT = params.get('from') === 'ext';
    document.title = window.__TP_RID ? ('RDP 录屏 #' + window.__TP_RID) : 'RDP 录屏回放';

    // Pre-hide sidebar when opened from extension to prevent flicker —
    // the sidebar-state port message will properly restore visibility if needed
    if (window.__TP_FROM_EXT) {
        var _sb = document.getElementById('sidebar');
        var _rh = document.getElementById('sidebar-resize-handle');
        if (_sb) _sb.style.display = 'none';
        if (_rh) _rh.style.display = 'none';
    }

    if (!window.__TP_RID) {
        document.getElementById('loading-overlay').style.display = 'none';
        var errOverlay = document.getElementById('error-overlay');
        var errText = document.getElementById('error-text');
        if (errOverlay && errText) {
            errOverlay.style.display = '';
            errText.textContent = '缺少参数: rid (录制ID)';
        }
        return;
    }

    // Read server URL from storage, then load app.js
    chrome.storage.local.get('tp_server_url', function(data) {
        if (data.tp_server_url) {
            window.__TP_SERVER = data.tp_server_url.replace(/\/+$/, '');
        } else {
            window.__TP_SERVER = location.origin;
        }

        // Now load app.js — it will read __TP_SERVER and __TP_RID synchronously
        var script = document.createElement('script');
        script.src = 'js/app.js';
        script.onerror = function() {
            document.getElementById('loading-overlay').style.display = 'none';
            var errOverlay = document.getElementById('error-overlay');
            var errText = document.getElementById('error-text');
            if (errOverlay && errText) {
                errOverlay.style.display = '';
                errText.textContent = '加载播放器模块失败';
            }
        };
        document.body.appendChild(script);
    });

    // --- Player port for sidebar detection + tab ID ---
    var ownTabId = null;
    if (chrome.tabs && chrome.tabs.getCurrent) {
        chrome.tabs.getCurrent(function(tab) {
            if (tab) ownTabId = tab.id;
            // Connect with tab-specific port name
            connectPlayerPort(tab ? tab.id : 0);
        });
    } else {
        connectPlayerPort(0);
    }

    function connectPlayerPort(tabId) {
        try {
            var port = chrome.runtime.connect({ name: 'player-' + tabId });
            port.onMessage.addListener(function(msg) {
                if (msg.type === 'sidebar-state') {
                    autoCollapseSidebar(msg.open);
                }
            });
        } catch(e) {
            console.warn('[Player] Port connection failed:', e);
        }
    }

    // --- Auto-collapse player sidebar when extension sidebar is open ---
    function autoCollapseSidebar(sidebarOpen) {
        var sidebar = document.getElementById('sidebar');
        var expandBtn = document.getElementById('btn-sidebar-expand');
        var resizeHandle = document.getElementById('sidebar-resize-handle');
        if (!sidebar) return;

        if (sidebarOpen) {
            // Extension sidebar is open — collapse player sidebar for more canvas space
            sidebar.style.display = 'none';
            if (expandBtn) expandBtn.style.display = '';
            if (resizeHandle) resizeHandle.style.display = 'none';
            // Trigger zoom resize to fill the space
            if (window.__TP_ZOOM) {
                try { window.__TP_ZOOM.handleResize(); } catch(e) {}
            }
        } else {
            // Extension sidebar closed — restore player sidebar
            sidebar.style.display = '';
            if (expandBtn) expandBtn.style.display = '';
            if (resizeHandle) resizeHandle.style.display = '';
            if (window.__TP_ZOOM) {
                try { window.__TP_ZOOM.handleResize(); } catch(e) {}
            }
        }
    }

    // --- Switch-recording message handler (for single-tab reuse) ---
    chrome.runtime.onMessage.addListener(function(message) {
        if (!message || message.type !== 'switch-recording') return;
        // Ignore messages targeting other tabs
        if (message.targetTabId && ownTabId && message.targetTabId !== ownTabId) return;
        var newRid = message.rid;
        if (!newRid || String(newRid) === String(window.__TP_RID)) return;

        if (typeof window.__TP_RESET === 'function') {
            // Hot-reload: app.js exposes resetPlayer
            try {
                window.__TP_RESET(newRid);
            } catch (e) {
                console.error('[Player] resetPlayer failed, falling back to reload:', e);
                location.replace('player.html?rid=' + newRid + '&from=ext');
            }
        } else {
            // Fallback: full page reload
            location.replace('player.html?rid=' + newRid + '&from=ext');
        }
    });

    // Handle auth expiry
    window.addEventListener('tp-auth-expired', function() {
        chrome.runtime.sendMessage({ type: 're-login' }, function(resp) {
            if (resp && resp.success) {
                location.reload();
            } else {
                document.getElementById('loading-overlay').style.display = 'none';
                var errOverlay = document.getElementById('error-overlay');
                var errText = document.getElementById('error-text');
                if (errOverlay && errText) {
                    errOverlay.style.display = '';
                    errText.textContent = '认证已过期，请重新登录';
                }
            }
        });
    });
})();
