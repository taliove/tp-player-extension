// Teleport Assessment Reviewer — Standalone Player Init
// Sets __TP_RID from URL params, reads server URL from chrome.storage,
// sets __TP_SERVER, then dynamically loads app.js.
(function() {
    'use strict';

    // Set RID from URL params (inline scripts are blocked by extension CSP)
    var params = new URLSearchParams(location.search);
    window.__TP_RID = params.get('rid') || '';
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

    // Override "返回列表" behavior: close tab instead of navigating
    var backBtn = document.getElementById('menu-back-list');
    if (backBtn) {
        backBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            window.close();
        }, true);
    }

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
