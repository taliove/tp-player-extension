// Teleport RDP Web Player — PDF Report Generator
// Orchestrates data collection, screenshot capture, and print overlay injection.
// Architecture: in-page print overlay (not new tab), per eng review corrections.

(function() {
    'use strict';

    // --- Utilities ---

    function extractRecordingId() {
        // URL pattern: /audit/replay/{protocol}/{id} or ?rid=...
        if (window.__TP_RID) return String(window.__TP_RID);
        var match = location.pathname.match(/\/audit\/replay\/\d+\/(\d+)/);
        return match ? match[1] : null;
    }

    function getHeaderData() {
        return window.__TP_HEADER || null;
    }

    function getHostInfo() {
        return window.__TP_HOST_INFO || null;
    }

    function computeEvenSamplePoints(totalMs, percentages) {
        var points = [];
        for (var i = 0; i < percentages.length; i++) {
            var sec = Math.round((totalMs * percentages[i]) / 1000);
            points.push({ timestampSec: sec, label: '' });
        }
        return points;
    }

    // --- Report generation ---

    TPP.createReportGenerator = function(opts) {
        var reportCache = opts.reportCache;
        var aiAnalyzer = opts.aiAnalyzer;
        var notes = opts.notes;
        var rid = opts.rid;
        var showToast = opts.showToast || function() {};
        var isReady = false;
        var isGenerating = false;

        function setReady(ready) {
            isReady = ready;
        }

        function generateReport(shiftKey) {
            if (!isReady || isGenerating) return;
            if (!getHeaderData()) {
                showToast('\u5f55\u50cf\u5934\u4fe1\u606f\u672a\u52a0\u8f7d');
                return;
            }

            isGenerating = true;
            var currentRid = extractRecordingId() || rid;
            var header = getHeaderData();
            var hostInfo = getHostInfo();
            var parsed = hostInfo ? hostInfo.parsed : null;
            if (!parsed && hostInfo && hostInfo.raw) {
                parsed = TPP.parseHostNameStr ? TPP.parseHostNameStr(hostInfo.raw.name || '') : null;
            }

            // Collect AI report from IndexedDB
            var aiPromise = reportCache ? reportCache.get(currentRid).catch(function() { return null; }) : Promise.resolve(null);

            aiPromise.then(function(cached) {
                var aiReport = cached ? cached.report : null;

                // Collect screenshots
                return collectScreenshots(aiReport, header).then(function(screenshots) {
                    // Collect notes
                    var noteData = notes ? notes.get() : { tag: null, text: '' };

                    // Get version
                    var version = '';
                    try { version = chrome.runtime.getManifest().version; } catch (e) { /* standalone */ }

                    // Build HTML
                    var html = TPP.buildReportHTML({
                        candidate: header.userUsername || '',
                        role: parsed ? parsed.role : '',
                        topic: parsed ? parsed.topic : '',
                        duration: header.timeMs,
                        startTime: header.timestamp,
                        hostIp: header.hostIp || '',
                        aiReport: aiReport,
                        screenshots: screenshots,
                        notes: noteData,
                        version: version,
                        generatedAt: new Date().toISOString()
                    });

                    // Inject overlay and print
                    injectAndPrint(html, shiftKey);
                });
            }).catch(function(err) {
                console.error('[Report] Generation failed:', err);
                showToast('\u62a5\u544a\u751f\u6210\u5931\u8d25: ' + (err && err.message || err));
            }).finally(function() {
                isGenerating = false;
            });
        }

        function collectScreenshots(aiReport, header) {
            // Primary: reuse cached frames from AI report
            if (aiReport && aiReport._capturedFrames && aiReport._capturedFrames.length > 0) {
                var frames = aiReport._capturedFrames.slice(0, 6);
                // Enrich with marker labels if available
                if (aiReport.markers && aiReport.markers.length > 0) {
                    for (var i = 0; i < frames.length; i++) {
                        var frameSec = frames[i].timestamp_sec;
                        for (var j = 0; j < aiReport.markers.length; j++) {
                            var mk = aiReport.markers[j];
                            if (Math.abs(mk.time_sec - frameSec) < 5) {
                                frames[i] = Object.assign({}, frames[i], {
                                    label: mk.label || frames[i].label,
                                    description: mk.description || ''
                                });
                                break;
                            }
                        }
                    }
                }
                return Promise.resolve(frames);
            }

            // Fallback 1: fresh capture at marker positions
            if (aiReport && aiReport.markers && aiReport.markers.length > 0 && aiAnalyzer) {
                var markerPoints = aiReport.markers.slice(0, 6).map(function(mk) {
                    return { timestampSec: mk.time_sec, label: mk.label || '', description: mk.description || '' };
                });
                return aiAnalyzer.captureFrames(markerPoints).then(function(captured) {
                    // Merge marker descriptions
                    for (var i = 0; i < captured.length; i++) {
                        if (markerPoints[i]) {
                            captured[i].description = markerPoints[i].description || '';
                        }
                    }
                    return captured;
                }).catch(function(err) {
                    console.warn('[Report] Marker capture failed, falling back to even sampling:', err);
                    return captureEvenFrames(header);
                });
            }

            // Fallback 2: evenly-spaced frames
            return captureEvenFrames(header);
        }

        function captureEvenFrames(header) {
            if (!aiAnalyzer) return Promise.resolve([]);
            var points = computeEvenSamplePoints(header.timeMs, [0.25, 0.5, 0.75, 0.9]);
            return aiAnalyzer.captureFrames(points).catch(function(err) {
                console.warn('[Report] Even-frame capture failed:', err);
                return [];
            });
        }

        function injectAndPrint(html, previewOnly) {
            // Remove any existing overlay and clean up prior listeners
            var existing = document.getElementById('report-print-overlay');
            if (existing) existing.remove();

            // Inject overlay into current page
            var container = document.createElement('div');
            container.innerHTML = html;
            document.body.appendChild(container.firstElementChild || container.firstChild);

            if (previewOnly) {
                // Shift+click: show overlay on screen for preview
                var overlay = document.getElementById('report-print-overlay');
                if (overlay) {
                    overlay.style.display = 'block';
                    overlay.style.position = 'fixed';
                    overlay.style.top = '0';
                    overlay.style.left = '0';
                    overlay.style.width = '100%';
                    overlay.style.height = '100%';
                    overlay.style.overflow = 'auto';
                    overlay.style.background = 'white';
                    overlay.style.zIndex = '99999';
                    // Close on Escape (once: true prevents listener leak)
                    document.addEventListener('keydown', function closeHandler(e) {
                        if (e.key === 'Escape') {
                            overlay.remove();
                            document.removeEventListener('keydown', closeHandler);
                        }
                    });
                    showToast('\u6309 Esc \u5173\u95ed\u9884\u89c8');
                }
                return;
            }

            // Normal: show overlay, print, then clean up
            // Must set display:block via JS — @media print on dynamically injected
            // <style> inside the overlay is unreliable in Chrome.
            var overlay = document.getElementById('report-print-overlay');
            if (overlay) overlay.style.display = 'block';

            setTimeout(function() {
                window.print();
                // Clean up overlay after print dialog closes
                setTimeout(function() {
                    var ov = document.getElementById('report-print-overlay');
                    if (ov) ov.remove();
                }, 1000);
            }, 300);
        }

        return {
            generateReport: generateReport,
            setReady: setReady,
            set aiAnalyzer(val) { aiAnalyzer = val; }
        };
    };
})();
