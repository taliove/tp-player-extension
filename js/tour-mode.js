// Teleport RDP Web Player — Guided Tour Mode
// Auto-play through AI markers sequentially.

TPP.createTourMode = function(opts) {
    var player = opts.player;
    var getMarkers = opts.getMarkers;
    var onSeek = opts.onSeek;
    var onStateChange = opts.onStateChange;

    var TOUR_TYPES = { good: 1, stuck: 1, suspicious: 1, progress: 1 };
    var DEFAULT_PLAY_SEC = 10;
    var AUTO_ADVANCE_MS = 3000;

    var active = false;
    var tourMarkers = [];
    var currentIdx = 0;
    var playTimer = null;
    var advanceTimer = null;

    function buildTourList() {
        var raw = getMarkers ? getMarkers() : [];
        var filtered = [];
        for (var i = 0; i < raw.length; i++) {
            if (TOUR_TYPES[raw[i].type]) {
                filtered.push(raw[i]);
            }
        }
        filtered.sort(function(a, b) { return a.time_sec - b.time_sec; });
        return filtered;
    }

    function clearTimers() {
        if (playTimer) { clearTimeout(playTimer); playTimer = null; }
        if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    }

    function notifyState() {
        if (onStateChange) {
            onStateChange(active, currentIdx, tourMarkers.length);
        }
    }

    function goToMarker(idx) {
        if (idx < 0 || idx >= tourMarkers.length) {
            stop();
            return;
        }
        currentIdx = idx;
        clearTimers();
        notifyState();

        var m = tourMarkers[idx];
        onSeek(m.time_sec * 1000);

        var playSec = (m.duration_sec && m.duration_sec > 0) ? m.duration_sec : DEFAULT_PLAY_SEC;
        var playMs = playSec * 1000;

        player.play();

        playTimer = setTimeout(function() {
            playTimer = null;
            player.pause();
            advanceTimer = setTimeout(function() {
                advanceTimer = null;
                next();
            }, AUTO_ADVANCE_MS);
        }, playMs);
    }

    function start() {
        tourMarkers = buildTourList();
        if (tourMarkers.length === 0) return false;
        active = true;
        currentIdx = 0;
        goToMarker(0);
        return true;
    }

    function stop() {
        clearTimers();
        active = false;
        tourMarkers = [];
        currentIdx = 0;
        try { player.pause(); } catch(e) {}
        notifyState();
    }

    function next() {
        if (!active) return;
        if (currentIdx + 1 >= tourMarkers.length) {
            stop();
            return;
        }
        goToMarker(currentIdx + 1);
    }

    function isActive() {
        return active;
    }

    function destroy() {
        stop();
    }

    return {
        start: start,
        stop: stop,
        next: next,
        isActive: isActive,
        destroy: destroy
    };
};
