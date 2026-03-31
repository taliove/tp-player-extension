// Teleport RDP Web Player — Play History Module
// Stores last 20 played recordings in localStorage.

TPP.createHistory = function () {
    var HISTORY_KEY = 'tp_play_history';
    var MAX_ENTRIES = 20;

    function readAll() {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
        catch (e) { return []; }
    }

    function writeAll(data) {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(data)); }
        catch (e) { /* quota */ }
    }

    function add(entry) {
        // entry: { rid, user, duration, date, timestamp }
        var list = readAll();
        // Remove existing entry for same rid
        list = list.filter(function (item) { return String(item.rid) !== String(entry.rid); });
        // Add to front
        list.unshift(entry);
        // Trim to max
        if (list.length > MAX_ENTRIES) list = list.slice(0, MAX_ENTRIES);
        writeAll(list);
    }

    function getAll() {
        return readAll();
    }

    function clear() {
        writeAll([]);
    }

    return {
        add: add,
        getAll: getAll,
        clear: clear,
    };
};
