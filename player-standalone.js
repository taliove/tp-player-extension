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

    // --- Get own tab ID for targeted messaging ---
    var ownTabId = null;
    if (chrome.tabs && chrome.tabs.getCurrent) {
        chrome.tabs.getCurrent(function(tab) {
            if (tab) ownTabId = tab.id;
        });
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
