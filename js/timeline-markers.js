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
    var currentMarkers = [];
    var CLUSTER_THRESHOLD_PCT = 2;
    var hoverMoveHandler = null;
    var hoverLeaveHandler = null;

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

    // --- Clustering ---

    function computeClusters(markers, totalSec) {
        if (!markers || markers.length === 0 || totalSec <= 0) return [];
        var items = [];
        for (var i = 0; i < markers.length; i++) {
            items.push({ marker: markers[i], pct: (markers[i].time_sec / totalSec) * 100 });
        }
        items.sort(function(a, b) { return a.pct - b.pct; });

        var groups = [];
        var group = { markers: [items[0].marker], pctMin: items[0].pct, pctMax: items[0].pct, pctSum: items[0].pct };
        for (var j = 1; j < items.length; j++) {
            if (items[j].pct - group.pctMax <= CLUSTER_THRESHOLD_PCT) {
                group.markers.push(items[j].marker);
                group.pctMax = items[j].pct;
                group.pctSum += items[j].pct;
            } else {
                group.avgPct = group.pctSum / group.markers.length;
                groups.push(group);
                group = { markers: [items[j].marker], pctMin: items[j].pct, pctMax: items[j].pct, pctSum: items[j].pct };
            }
        }
        group.avgPct = group.pctSum / group.markers.length;
        groups.push(group);
        return groups;
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

        hoverMoveHandler = function(e) {
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
            updateHoverMarkerInfo(timeSec);

            // Position with transform (GPU-accelerated, no reflow)
            var leftPx = x - previewW / 2;
            if (leftPx < 0) leftPx = 0;
            if (leftPx + previewW > rect.width) leftPx = rect.width - previewW;
            preview.style.transform = 'translateX(' + leftPx + 'px)';
        };

        hoverLeaveHandler = function() {
            preview.style.display = 'none';
            lastBest = -1;
        };

        progressContainer.addEventListener('mousemove', hoverMoveHandler);
        progressContainer.addEventListener('mouseleave', hoverLeaveHandler);
    }

    initHoverPreview();

    // --- Hover Preview: Marker Fusion ---
    // When hovering near a marker, the hover preview integrates marker info
    // instead of showing a separate tooltip.

    var MARKER_SNAP_SEC = 5; // snap to marker if within 5 seconds

    function findNearestMarker(timeSec) {
        if (currentMarkers.length === 0) return null;
        var best = null, bestDist = Infinity;
        for (var i = 0; i < currentMarkers.length; i++) {
            var dist = Math.abs(currentMarkers[i].time_sec - timeSec);
            if (dist < bestDist) { bestDist = dist; best = currentMarkers[i]; }
        }
        return bestDist <= MARKER_SNAP_SEC ? best : null;
    }

    function updateHoverMarkerInfo(timeSec) {
        var markerDiv = document.getElementById('hover-preview-marker');
        if (!markerDiv) return;
        var m = findNearestMarker(timeSec);
        if (!m) {
            markerDiv.style.display = 'none';
            markerDiv.innerHTML = '';
            return;
        }
        var type = KNOWN_TYPES[m.type] ? m.type : 'info';
        markerDiv.style.display = '';
        markerDiv.innerHTML = '<span class="ai-marker-' + type + '">'
            + (TYPE_SHAPES[type] || '\u25CF') + '</span> '
            + TPP.escapeHtml(m.label || '');
    }

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

    // --- Cluster Card ---

    function showClusterCard(group, pillEl) {
        dismissCard();
        var card = document.createElement('div');
        card.className = 'ai-mini-card ai-cluster-card';

        for (var i = 0; i < group.markers.length; i++) {
            (function(m) {
                var type = KNOWN_TYPES[m.type] ? m.type : 'info';
                var row = document.createElement('div');
                row.className = 'ai-cluster-row';

                var typeDot = document.createElement('span');
                typeDot.className = 'ai-mini-card-type ai-marker-' + type;
                typeDot.textContent = TYPE_SHAPES[type] || '\u25CF';
                row.appendChild(typeDot);

                var timeSpan = document.createElement('span');
                timeSpan.className = 'ai-mini-card-time';
                timeSpan.textContent = formatTs(m.time_sec);
                row.appendChild(timeSpan);

                var labelSpan = document.createElement('span');
                labelSpan.className = 'ai-cluster-label';
                labelSpan.textContent = m.label || '';
                if (type === 'dismissed') labelSpan.style.textDecoration = 'line-through';
                row.appendChild(labelSpan);

                var btn = document.createElement('button');
                btn.className = 'ai-cluster-play';
                btn.textContent = '\u25B6';
                btn.title = '\u4ece\u6b64\u5904\u64ad\u653e';
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    onSeek(m.time_sec * 1000);
                    dismissCard();
                });
                row.appendChild(btn);

                card.appendChild(row);
            })(group.markers[i]);
        }

        markerTrack.appendChild(card);
        activeCard = card;

        var trackRect = markerTrack.getBoundingClientRect();
        var pillRect = pillEl.getBoundingClientRect();
        var cardW = card.offsetWidth;
        var leftPx = (pillRect.left - trackRect.left) + pillRect.width / 2 - cardW / 2;
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
        currentMarkers = [];
        while (markerTrack.firstChild) {
            markerTrack.removeChild(markerTrack.firstChild);
        }
    }

    function renderSingleMarker(m, totalSec) {
        var sec = Math.max(0, Math.min(m.time_sec, totalSec));
        var type = KNOWN_TYPES[m.type] ? m.type : 'info';

        var el = document.createElement('div');
        el.className = 'ai-marker ai-marker-' + type;
        el.style.left = (sec / totalSec) * 100 + '%';
        el.textContent = TYPE_SHAPES[type] || '\u25CF';
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');

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
                    showMiniCard(marker, markerEl);
                }
            });
        })(m, el);

        return el;
    }

    function setMarkers(markers) {
        clearMarkers();
        var totalSec = totalMs / 1000;
        if (totalSec <= 0 || !markers || markers.length === 0) return;
        currentMarkers = markers;

        var groups = computeClusters(markers, totalSec);
        for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            if (g.markers.length === 1) {
                markerTrack.appendChild(renderSingleMarker(g.markers[0], totalSec));
            } else {
                var pill = document.createElement('div');
                pill.className = 'ai-marker-cluster';
                pill.style.left = g.avgPct + '%';
                pill.textContent = g.markers.length;
                pill.title = g.markers.length + ' \u4e2a\u6807\u8bb0';
                pill.setAttribute('tabindex', '0');
                pill.setAttribute('role', 'button');

                (function(group, pillEl) {
                    pillEl.addEventListener('click', function(e) {
                        e.stopPropagation();
                        showClusterCard(group, pillEl);
                    });
                    pillEl.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            showClusterCard(group, pillEl);
                        }
                    });
                })(g, pill);

                markerTrack.appendChild(pill);
            }
        }
    }

    // --- Destroy ---

    function destroy() {
        window.removeEventListener('resize', onResize);
        clearTimeout(resizeTimer);
        dismissCard();
        if (hoverMoveHandler && progressContainer) {
            progressContainer.removeEventListener('mousemove', hoverMoveHandler);
            hoverMoveHandler = null;
        }
        if (hoverLeaveHandler && progressContainer) {
            progressContainer.removeEventListener('mouseleave', hoverLeaveHandler);
            hoverLeaveHandler = null;
        }
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
        getMarkers: function() { return currentMarkers; },
        destroy: destroy
    };
};
