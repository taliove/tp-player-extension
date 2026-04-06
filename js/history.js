// Teleport RDP Web Player — Play History Module
// Stores last 20 played recordings in chrome.storage.local (shared across all extension contexts).
// Uses in-memory cache for synchronous reads, async writeback for persistence.

TPP.createHistory = function () {
    var HISTORY_KEY = 'tp_play_history';
    var MAX_ENTRIES = 20;
    var cache = [];
    var readyCallbacks = [];
    var isReady = false;

    // Async load from chrome.storage.local
    TPP.extBridge.storageGet(HISTORY_KEY).then(function (data) {
        cache = data[HISTORY_KEY] || [];
        // One-time migration from localStorage
        try {
            var old = JSON.parse(localStorage.getItem(HISTORY_KEY));
            if (Array.isArray(old) && old.length > 0 && cache.length === 0) {
                cache = old;
                flush();
                localStorage.removeItem(HISTORY_KEY);
                console.log('[History] Migrated', cache.length, 'entries from localStorage');
            }
        } catch (e) { /* localStorage not available or corrupt */ }
        isReady = true;
        for (var i = 0; i < readyCallbacks.length; i++) readyCallbacks[i]();
        readyCallbacks = [];
    });

    // Sync changes from other contexts
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'local' && changes[HISTORY_KEY]) {
                cache = changes[HISTORY_KEY].newValue || [];
            }
        });
    }

    function flush() {
        var data = {};
        data[HISTORY_KEY] = cache;
        TPP.extBridge.storageSet(data);
    }

    function add(entry) {
        // entry: { rid, user, duration, date, timestamp }
        cache = cache.filter(function (item) { return String(item.rid) !== String(entry.rid); });
        cache.unshift(entry);
        if (cache.length > MAX_ENTRIES) cache = cache.slice(0, MAX_ENTRIES);
        flush();
    }

    function getAll() {
        return cache;
    }

    function clear() {
        cache = [];
        flush();
    }

    return {
        add: add,
        getAll: getAll,
        clear: clear,
        onReady: function (cb) {
            if (isReady) cb();
            else readyCallbacks.push(cb);
        }
    };
};
