// Teleport Assessment Reviewer — Background Service Worker
// Auth management, API proxy, auto-re-login alarms, VL API proxy.

importScripts('js/auth-manager.js', 'js/api-proxy.js');

var authManager = TP.createAuthManager();
var apiProxy = TP.createAPIProxy(authManager);

// --- Port-based sidebar detection ---
var sidebarPort = null;
var playerPorts = [];

chrome.runtime.onConnect.addListener(function(port) {
    if (port.name === 'sidebar') {
        sidebarPort = port;
        // Notify all player tabs that sidebar is open
        for (var i = 0; i < playerPorts.length; i++) {
            try { playerPorts[i].postMessage({ type: 'sidebar-state', open: true }); } catch(e) {}
        }
        port.onDisconnect.addListener(function() {
            sidebarPort = null;
            // Notify all player tabs that sidebar is closed
            for (var j = 0; j < playerPorts.length; j++) {
                try { playerPorts[j].postMessage({ type: 'sidebar-state', open: false }); } catch(e) {}
            }
        });
    }
    if (port.name.indexOf('player-') === 0) {
        playerPorts.push(port);
        // Send current sidebar state immediately
        port.postMessage({ type: 'sidebar-state', open: sidebarPort !== null });
        port.onDisconnect.addListener(function() {
            playerPorts = playerPorts.filter(function(p) { return p !== port; });
        });
    }
});

// --- Top-level init (runs on every service worker wake) ---
// Always open sidebar on icon click — login is now in the sidebar
(function() {
    chrome.action.setPopup({ popup: '' });
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function() {});
    chrome.storage.local.get('tp_auth_state', function(data) {
        if (data.tp_auth_state === 'authenticated') {
            chrome.alarms.get('tp-relogin', function(alarm) {
                if (!alarm) chrome.alarms.create('tp-relogin', { periodInMinutes: 50 });
            });
            chrome.alarms.get('tp-refresh-records', function(alarm) {
                if (!alarm) chrome.alarms.create('tp-refresh-records', { periodInMinutes: 1 });
            });
        }
    });
})();

// --- Install handler ---
chrome.runtime.onInstalled.addListener(function() {
    console.log('[BG] Service worker installed');
    // Self-test
    fetch('https://httpbin.org/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"test":true}'
    }).then(function(r) {
        console.log('[BG] Fetch self-test:', r.status === 200 ? 'OK' : 'HTTP ' + r.status);
    }).catch(function(e) {
        console.error('[BG] Fetch self-test FAILED:', e.name, e.message);
    });
});

// --- Alarm handler ---
chrome.alarms.onAlarm.addListener(function(alarm) {
    if (alarm.name === 'tp-relogin') {
        // Auto re-login: try type 1 (no captcha) first, then type 2 without captcha
        // If server requires captcha, auto-re-login will fail silently
        // and the next API call will trigger manual re-login
        authManager.loadCredentials().then(function(creds) {
            if (!creds) return;
            return authManager.doLogin(creds.url, creds.username, creds.password, '');
        }).then(function() {
            chrome.storage.local.set({ tp_last_login: Date.now() });
            console.log('[BG] Auto re-login OK');
        }).catch(function(err) {
            console.warn('[BG] Auto re-login failed:', err.message, '(will retry on next API call)');
        });
    }
    if (alarm.name === 'tp-refresh-records') {
        chrome.runtime.sendMessage({ type: 'records-refresh-tick' }).catch(function() {});
    }
});

