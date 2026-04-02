// Teleport RDP Web Player — Extension Bridge (Main World)
// Relays requests to content script (isolated world) via window.postMessage
TPP.extBridge = (function() {
    var pending = {};
    var idCounter = 0;

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
            return send('storage-get', { keys: keys });
        },
        storageSet: function(data) {
            return send('storage-set', { data: data });
        },
        sendMessage: function(msg, timeoutMs) {
            return send('send-message', { msg: msg }, timeoutMs || 180000);
        },
        fetchProxy: function(url, options, timeoutMs) {
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
