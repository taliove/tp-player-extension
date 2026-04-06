// Teleport RDP Web Player — Notes Module
// Stores per-recording notes in chrome.storage.local (shared across all extension contexts).
// Uses in-memory cache for synchronous reads, async writeback for persistence.

TPP.createNotes = function (rid) {
    var NOTES_KEY = 'tp_player_notes';
    var cache = {};
    var readyCallbacks = [];
    var isReady = false;

    // Async load from chrome.storage.local
    TPP.extBridge.storageGet(NOTES_KEY).then(function (data) {
        cache = data[NOTES_KEY] || {};
        // One-time migration from localStorage
        try {
            var old = JSON.parse(localStorage.getItem(NOTES_KEY));
            if (old && Object.keys(old).length > 0 && Object.keys(cache).length === 0) {
                cache = old;
                flush();
                localStorage.removeItem(NOTES_KEY);
                console.log('[Notes] Migrated', Object.keys(cache).length, 'entries from localStorage');
            }
        } catch (e) { /* localStorage not available or corrupt */ }
        isReady = true;
        for (var i = 0; i < readyCallbacks.length; i++) readyCallbacks[i]();
        readyCallbacks = [];
    });

    // Sync changes from other contexts (e.g., sidebar tags a recording)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'local' && changes[NOTES_KEY]) {
                cache = changes[NOTES_KEY].newValue || {};
            }
        });
    }

    function flush() {
        var data = {};
        data[NOTES_KEY] = cache;
        TPP.extBridge.storageSet(data);
    }

    function get() {
        return cache[rid] || { tag: null, text: '' };
    }

    function save(note) {
        cache[rid] = note;
        flush();
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
        onReady: function (cb) {
            if (isReady) cb();
            else readyCallbacks.push(cb);
        }
    };
};