// --- Message handler ---
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (!message || !message.type) return false;

    // --- Auth: login ---
    if (message.type === 'login') {
        var url = message.url;
        var username = message.username;
        var password = message.password;
        var captcha = message.captcha || '';
        var remember = message.remember !== false;

        authManager.doLogin(url, username, password, captcha).then(function() {
            return authManager.saveCredentials(url, username, password, remember);
        }).then(function() {
            chrome.storage.local.set({
                tp_auth_state: 'authenticated',
                tp_last_login: Date.now(),
                tp_server_url: url,
                tp_username: username
            });
            // Sidebar is always the primary UI — no popup swap needed
            chrome.alarms.create('tp-relogin', { periodInMinutes: 50 });
            chrome.alarms.create('tp-refresh-records', { periodInMinutes: 1 });
            sendResponse({ success: true });
        }).catch(function(err) {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    // --- Auth: logout ---
    if (message.type === 'logout') {
        authManager.clearCredentials().then(function() {
            chrome.storage.local.set({ tp_auth_state: 'unauthenticated' });
            // Sidebar shows login form — no popup swap needed
            chrome.alarms.clear('tp-relogin');
            chrome.alarms.clear('tp-refresh-records');
            sendResponse({ success: true });
        });
        return true;
    }

    // --- Auth: re-login (from player tab on 401) ---
    if (message.type === 're-login') {
        authManager.loadCredentials().then(function(creds) {
            if (!creds) throw new Error('No saved credentials');
            // Try without captcha first (type 1)
            return authManager.doLogin(creds.url, creds.username, creds.password, '');
        }).then(function() {
            chrome.storage.local.set({ tp_last_login: Date.now() });
            sendResponse({ success: true });
        }).catch(function(err) {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    // --- Auth: get state ---
    if (message.type === 'get-auth-state') {
        chrome.storage.local.get(['tp_auth_state', 'tp_server_url', 'tp_username'], function(data) {
            sendResponse(data);
        });
        return true;
    }

    // --- API: get records ---
    if (message.type === 'get-records') {
        apiProxy.getRecords(message.page || 0, message.perPage || 100).then(function(data) {
            sendResponse({ success: true, data: data });
        }).catch(function(err) {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    // --- API: get hosts ---
    if (message.type === 'get-hosts') {
        apiProxy.getHosts().then(function(data) {
            sendResponse({ success: true, data: data });
        }).catch(function(err) {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    // --- Side panel: open ---
    if (message.type === 'open-side-panel') {
        chrome.windows.getCurrent(function(win) {
            chrome.sidePanel.open({ windowId: win.id }).then(function() {
                sendResponse({ success: true });
            }).catch(function(err) {
                sendResponse({ success: false, error: err.message });
            });
        });
        return true;
    }

    // --- Settings: update server/credentials with rollback on failure ---
    if (message.type === 'update-settings') {
        var newUrl = message.url;
        var newUsername = message.username;
        var newPassword = message.password; // null = keep existing

        // Save current credentials for rollback
        var prevUrl, prevUsername, prevPassword;
        authManager.loadCredentials().then(function(creds) {
            prevUrl = creds ? creds.url : null;
            prevUsername = creds ? creds.username : null;
            prevPassword = creds ? creds.password : null;

            var passwordToUse = newPassword || prevPassword;
            if (!passwordToUse) throw new Error('无密码可用');

            // Attempt login with new credentials
            return authManager.doLogin(newUrl, newUsername, passwordToUse, '').then(function() {
                return authManager.saveCredentials(newUrl, newUsername, passwordToUse, true);
            }).then(function() {
                chrome.storage.local.set({
                    tp_auth_state: 'authenticated',
                    tp_last_login: Date.now(),
                    tp_server_url: newUrl,
                    tp_username: newUsername
                });
                sendResponse({ success: true });
            });
        }).catch(function(err) {
            // Rollback: restore previous credentials if they existed
            if (prevUrl && prevUsername && prevPassword) {
                authManager.saveCredentials(prevUrl, prevUsername, prevPassword, true).then(function() {
                    chrome.storage.local.set({
                        tp_server_url: prevUrl,
                        tp_username: prevUsername
                    });
                });
            }
            sendResponse({ success: false, error: '认证失败，已恢复原配置' });
        });
        return true;
    }

    // --- Captcha: fetch captcha image ---
    if (message.type === 'fetch-captcha') {
        fetch(message.url, { credentials: 'include' }).then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.blob();
        }).then(function(blob) {
            var reader = new FileReader();
            reader.onloadend = function() {
                sendResponse({ success: true, dataUrl: reader.result });
            };
            reader.readAsDataURL(blob);
        }).catch(function(err) {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    // --- VL API proxy (existing, for AI analysis) ---
    if (message.type === 'vl-analyze') {
        console.log('[BG] Received vl-analyze, protocol:', message.payload.config.protocol,
            'endpoint:', message.payload.config.endpoint,
            'images:', message.payload.images.length);
        handleAnalyze(message.payload).then(function(result) {
            console.log('[BG] Success, response length:', result.text.length);
            sendResponse({ success: true, data: result });
        }).catch(function(err) {
            console.error('[BG] Error:', err.message);
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    return false;
});

// --- Debug helper ---
self.testAPI = function(endpoint, key, model) {
    console.log('[BG] Testing:', endpoint, model);
    callClaude(
        { endpoint: endpoint, apiKey: key, model: model || 'claude-sonnet-4-6' },
        [], 'say hi', '', 30000
    ).then(function(r) { console.log('[BG] OK:', r.text); })
     .catch(function(e) { console.error('[BG] FAIL:', e.message); });
};

// ============================================================
// VL API proxy functions (preserved from v1)
// ============================================================

function handleAnalyze(payload) {
    var config = payload.config;
    var images = payload.images;
    var prompt = payload.prompt;
    var systemPrompt = payload.systemPrompt || '';
    var timeoutMs = config.timeoutMs || 120000;

    if (config.protocol === 'claude') {
        return callClaude(config, images, prompt, systemPrompt, timeoutMs);
    } else {
        return callOpenAI(config, images, prompt, systemPrompt, timeoutMs);
    }
}

function callClaude(config, images, prompt, systemPrompt, timeoutMs) {
    var content = [];
    for (var i = 0; i < images.length; i++) {
        content.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: images[i].base64
            }
        });
        content.push({
            type: 'text',
            text: '[' + formatTimestamp(images[i].timestamp_sec) + '] ' + (images[i].label || '')
        });
    }
    content.push({ type: 'text', text: prompt });

    var body = {
        model: config.model || 'claude-sonnet-4-6-20250514',
        max_tokens: 8192,
        messages: [{ role: 'user', content: content }]
    };
    if (systemPrompt) {
        body.system = systemPrompt;
    }

    var endpoint = config.endpoint.replace(/\/+$/, '');
    if (endpoint.indexOf('/v1/messages') === -1) {
        endpoint += '/v1/messages';
    }

    return fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
    }, timeoutMs).then(function(resp) {
        if (!resp.ok) {
            return resp.text().then(function(text) {
                throw new Error('Claude API ' + resp.status + ': ' + text);
            });
        }
        return resp.json();
    }).then(function(data) {
        var text = '';
        for (var i = 0; i < data.content.length; i++) {
            if (data.content[i].type === 'text') text += data.content[i].text;
        }
        return {
            text: text,
            usage: data.usage
        };
    });
}

function callOpenAI(config, images, prompt, systemPrompt, timeoutMs) {
    var content = [];
    for (var i = 0; i < images.length; i++) {
        content.push({
            type: 'image_url',
            image_url: {
                url: 'data:image/jpeg;base64,' + images[i].base64,
                detail: 'high'
            }
        });
        content.push({
            type: 'text',
            text: '[' + formatTimestamp(images[i].timestamp_sec) + '] ' + (images[i].label || '')
        });
    }
    content.push({ type: 'text', text: prompt });

    var messages = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: content });

    var body = {
        model: config.model || 'gpt-4o',
        max_tokens: 8192,
        messages: messages
    };

    var endpoint = config.endpoint.replace(/\/+$/, '');
    if (endpoint.indexOf('/v1/chat/completions') === -1) {
        endpoint += '/v1/chat/completions';
    }

    return fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + config.apiKey
        },
        body: JSON.stringify(body)
    }, timeoutMs).then(function(resp) {
        if (!resp.ok) {
            return resp.text().then(function(text) {
                throw new Error('OpenAI API ' + resp.status + ': ' + text);
            });
        }
        return resp.json();
    }).then(function(data) {
        return {
            text: data.choices[0].message.content,
            usage: data.usage
        };
    });
}

function fetchWithTimeout(url, options, timeoutMs) {
    var bodySize = options.body ? (options.body.length / 1024 / 1024).toFixed(1) : '0';
    console.log('[BG] Fetching:', url, 'body:', bodySize + 'MB', 'timeout:', timeoutMs + 'ms');
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
    options.signal = controller.signal;
    return fetch(url, options).then(function(resp) {
        clearTimeout(timer);
        console.log('[BG] Response status:', resp.status);
        return resp;
    }).catch(function(err) {
        clearTimeout(timer);
        console.error('[BG] Fetch error:', err.name, err.message);
        if (err.name === 'AbortError') throw new Error('API request timeout (' + (timeoutMs / 1000) + 's)');
        throw err;
    });
}

function formatTimestamp(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
