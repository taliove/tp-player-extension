// Teleport RDP Web Player — AI Analyzer (Frame Sampling + VL Analysis)
TPP.createAIAnalyzer = function(opts) {
    var header = opts.header;
    var keyframes = opts.keyframes;
    var allPackets = opts.allPackets;
    var player = opts.player;
    var aiSettings = opts.settings;
    var templates = opts.templates;
    var reportCache = opts.reportCache;
    var rid = opts.rid;
    var onProgress = opts.onProgress || function() {};
    var cancelled = false;

    // --- Activity density scanning ---
    function computeActivityDensity(packets, totalMs) {
        var windowMs = TPP.AI_WINDOW_MS;
        var windowCount = Math.ceil(totalMs / windowMs);
        var density = new Array(windowCount);
        for (var w = 0; w < windowCount; w++) density[w] = 0;

        for (var i = 0; i < packets.length; i++) {
            if (packets[i].type === TPP.TYPE_RDP_IMAGE) {
                var wi = Math.floor(packets[i].timeMs / windowMs);
                if (wi < windowCount) density[wi] += packets[i].size;
            }
        }

        var maxDensity = 0;
        for (var j = 0; j < density.length; j++) {
            if (density[j] > maxDensity) maxDensity = density[j];
        }
        if (maxDensity > 0) {
            for (var k = 0; k < density.length; k++) {
                density[k] = density[k] / maxDensity;
            }
        }
        return density;
    }

    // --- Edge detection ---
    function detectEdges(density) {
        var threshold = TPP.AI_DENSITY_THRESHOLD;
        var windowMs = TPP.AI_WINDOW_MS;
        var edges = [];

        for (var i = 1; i < density.length; i++) {
            var prev = density[i - 1];
            var curr = density[i];
            if (prev < threshold && curr >= threshold) {
                edges.push({ type: 'rising', windowIndex: i, timeMs: i * windowMs });
            } else if (prev >= threshold && curr < threshold) {
                edges.push({ type: 'falling', windowIndex: i, timeMs: i * windowMs });
            }
        }
        return edges;
    }

    // --- Layer 1 + Layer 3 sample points ---
    function computeSamplePoints(density, edges, totalMs, maxFrames) {
        var points = [];
        var usedSec = {};

        function addPoint(timeMs, label) {
            var sec = Math.round(timeMs / 1000);
            if (sec < 0) sec = 0;
            if (sec > Math.floor(totalMs / 1000)) sec = Math.floor(totalMs / 1000);
            if (usedSec[sec]) return;
            usedSec[sec] = true;
            points.push({ timestampSec: sec, label: label });
        }

        // First frame
        addPoint(0, '录像开始');

        // Layer 1: edge-based sampling
        for (var i = 0; i < edges.length; i++) {
            var e = edges[i];
            if (e.type === 'rising') {
                addPoint(e.timeMs, '活动开始');
            } else {
                addPoint(e.timeMs + TPP.AI_EDGE_SETTLE_MS, '活动结束');
            }
        }

        // Layer 1: fallback sampling (every 2.5 min if no edges nearby)
        var fallbackInterval = TPP.AI_FALLBACK_INTERVAL_MS;
        for (var t = fallbackInterval; t < totalMs; t += fallbackInterval) {
            var sec = Math.round(t / 1000);
            if (!usedSec[sec]) {
                addPoint(t, '定期采样');
            }
        }

        // Layer 3: end segment dense sampling
        var endDurationMs = Math.max(
            TPP.AI_END_SEGMENT_MIN_MS,
            totalMs * TPP.AI_END_SEGMENT_RATIO
        );
        var endStartMs = Math.max(0, totalMs - endDurationMs);
        var endInterval = TPP.AI_END_SAMPLE_INTERVAL_MS;
        for (var et = endStartMs; et < totalMs; et += endInterval) {
            addPoint(et, '末段采帧');
        }
        addPoint(totalMs - 1000, '录像结束');

        // Budget control
        if (points.length > maxFrames) {
            points.sort(function(a, b) { return a.timestampSec - b.timestampSec; });
            var step = points.length / maxFrames;
            var sampled = [];
            for (var s = 0; s < maxFrames; s++) {
                sampled.push(points[Math.floor(s * step)]);
            }
            points = sampled;
        }

        points.sort(function(a, b) { return a.timestampSec - b.timestampSec; });
        return points;
    }

    // --- Layer 2: VL-directed supplementary sampling ---
    function computeLayer2Points(needMoreFrames, totalMs, maxFrames) {
        var points = [];
        var usedSec = {};

        function addPoint(timeMs, label) {
            var sec = Math.round(timeMs / 1000);
            if (sec < 0) sec = 0;
            if (sec > Math.floor(totalMs / 1000)) sec = Math.floor(totalMs / 1000);
            if (usedSec[sec]) return;
            usedSec[sec] = true;
            points.push({ timestampSec: sec, label: label });
        }

        for (var i = 0; i < needMoreFrames.length; i++) {
            var range = needMoreFrames[i];
            var startSec = range.time_range[0] - (TPP.AI_L2_EXPAND_MS / 1000);
            var endSec = range.time_range[1] + (TPP.AI_L2_EXPAND_MS / 1000);
            var intervalMs = TPP.AI_L2_SAMPLE_INTERVAL_MS;

            for (var t = startSec * 1000; t <= endSec * 1000; t += intervalMs) {
                addPoint(t, '补帧: ' + range.reason);
            }
        }

        if (points.length > maxFrames) {
            var step = points.length / maxFrames;
            var sampled = [];
            for (var s = 0; s < maxFrames; s++) {
                sampled.push(points[Math.floor(s * step)]);
            }
            points = sampled;
        }

        points.sort(function(a, b) { return a.timestampSec - b.timestampSec; });
        return points;
    }

    return {
        computeActivityDensity: computeActivityDensity,
        detectEdges: detectEdges,
        computeSamplePoints: computeSamplePoints,
        computeLayer2Points: computeLayer2Points,
        cancel: function() { cancelled = true; }
    };
};
