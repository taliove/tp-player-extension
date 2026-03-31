// Teleport RDP Web Player — Cache Manager
// Uses IndexedDB for binary recording files, localStorage for metadata.
// LRU eviction when total size exceeds limit.
// Gracefully degrades when IndexedDB or localStorage is not available.

TPP.createCacheManager = function (rid) {
    var DB_NAME = 'tp-player-cache';
    var DB_VERSION = 1;
    var STORE_NAME = 'files';
    var META_KEY = 'tp_cache_meta';
    var MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB default

    var db = null;

    function openDB() {
        if (db) return Promise.resolve(db);
        return new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = function (e) {
                    var d = e.target.result;
                    if (!d.objectStoreNames.contains(STORE_NAME)) {
                        d.createObjectStore(STORE_NAME);
                    }
                };
                req.onsuccess = function () { db = req.result; resolve(db); };
                req.onerror = function () { reject(req.error); };
            } catch (e) { reject(e); }
        });
    }

    function readMeta() {
        try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
        catch (e) { return {}; }
    }

    function writeMeta(meta) {
        try { localStorage.setItem(META_KEY, JSON.stringify(meta)); }
        catch (e) { /* quota */ }
    }

    function storeKey(filename) {
        return rid + '/' + filename;
    }

    function getFromCache(filename) {
        return openDB().then(function (d) {
            return new Promise(function (resolve, reject) {
                var tx = d.transaction(STORE_NAME, 'readonly');
                var req = tx.objectStore(STORE_NAME).get(storeKey(filename));
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        }).then(function (buf) {
            if (!buf) return null;
            var meta = readMeta();
            if (meta[rid]) {
                meta[rid].lastAccess = Date.now();
                writeMeta(meta);
            }
            return buf;
        }).catch(function () { return null; });
    }

    function putInCache(filename, arrayBuffer) {
        return openDB().then(function (d) {
            return new Promise(function (resolve, reject) {
                var tx = d.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).put(arrayBuffer, storeKey(filename));
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        }).then(function () {
            var meta = readMeta();
            if (!meta[rid]) {
                meta[rid] = { totalSize: 0, lastAccess: Date.now(), files: {} };
            }
            meta[rid].files[filename] = arrayBuffer.byteLength;
            meta[rid].totalSize = 0;
            var files = meta[rid].files;
            for (var f in files) {
                if (files.hasOwnProperty(f)) meta[rid].totalSize += files[f];
            }
            meta[rid].lastAccess = Date.now();
            writeMeta(meta);
            return evictIfNeeded();
        }).catch(function () { /* cache write failed, ignore */ });
    }

    function evictIfNeeded() {
        var meta = readMeta();
        var totalSize = 0;
        var entries = [];
        for (var r in meta) {
            if (meta.hasOwnProperty(r)) {
                totalSize += meta[r].totalSize || 0;
                entries.push({ rid: r, lastAccess: meta[r].lastAccess || 0, size: meta[r].totalSize || 0 });
            }
        }
        if (totalSize <= MAX_BYTES) return Promise.resolve();

        entries.sort(function (a, b) { return a.lastAccess - b.lastAccess; });

        var toDelete = [];
        while (totalSize > MAX_BYTES && entries.length > 0) {
            var oldest = entries.shift();
            if (oldest.rid === String(rid)) continue;
            toDelete.push(oldest.rid);
            totalSize -= oldest.size;
        }

        if (toDelete.length === 0) return Promise.resolve();

        return openDB().then(function (d) {
            var tx = d.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            for (var i = 0; i < toDelete.length; i++) {
                var delRid = toDelete[i];
                var files = meta[delRid] ? meta[delRid].files : {};
                for (var f in files) {
                    if (files.hasOwnProperty(f)) {
                        store.delete(delRid + '/' + f);
                    }
                }
                delete meta[delRid];
            }
            writeMeta(meta);
            return new Promise(function (resolve) {
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { resolve(); };
            });
        }).catch(function () {
            for (var i = 0; i < toDelete.length; i++) delete meta[toDelete[i]];
            writeMeta(meta);
        });
    }

    function isCached(filename) {
        return openDB().then(function (d) {
            return new Promise(function (resolve) {
                var tx = d.transaction(STORE_NAME, 'readonly');
                var req = tx.objectStore(STORE_NAME).get(storeKey(filename));
                req.onsuccess = function () { resolve(!!req.result); };
                req.onerror = function () { resolve(false); };
            });
        }).catch(function () { return false; });
    }

    function isAnyCached() {
        var meta = readMeta();
        return !!meta[rid];
    }

    function getCacheSize() {
        var meta = readMeta();
        return meta[rid] ? meta[rid].totalSize || 0 : 0;
    }

    function clearCurrent() {
        var meta = readMeta();
        var files = meta[rid] ? meta[rid].files : {};
        delete meta[rid];
        writeMeta(meta);
        return openDB().then(function (d) {
            var tx = d.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            for (var f in files) {
                if (files.hasOwnProperty(f)) {
                    store.delete(storeKey(f));
                }
            }
            return new Promise(function (resolve) {
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { resolve(); };
            });
        }).catch(function () {});
    }

    function clearAll() {
        writeMeta({});
        return openDB().then(function (d) {
            var tx = d.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).clear();
            return new Promise(function (resolve) {
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { resolve(); };
            });
        }).catch(function () {});
    }

    function isRidCached(checkRid) {
        var meta = readMeta();
        return !!meta[checkRid];
    }

    return {
        getFromCache: getFromCache,
        putInCache: putInCache,
        isCached: isCached,
        isAnyCached: isAnyCached,
        getCacheSize: getCacheSize,
        clearCurrent: clearCurrent,
        clearAll: clearAll,
        isRidCached: isRidCached,
    };
};

// Static method for list page to check cache without creating full manager
TPP.isCached = function (checkRid) {
    try {
        var meta = JSON.parse(localStorage.getItem('tp_cache_meta')) || {};
        return !!meta[checkRid];
    } catch (e) { return false; }
};
