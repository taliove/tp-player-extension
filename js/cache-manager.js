// Teleport RDP Web Player — Cache Manager
// Uses Cache API for binary recording files, localStorage for metadata.
// LRU eviction when total size exceeds limit.

TPP.createCacheManager = function (rid) {
    var CACHE_NAME = 'tp-player-cache';
    var META_KEY = 'tp_cache_meta';
    var MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB default

    function readMeta() {
        try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
        catch (e) { return {}; }
    }

    function writeMeta(meta) {
        try { localStorage.setItem(META_KEY, JSON.stringify(meta)); }
        catch (e) { /* quota */ }
    }

    function cacheKey(filename) {
        return '/tp-cache/' + rid + '/' + filename;
    }

    function getFromCache(filename) {
        return caches.open(CACHE_NAME).then(function (cache) {
            return cache.match(cacheKey(filename));
        }).then(function (resp) {
            if (!resp) return null;
            // Update last access time
            var meta = readMeta();
            if (meta[rid]) {
                meta[rid].lastAccess = Date.now();
                writeMeta(meta);
            }
            return resp.arrayBuffer();
        });
    }

    function putInCache(filename, arrayBuffer) {
        var key = cacheKey(filename);
        var resp = new Response(arrayBuffer, {
            headers: { 'Content-Type': 'application/octet-stream' }
        });
        return caches.open(CACHE_NAME).then(function (cache) {
            return cache.put(key, resp);
        }).then(function () {
            // Update metadata
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
        });
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

        // Sort by lastAccess ascending (oldest first)
        entries.sort(function (a, b) { return a.lastAccess - b.lastAccess; });

        var toDelete = [];
        while (totalSize > MAX_BYTES && entries.length > 0) {
            var oldest = entries.shift();
            if (oldest.rid === String(rid)) continue; // Don't evict current recording
            toDelete.push(oldest.rid);
            totalSize -= oldest.size;
        }

        return caches.open(CACHE_NAME).then(function (cache) {
            var promises = [];
            for (var i = 0; i < toDelete.length; i++) {
                var delRid = toDelete[i];
                var files = meta[delRid] ? meta[delRid].files : {};
                for (var f in files) {
                    if (files.hasOwnProperty(f)) {
                        promises.push(cache.delete('/tp-cache/' + delRid + '/' + f));
                    }
                }
                delete meta[delRid];
            }
            writeMeta(meta);
            return Promise.all(promises);
        });
    }

    function isCached(filename) {
        return caches.open(CACHE_NAME).then(function (cache) {
            return cache.match(cacheKey(filename));
        }).then(function (resp) {
            return !!resp;
        });
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
        return caches.open(CACHE_NAME).then(function (cache) {
            var promises = [];
            for (var f in files) {
                if (files.hasOwnProperty(f)) {
                    promises.push(cache.delete(cacheKey(f)));
                }
            }
            delete meta[rid];
            writeMeta(meta);
            return Promise.all(promises);
        });
    }

    function clearAll() {
        writeMeta({});
        return caches.delete(CACHE_NAME);
    }

    // Static: check if a given rid is cached (for list page)
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
