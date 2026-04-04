// Teleport RDP Web Player — Timeline Markers
// Heatmap overlay, AI marker placement, and mini-card popups.

TPP.createTimelineMarkers = function(opts) {
    var allPackets = opts.allPackets;
    var totalMs = opts.totalMs;
    var progressBar = opts.progressBar;
    var markerTrack = opts.markerTrack;
    var onSeek = opts.onSeek;

    var BUCKET_MS = 5000;
    var canvas = null;
    var resizeTimer = null;
    var activeCard = null;
    var docClickHandler = null;

    var KNOWN_TYPES = { progress: 1, good: 1, stuck: 1, suspicious: 1, info: 1 };

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

    // --- Heatmap ---

    function ensureCanvas() {
        if (canvas) return canvas;
        canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border-radius:inherit;pointer-events:none;';
        progressBar.insertBefore(canvas, progressBar.firstChild);
        return canvas;
    }

    function buildBuckets() {
        var count = Math.ceil(totalMs / BUCKET_MS);
        var buckets = new Array(count);
        var i;
        for (i = 0; i < count; i++) buckets[i] = 0;
        for (i = 0; i < allPackets.length; i++) {
            if (allPackets[i].type === TPP.TYPE_RDP_IMAGE) {
                var idx = Math.floor(allPackets[i].timeMs / BUCKET_MS);
                if (idx >= 0 && idx < count) buckets[idx]++;
            }
        }
        return buckets;
    }

    function renderHeatmap() {
        var cvs = ensureCanvas();
        var rect = progressBar.getBoundingClientRect();
        var w = Math.round(rect.width * (window.devicePixelRatio || 1));
        var h = Math.round(rect.height * (window.devicePixelRatio || 1));
        cvs.width = w;
        cvs.height = h;

        var buckets = buildBuckets();
        var max = 0;
        var i;
        for (i = 0; i < buckets.length; i++) {
            if (buckets[i] > max) max = buckets[i];
        }
        if (max === 0) return;

        var ctx = cvs.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        var barW = w / buckets.length;

        for (i = 0; i < buckets.length; i++) {
            var norm = buckets[i] / max;
            if (norm <= 0) continue;
            // warm amber rgba(255,170,50) -> red-orange rgba(255,80,30) at peak
            var g = Math.round(170 - norm * 90);
            var b = Math.round(50 - norm * 20);
            ctx.fillStyle = 'rgba(255,' + g + ',' + b + ',' + (norm * 0.6) + ')';
            ctx.fillRect(Math.floor(i * barW), 0, Math.ceil(barW), h);
        }
    }

    function updateHeatmap() {
        renderHeatmap();
    }

    var onResize = debounce(function() { if (canvas) renderHeatmap(); }, 200);
    window.addEventListener('resize', onResize);

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
        header.appendChild(typeDot);

        var timeSpan = document.createElement('span');
        timeSpan.className = 'ai-mini-card-time';
        timeSpan.textContent = formatTs(timeSec);
        header.appendChild(timeSpan);

        var labelSpan = document.createElement('span');
        labelSpan.className = 'ai-mini-card-label';
        labelSpan.textContent = marker.label || '';
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

        // Position above marker, horizontally centered
        var trackRect = markerTrack.getBoundingClientRect();
        var markerRect = markerEl.getBoundingClientRect();
        var cardW = card.offsetWidth;
        var leftPx = (markerRect.left - trackRect.left) + markerRect.width / 2 - cardW / 2;

        // Edge-clamp
        if (leftPx < 0) leftPx = 0;
        if (leftPx + cardW > trackRect.width) leftPx = trackRect.width - cardW;

        card.style.position = 'absolute';
        card.style.bottom = markerTrack.offsetHeight + 'px';
        card.style.left = leftPx + 'px';

        // Dismiss on outside click (deferred to avoid same-click dismiss)
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
            el.title = m.label || '';

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
    }

    return {
        updateHeatmap: updateHeatmap,
        setMarkers: setMarkers,
        clearMarkers: clearMarkers,
        destroy: destroy
    };
};
