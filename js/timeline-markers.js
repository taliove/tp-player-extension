// Teleport RDP Web Player — Timeline Markers
// Smart timeline: heatmap overlay, AI marker placement, mini-card popups, hover thumbnails.

TPP.createTimelineMarkers = function(opts) {
    var allPackets = opts.allPackets;
    var totalMs = opts.totalMs;
    var progressContainer = opts.progressContainer || document.getElementById('progress-container');
    var progressBar = opts.progressBar;
    var markerTrack = opts.markerTrack;
    var heatmapBar = opts.heatmapBar || document.getElementById('heatmap-bar');
    var onSeek = opts.onSeek;

    var canvas = null;
    var resizeTimer = null;
    var activeCard = null;
    var docClickHandler = null;
    var thumbnails = []; // [{time_sec, dataUrl}]

    var KNOWN_TYPES = { progress: 1, good: 1, stuck: 1, suspicious: 1, info: 1, dismissed: 1 };
    var TYPE_SHAPES = { progress: '\u25CF', good: '\u2605', stuck: '\u25B2', suspicious: '\u25C6', info: '\u2500', dismissed: '\u25C7' };

    // --- Helpers ---

    function formatTs(sec) {
        var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function debounce(fn, ms) {
        return function() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(fn, ms);
        };
    }

    // --- Heatmap (drawn in #heatmap-bar, not inside progress-bar) ---

    function ensureCanvas() {
        if (canvas) return canvas;
        if (!heatmapBar) return null;
        canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:100%;height:100%;border-radius:inherit;display:block;';
        heatmapBar.appendChild(canvas);
        return canvas;
    }

    function buildBuckets() {
        var totalSec = totalMs / 1000;
        if (totalSec < 60) return []; // Skip for short recordings
        // Dynamic bucket size: max 200 buckets
        var bucketSec = Math.max(5, totalSec / 200);
        var bucketMs = bucketSec * 1000;
        var count = Math.ceil(totalMs / bucketMs);
        var buckets = new Array(count);
        var i;
        for (i = 0; i < count; i++) buckets[i] = 0;
        for (i = 0; i < allPackets.length; i++) {
            if (allPackets[i].type === TPP.TYPE_RDP_IMAGE) {
                var idx = Math.floor(allPackets[i].timeMs / bucketMs);
                if (idx >= 0 && idx < count) buckets[idx]++;
            }
        }
        return buckets;
    }

    function renderHeatmap() {
        var cvs = ensureCanvas();
        if (!cvs || !heatmapBar) return;
        var rect = heatmapBar.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        var w = Math.round(rect.width * dpr);
        var h = Math.round(rect.height * dpr);
        cvs.width = w;
        cvs.height = h;

        var buckets = buildBuckets();
        if (buckets.length === 0) return;

        // Percentile-based normalization
        var sorted = buckets.slice().filter(function(v) { return v > 0; }).sort(function(a, b) { return a - b; });
        if (sorted.length === 0) return;

        var ctx = cvs.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        var barW = w / buckets.length;

        for (var i = 0; i < buckets.length; i++) {
            if (buckets[i] <= 0) continue;
            // Percentile rank: position in sorted non-zero values
            var rank = 0;
            for (var j = 0; j < sorted.length; j++) {
                if (sorted[j] <= buckets[i]) rank = j;
            }
            var norm = sorted.length > 1 ? rank / (sorted.length - 1) : 1;
            // Subtle warm gradient: dark amber → muted orange
            var r = Math.round(200 + norm * 55);
            var g = Math.round(140 - norm * 70);
            var b = Math.round(40 - norm * 20);
            ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (0.12 + norm * 0.28) + ')';
            ctx.fillRect(Math.floor(i * barW), 0, Math.ceil(barW), h);
        }
    }

    function updateHeatmap() {
        renderHeatmap();
    }

    var onResize = debounce(function() { if (canvas) renderHeatmap(); }, 200);
    window.addEventListener('resize', onResize);

    // --- Hover Preview Thumbnails ---

    function setThumbnails(thumbs) {
        thumbnails = thumbs || [];
    }

    function initHoverPreview() {
        var preview = document.getElementById('hover-preview');
        var previewImg = document.getElementById('hover-preview-img');
        var previewTime = document.getElementById('hover-preview-time');
        if (!preview || !progressContainer) return;

        var totalSec = totalMs / 1000;
        var previewW = 168; // Fixed width, matches CSS
        var lastBest = -1;

        function onMove(e) {
            if (thumbnails.length === 0) { preview.style.display = 'none'; return; }
            var rect = progressContainer.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var pct = Math.max(0, Math.min(1, x / rect.width));
            var timeSec = pct * totalSec;

            // Binary search nearest thumbnail
            var lo = 0, hi = thumbnails.length - 1, best = 0;
            while (lo <= hi) {
                var mid = (lo + hi) >> 1;
                if (thumbnails[mid].time_sec <= timeSec) { best = mid; lo = mid + 1; }
                else hi = mid - 1;
            }

            // Only update img src when the nearest thumbnail changes (avoids redundant reflows)
            if (best !== lastBest) {
                previewImg.src = thumbnails[best].dataUrl;
                lastBest = best;
            }
            previewTime.textContent = formatTs(timeSec);
            preview.style.display = '';

            // Position with transform (GPU-accelerated, no reflow)
            var leftPx = x - previewW / 2;
            if (leftPx < 0) leftPx = 0;
            if (leftPx + previewW > rect.width) leftPx = rect.width - previewW;
            preview.style.transform = 'translateX(' + leftPx + 'px)';
        }

        progressContainer.addEventListener('mousemove', onMove);
        progressContainer.addEventListener('mouseleave', function() {
            preview.style.display = 'none';
            lastBest = -1;
        });
    }

    initHoverPreview();

    // --- Mini-Card ---

    function dismissCard() {
        if (docClickHandler) {
            document.removeEventListener('click', docClickHandler);
            docClickHandler = null;
        }
        if (activeCard && activeCard.parentNode) {
            activeCard.parentNode.removeChild(activeCard);
        }
        activeCard = null;
    }

    function showMiniCard(marker, markerEl) {
        dismissCard();
        var type = KNOWN_TYPES[marker.type] ? marker.type : 'info';
        var timeSec = marker.time_sec;

        var card = document.createElement('div');
        card.className = 'ai-mini-card';

        var header = document.createElement('div');
        header.className = 'ai-mini-card-header';

        var typeDot = document.createElement('span');
        typeDot.className = 'ai-mini-card-type ai-marker-' + type;
        typeDot.textContent = TYPE_SHAPES[type] || '\u25CF';
        header.appendChild(typeDot);

        var timeSpan = document.createElement('span');
        timeSpan.className = 'ai-mini-card-time';
        timeSpan.textContent = formatTs(timeSec);
        header.appendChild(timeSpan);

        var labelSpan = document.createElement('span');
        labelSpan.className = 'ai-mini-card-label';
        labelSpan.textContent = marker.label || '';
        if (type === 'dismissed') labelSpan.style.textDecoration = 'line-through';
        header.appendChild(labelSpan);

        card.appendChild(header);

        var btn = document.createElement('button');
        btn.className = 'ai-mini-card-play';
        btn.textContent = '\u4ece\u6b64\u5904\u64ad\u653e';
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            onSeek(timeSec * 1000);
            dismissCard();
        });
        card.appendChild(btn);

        markerTrack.appendChild(card);
        activeCard = card;

        // Position above marker
        var trackRect = markerTrack.getBoundingClientRect();
        var markerRect = markerEl.getBoundingClientRect();
        var cardW = card.offsetWidth;
        var leftPx = (markerRect.left - trackRect.left) + markerRect.width / 2 - cardW / 2;
        if (leftPx < 0) leftPx = 0;
        if (leftPx + cardW > trackRect.width) leftPx = trackRect.width - cardW;
        card.style.position = 'absolute';
        card.style.bottom = markerTrack.offsetHeight + 'px';
        card.style.left = leftPx + 'px';

        setTimeout(function() {
            docClickHandler = function(e) {
                if (!card.contains(e.target)) dismissCard();
            };
            document.addEventListener('click', docClickHandler);
        }, 0);
    }

    // --- Markers ---

    function clearMarkers() {
        dismissCard();
        while (markerTrack.firstChild) {
            markerTrack.removeChild(markerTrack.firstChild);
        }
    }

    function setMarkers(markers) {
        clearMarkers();
        var totalSec = totalMs / 1000;
        if (totalSec <= 0) return;
        for (var i = 0; i < markers.length; i++) {
            var m = markers[i];
            var sec = Math.max(0, Math.min(m.time_sec, totalSec));
            var type = KNOWN_TYPES[m.type] ? m.type : 'info';

            var el = document.createElement('div');
            el.className = 'ai-marker ai-marker-' + type;
            el.style.left = (sec / totalSec) * 100 + '%';
            el.title = (TYPE_SHAPES[type] || '') + ' ' + (m.label || '');
            el.textContent = TYPE_SHAPES[type] || '\u25CF';
            el.setAttribute('tabindex', '0');
            el.setAttribute('role', 'button');

            // Duration span
            if (m.duration_sec && m.duration_sec > 0) {
                var durEl = document.createElement('div');
                durEl.className = 'ai-marker-duration';
                durEl.style.width = (m.duration_sec / totalSec) * 100 + '%';
                el.appendChild(durEl);
            }

            (function(marker, markerEl) {
                markerEl.addEventListener('click', function(e) {
                    e.stopPropagation();
                    showMiniCard(marker, markerEl);
                });
                markerEl.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSeek(marker.time_sec * 1000);
                    }
                });
            })(m, el);

            markerTrack.appendChild(el);
        }
    }

    // --- Destroy ---

    function destroy() {
        window.removeEventListener('resize', onResize);
        clearTimeout(resizeTimer);
        dismissCard();
        if (canvas && canvas.parentNode) {
            canvas.parentNode.removeChild(canvas);
            canvas = null;
        }
        clearMarkers();
        thumbnails = [];
    }

    return {
        updateHeatmap: updateHeatmap,
        setMarkers: setMarkers,
        clearMarkers: clearMarkers,
        setThumbnails: setThumbnails,
        destroy: destroy
    };
};
