// Teleport RDP Web Player — Extension Bridge
// In extension pages (side panel, player tab): uses Chrome APIs directly.
// In web page MAIN world (legacy injection): relays via window.postMessage.
TPP.extBridge = (function() {
    // Detect if we're in an extension page (chrome.storage available directly)
    var isExtensionPage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
        && typeof chrome.runtime !== 'undefined' && chrome.runtime.id);

    // --- Legacy postMessage relay (for MAIN world injection) ---
    var pending = {};
    var idCounter = 0;

    if (!isExtensionPage && typeof window !== 'undefined') {
        window.addEventListener('message', function(event) {
            if (event.source !== window) return;
            if (!event.data || event.data.type !== '__tp_from_ext') return;
            var cb = pending[event.data.id];
            if (!cb) return;
            delete pending[event.data.id];
            if (event.data.error) {
                cb.reject(new Error(event.data.error));
            } else {
                cb.resolve(event.data.result);
            }
        });
    }

    function send(action, payload, timeoutMs) {
        return new Promise(function(resolve, reject) {
            var id = '__tp_' + (++idCounter) + '_' + Date.now();
            pending[id] = { resolve: resolve, reject: reject };
            window.postMessage({
                type: '__tp_to_ext',
                id: id,
                action: action,
                payload: payload
            }, location.origin);
            setTimeout(function() {
                if (pending[id]) {
                    delete pending[id];
                    reject(new Error('Extension bridge timeout'));
                }
            }, timeoutMs || 10000);
        });
    }

    return {
        storageGet: function(keys) {
            if (isExtensionPage) {
                return new Promise(function(resolve) {
                    chrome.storage.local.get(keys, function(result) {
                        resolve(result);
                    });
                });
            }
            return send('storage-get', { keys: keys });
        },

        storageSet: function(data) {
            if (isExtensionPage) {
                return new Promise(function(resolve) {
                    chrome.storage.local.set(data, function() {
                        resolve();
                    });
                });
            }
            return send('storage-set', { data: data });
        },

        sendMessage: function(msg, timeoutMs) {
            if (isExtensionPage) {
                return new Promise(function(resolve, reject) {
                    var timer = setTimeout(function() {
                        reject(new Error('Message timeout'));
                    }, timeoutMs || 180000);
                    chrome.runtime.sendMessage(msg, function(response) {
                        clearTimeout(timer);
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(response);
                        }
                    });
                });
            }
            return send('send-message', { msg: msg }, timeoutMs || 180000);
        },

        fetchProxy: function(url, options, timeoutMs) {
            if (isExtensionPage) {
                var controller = new AbortController();
                var actualTimeout = timeoutMs || 120000;
                var timer = setTimeout(function() { controller.abort(); }, actualTimeout);
                return fetch(url, {
                    method: options.method || 'POST',
                    headers: options.headers || {},
                    body: options.body || null,
                    signal: controller.signal
                }).then(function(resp) {
                    clearTimeout(timer);
                    if (!resp.ok) {
                        return resp.text().then(function(text) {
                            throw new Error('HTTP ' + resp.status + ': ' + text);
                        });
                    }
                    return resp.json();
                }).then(function(data) {
                    return { ok: true, status: 200, text: JSON.stringify(data), raw: data };
                }).catch(function(err) {
                    clearTimeout(timer);
                    if (err.name === 'AbortError') throw new Error('Request timeout (' + (actualTimeout / 1000) + 's)');
                    throw err;
                });
            }
            var bridgeTimeout = (timeoutMs || 120000) + 15000;
            return send('fetch-proxy', {
                url: url,
                method: options.method || 'POST',
                headers: options.headers || {},
                body: options.body || null,
                timeoutMs: timeoutMs || 120000
            }, bridgeTimeout);
        }
    };
})();
