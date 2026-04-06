// Teleport RDP Web Player — App Entry Point
(function() {
    'use strict';

    var TYPE_RDP_KEYFRAME = TPP.TYPE_RDP_KEYFRAME;

    var rid = window.__TP_RID || new URLSearchParams(location.search).get('rid');
    var serverBase = window.__TP_SERVER || location.origin;

    if (!rid) {
        showError('\u7f3a\u5c11\u53c2\u6570: rid (\u5f55\u5236ID)');
        return;
    }

    // --- DOM references ---
    var canvas = document.getElementById('player-canvas');
    var canvasWrapper = document.getElementById('canvas-wrapper');
    var canvasContainer = document.getElementById('canvas-container');
    var loadingOverlay = document.getElementById('loading-overlay');
    var loadingText = document.getElementById('loading-text');
    var loadingProgress = document.getElementById('loading-progress');
    var errorOverlay = document.getElementById('error-overlay');
    var errorText = document.getElementById('error-text');
    var btnPlay = document.getElementById('btn-play');
    var speedGroup = document.getElementById('speed-group');
    var speedBtns = speedGroup.querySelectorAll('.seg-btn');
    var skipToggle = document.getElementById('skip-toggle');
    var skipGroup = document.getElementById('skip-group');
    var progressContainer = document.getElementById('progress-container');
    var progressPlayed = document.getElementById('progress-played');
    var progressHandle = document.getElementById('progress-handle');
    var progressBar = document.getElementById('progress-bar');
    var timeDisplay = document.getElementById('time-display');
    var btnFit = document.getElementById('btn-fit');
    var btnOriginal = document.getElementById('btn-original');
    var btnZoomIn = document.getElementById('btn-zoom-in');
    var btnZoomOut = document.getElementById('btn-zoom-out');
    var zoomDisplay = document.getElementById('zoom-display');
    var errorRetry = document.getElementById('error-retry');
    var toastContainer = document.getElementById('toast-container');
    var actionOverlay = document.getElementById('action-overlay');
    var shortcutHint = document.getElementById('shortcut-hint');

    // --- New DOM references ---
    var menuMeta = document.getElementById('menu-meta');
    var menuFile = document.getElementById('menu-file');
    var menuHistory = document.getElementById('menu-history');
    var menuHelp = document.getElementById('menu-help');
    var historyList = document.getElementById('history-list');
    var historyEmpty = document.getElementById('history-empty');
    var noteTags = document.getElementById('note-tags');
    var noteText = document.getElementById('note-text');
    var infoList = document.getElementById('info-list');

    // --- Core instances ---
    var cacheManager = null;
    try { cacheManager = TPP.createCacheManager(rid); } catch (e) { console.warn('Cache manager not available:', e); }
    var downloader = TPP.createDownloader(serverBase, rid, cacheManager);
    var imageCache = TPP.createImageCache();
    var renderer = TPP.createRenderer(canvas);
    var zoom = TPP.createZoomController(canvasWrapper, canvasContainer, zoomDisplay);
    window.__TP_ZOOM = zoom;
    var notes = TPP.createNotes(rid);
    var history = TPP.createHistory();

    var aiSettings = TPP.createAISettings();
    var promptTemplates = TPP.createPromptTemplates();
    var reportCache = TPP.createReportCache();
    var hostResolver = TPP.createHostResolver(serverBase);
    var aiAnalyzer = null;
    var lastL1Result = null;
    var reportPanel = null;
    var timelineMarkers = null;
    var allDataReady = false;
    var downloadedFileCount = 0;

    var player = TPP.createPlayer(renderer, imageCache, {
        onProgress: function (cur, total) { updateProgressBar(cur, total); },
        onEnd: function () { btnPlay.textContent = '\u25B6'; },
        onError: function (err) { console.error('Playback error:', err); },
    });

    // --- Preferences (localStorage) ---
    var PREFS_KEY = 'tp_player_prefs';
    function loadPrefs() {
        try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
        catch (e) { return {}; }
    }
    function savePrefs(update) {
        try {
            var prefs = Object.assign(loadPrefs(), update);
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        } catch (e) { /* quota or private mode */ }
    }

    // Apply saved preferences to UI
    var savedPrefs = loadPrefs();
    if (savedPrefs.speed) {
        for (var pi = 0; pi < speedBtns.length; pi++) {
            var isActive = parseInt(speedBtns[pi].getAttribute('data-speed'), 10) === savedPrefs.speed;
            speedBtns[pi].classList.toggle('active', isActive);
        }
        player.setSpeed(savedPrefs.speed);
    }
    if (savedPrefs.skipSilence !== undefined) {
        skipToggle.classList.toggle('active', savedPrefs.skipSilence);
        player.setSkipSilence(savedPrefs.skipSilence);
    }

    // --- Helpers ---
    function formatTime(ms) {
        var sec = Math.floor(ms / 1000);
        var m = Math.floor(sec / 60), s = sec % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function updateProgressBar(cur, total) {
        var pct = total > 0 ? (cur / total) * 100 : 0;
        progressPlayed.style.width = pct + '%';
        progressHandle.style.left = pct + '%';
        timeDisplay.textContent = formatTime(cur) + ' / ' + formatTime(total);
    }

    function showError(msg) {
        loadingOverlay.style.display = 'none';
        errorOverlay.style.display = 'flex';
        errorText.textContent = msg;
    }

    function showLoading(text, progress) {
        loadingOverlay.style.display = 'flex';
        errorOverlay.style.display = 'none';
        loadingText.textContent = text;
        loadingProgress.textContent = progress || '';
    }

    function hideOverlays() {
        loadingOverlay.style.display = 'none';
        errorOverlay.style.display = 'none';
    }

    function showToast(msg, type) {
        var toast = document.createElement('div');
        toast.className = 'toast ' + (type || 'info');
        toast.textContent = msg;
        toastContainer.appendChild(toast);
        setTimeout(function () {
            toast.classList.add('hiding');
            setTimeout(function () { toast.remove(); }, 300);
        }, 4000);
    }

    function renderCorruptMarks(corruptedRanges, pkts, total) {
        progressBar.querySelectorAll('.corrupt-mark').forEach(function (el) { el.remove(); });
        if (corruptedRanges.length === 0 || total <= 0) return;
        for (var r = 0; r < corruptedRanges.length; r++) {
            var range = corruptedRanges[r];
            var startMs = 0, endMs = total;
            for (var p = 0; p < pkts.length; p++) {
                if (pkts[p].payloadOffset <= range.startOffset) startMs = pkts[p].timeMs;
                if (pkts[p].payloadOffset >= range.endOffset) { endMs = pkts[p].timeMs; break; }
            }
            var mark = document.createElement('div');
            mark.className = 'corrupt-mark';
            mark.style.left = ((startMs / total) * 100) + '%';
            mark.style.width = Math.max(0.5, ((endMs - startMs) / total) * 100) + '%';
            mark.title = '\u635f\u574f\u533a\u57df: ' + formatTime(startMs) + ' - ' + formatTime(endMs);
            progressBar.appendChild(mark);
        }
    }

    // --- Speed control ---
    function setActiveSpeed(targetBtn) {
        for (var i = 0; i < speedBtns.length; i++) speedBtns[i].classList.remove('active');
        targetBtn.classList.add('active');
        player.setSpeed(parseInt(targetBtn.getAttribute('data-speed'), 10));
    }

    function cycleSpeed(dir) {
        var activeIdx = -1;
        for (var i = 0; i < speedBtns.length; i++) {
            if (speedBtns[i].classList.contains('active')) { activeIdx = i; break; }
        }
        var nextIdx = activeIdx + dir;
        if (nextIdx >= 0 && nextIdx < speedBtns.length) setActiveSpeed(speedBtns[nextIdx]);
    }

    // --- Zoom active-state tracking ---
    function updateZoomBtnState(mode) {
        btnFit.classList.toggle('active', mode === 'fit');
        btnOriginal.classList.toggle('active', mode === '1:1');
    }

    // --- Keyboard action animations ---
    function showActionIcon(symbol) {
        var el = document.createElement('div');
        el.className = 'action-icon';
        el.textContent = symbol;
        actionOverlay.innerHTML = '';
        actionOverlay.appendChild(el);
        el.addEventListener('animationend', function () { el.remove(); });
    }

    function showSeekIndicator(direction) {
        var existing = canvasContainer.querySelector('.seek-indicator');
        if (existing) existing.remove();
        var el = document.createElement('div');
        el.className = 'seek-indicator ' + direction;
        el.textContent = direction === 'left' ? '\u00AB 10s' : '10s \u00BB';
        canvasContainer.appendChild(el);
        el.addEventListener('animationend', function () { el.remove(); });
    }

    function showShortcutHint() {
        if (!shortcutHint) return;
        shortcutHint.classList.remove('hidden');
        setTimeout(function () {
            shortcutHint.classList.add('hidden');
        }, 3000);
    }

    // --- Menu dropdown logic ---
    function closeAllMenus() {
        var items = document.querySelectorAll('.menu-item');
        for (var i = 0; i < items.length; i++) items[i].classList.remove('open');
    }

    function toggleMenu(menuItem) {
        var isOpen = menuItem.classList.contains('open');
        closeAllMenus();
        if (!isOpen) menuItem.classList.add('open');
    }

    menuFile.querySelector('.menu-label').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleMenu(menuFile);
    });
    menuHistory.querySelector('.menu-label').addEventListener('click', function (e) {
        e.stopPropagation();
        populateHistory();
        toggleMenu(menuHistory);
    });
    menuHelp.querySelector('.menu-label').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleMenu(menuHelp);
    });

    document.addEventListener('click', function () { closeAllMenus(); });

    var dropdowns = document.querySelectorAll('.menu-dropdown');
    for (var di = 0; di < dropdowns.length; di++) {
        dropdowns[di].addEventListener('click', function (e) { e.stopPropagation(); });
    }

    document.getElementById('menu-back-list').addEventListener('click', function () {
        closeAllMenus();
        window.location.href = '/audit/record';
    });

    document.getElementById('menu-clear-cache-current').addEventListener('click', function () {
        if (!cacheManager) { showToast('缓存不可用', 'warning'); closeAllMenus(); return; }
        cacheManager.clearCurrent().then(function () {
            showToast('当前录像缓存已清除', 'info');
            updateInfoPanel();
        });
        closeAllMenus();
    });

    document.getElementById('menu-clear-cache-all').addEventListener('click', function () {
        if (!cacheManager) { showToast('缓存不可用', 'warning'); closeAllMenus(); return; }
        cacheManager.clearAll().then(function () {
            showToast('所有缓存已清除', 'info');
            updateInfoPanel();
        });
        closeAllMenus();
    });

    document.getElementById('menu-show-shortcuts').addEventListener('click', function () {
        closeAllMenus();
    });

    // --- History panel ---
    function populateHistory() {
        var items = history.getAll();
        historyList.innerHTML = '';
        historyEmpty.style.display = items.length === 0 ? 'block' : 'none';
        for (var i = 0; i < items.length; i++) {
            (function (item) {
                var div = document.createElement('div');
                div.className = 'history-item' + (String(item.rid) === String(rid) ? ' current' : '');
                div.innerHTML = ''
                    + '<span class="history-item-user">' + TPP.escapeHtml(item.user || 'Unknown') + '</span>'
                    + '<span class="history-item-meta">' + TPP.escapeHtml(item.duration || '') + ' | ' + TPP.escapeHtml(item.date || '') + '</span>';
                div.addEventListener('click', function () {
                    closeAllMenus();
                    if (String(item.rid) === String(rid)) return;
                    window.location.href = '/audit/replay/1/' + item.rid + '?tp_web_player=1&rid=' + item.rid;
                });
                historyList.appendChild(div);
            })(items[i]);
        }
    }

    // --- Notes panel ---
    function initNotes() {
        var note = notes.get();
        var tagBtns = noteTags.querySelectorAll('.note-tag');
        for (var i = 0; i < tagBtns.length; i++) {
            tagBtns[i].classList.toggle('active', tagBtns[i].getAttribute('data-tag') === note.tag);
        }
        noteText.value = note.text || '';
        for (var j = 0; j < tagBtns.length; j++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    var updated = notes.setTag(btn.getAttribute('data-tag'));
                    for (var k = 0; k < tagBtns.length; k++) {
                        tagBtns[k].classList.toggle('active', tagBtns[k].getAttribute('data-tag') === updated.tag);
                    }
                });
            })(tagBtns[j]);
        }
        var debounceTimer;
        noteText.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                notes.setText(noteText.value);
            }, 500);
        });
    }

    function startAnalysis() {
        if (!allDataReady || !aiAnalyzer) return;
        reportPanel.showProgress();
        reportPanel.updateProgress('loading', 0, 0);

        aiAnalyzer.runAnalysis().then(function(report) {
            if (!report || typeof report !== 'object') {
                throw new Error('AI 返回了空结果');
            }
            // Use verdict banner + timeline markers if markers present
            if (report.markers && report.markers.length > 0 && timelineMarkers) {
                timelineMarkers.setMarkers(report.markers);
                reportPanel.renderVerdictBanner(report);
            } else {
                reportPanel.renderReport(report);
            }
        }).catch(function(err) {
            if (err.message === '\u5df2\u53d6\u6d88') {
                reportPanel.showIdle();
            } else {
                console.error('[AI] Analysis error:', err);
                reportPanel.showIdle();
                showToast('AI \u5206\u6790\u5931\u8d25: ' + err.message, 'error');
            }
        });
    }

    function cancelAnalysis() {
        if (aiAnalyzer) aiAnalyzer.cancel();
    }

    function initAIPanel() {
        reportPanel = TPP.createReportPanel({
            player: player,
            rid: rid,
            reportCache: reportCache,
            aiSettings: aiSettings,
            onStartAnalysis: startAnalysis,
            onCancelAnalysis: cancelAnalysis,
            onAutoChanged: function(checked) {
                aiSettings.update({ autoAnalyze: checked });
            },
            onRetryPhase: function(phaseIndex) {
                if (!lastL1Result || !aiAnalyzer) {
                    startAnalysis();
                    return;
                }
                aiSettings.load().then(function(s) {
                    reportPanel.updatePhaseCard(phaseIndex, 'analyzing');
                    aiAnalyzer.retryPhase(phaseIndex, lastL1Result, s).then(function(result) {
                        reportPanel.updatePhaseCard(phaseIndex, 'done', result);
                    }).catch(function(err) {
                        reportPanel.updatePhaseCard(phaseIndex, 'error', null, err.message);
                    });
                });
            }
        });

        aiSettings.load().then(function(s) {
            reportPanel.setAutoAnalyze(s.autoAnalyze);
        });

        reportPanel.loadCachedReport();
    }

    // --- Info panel ---
    function updateInfoPanel(header) {
        if (!infoList) return;
        if (header) window.__TP_HEADER = header;
        var h = window.__TP_HEADER;
        if (!h) {
            infoList.innerHTML = '<span class="info-label">\u52a0\u8f7d\u4e2d...</span>';
            return;
        }
        var cacheSize = cacheManager ? cacheManager.getCacheSize() : 0;
        var cacheSizeMB = (cacheSize / 1024 / 1024).toFixed(1);
        var cacheText = cacheSize > 0 ? '\u5df2\u7f13\u5b58 (' + cacheSizeMB + ' MB)' : '\u672a\u7f13\u5b58';
        var hostInfo = window.__TP_HOST_INFO;
        var hostHtml = '';
        if (hostInfo && hostInfo.parsed.topic) {
            hostHtml = '<div><span class="info-label">\u673a\u8bd5:</span>' + TPP.escapeHtml(hostInfo.parsed.topic)
                + (hostInfo.parsed.role ? ' (' + TPP.escapeHtml(hostInfo.parsed.role) + ')' : '') + '</div>';
        }
        infoList.innerHTML = ''
            + '<div><span class="info-label">\u7528\u6237:</span>' + TPP.escapeHtml(h.userUsername) + '</div>'
            + hostHtml
            + '<div><span class="info-label">\u65f6\u957f:</span>' + formatTime(h.timeMs) + '</div>'
            + '<div><span class="info-label">\u5206\u8fa8\u7387:</span>' + h.width + ' \u00d7 ' + h.height + '</div>'
            + '<div><span class="info-label">\u8fdc\u7a0b:</span>' + TPP.escapeHtml(h.accUsername) + '@' + TPP.escapeHtml(h.hostIp) + '</div>'
            + '<div><span class="info-label">\u7f13\u5b58:</span>' + cacheText + '</div>';
    }

    // --- Init & load ---
    function init() {
        showLoading('\u6b63\u5728\u52a0\u8f7d WASM \u6a21\u5757...');
        TPP.initDecoder().then(function () {
            showLoading('\u6b63\u5728\u4e0b\u8f7d\u5f55\u5236\u5934...');
            return downloader.readFile('tp-rdp.tpr');
        }).then(function (tprBuf) {
            if (!tprBuf) throw new Error('\u65e0\u6cd5\u4e0b\u8f7d tp-rdp.tpr');
            var header = TPP.parseHeader(tprBuf);
            document.title = 'RDP \u56de\u653e \u2014 ' + header.accUsername + '@' + header.hostIp;
            renderer.init(header.width, header.height);
            zoom.init(header.width, header.height);

            // Update menu meta
            menuMeta.textContent = header.userUsername + ' | ' + new Date(header.timestamp * 1000).toLocaleString('zh-CN');

            // Resolve host info and update title/template
            hostResolver.resolveByIp(header.hostIp).then(function(hostInfo) {
                if (!hostInfo || !hostInfo.name) return;
                var parsed = hostResolver.parseHostName(hostInfo.name);
                window.__TP_HOST_INFO = { raw: hostInfo, parsed: parsed };

                // Update page title with exam topic
                var titleStr = hostResolver.formatTitle(parsed, header.userUsername);
                document.title = 'RDP \u56de\u653e \u2014 ' + titleStr;

                // Update menu meta
                var metaParts = [header.userUsername];
                if (parsed.topic) metaParts.push(parsed.topic);
                if (parsed.role) metaParts.push(parsed.role);
                metaParts.push(new Date(header.timestamp * 1000).toLocaleString('zh-CN'));
                menuMeta.textContent = metaParts.join(' | ');

                // Update info panel with host name
                updateInfoPanel();
            }).catch(function() { /* ignore, non-critical */ });

            // Record to history
            var historyUser = header.userUsername + ' (' + header.accUsername + ')';
            history.add({
                rid: rid,
                user: historyUser,
                duration: formatTime(header.timeMs),
                date: new Date(header.timestamp * 1000).toLocaleDateString('zh-CN'),
                timestamp: Date.now()
            });

            // Update history with host info once resolved
            hostResolver.resolveByIp(header.hostIp).then(function(hostInfo) {
                if (!hostInfo || !hostInfo.name) return;
                var parsed = hostResolver.parseHostName(hostInfo.name);
                var enrichedUser = header.userUsername;
                if (parsed.topic) enrichedUser += ' | ' + parsed.topic;
                history.add({
                    rid: rid,
                    user: enrichedUser,
                    duration: formatTime(header.timeMs),
                    date: new Date(header.timestamp * 1000).toLocaleDateString('zh-CN'),
                    timestamp: Date.now()
                });
            }).catch(function() {});

            // Update info panel
            updateInfoPanel(header);

            // Apply saved zoom mode
            if (savedPrefs.zoomMode === '1:1') {
                zoom.originalSize();
                updateZoomBtnState('1:1');
            } else {
                updateZoomBtnState('fit');
            }

            showLoading('\u6b63\u5728\u4e0b\u8f7d\u5173\u952e\u5e27\u7d22\u5f15...');
            return downloader.readFile('tp-rdp.tpk').then(function (tpkBuf) {
                var keyframes = tpkBuf ? TPP.parseKeyframes(tpkBuf) : [];
                return { header: header, keyframes: keyframes };
            });
        }).then(function (ctx) {
            var header = ctx.header, keyframes = ctx.keyframes;
            var allPackets = [], corruptedRanges = [];

            aiAnalyzer = TPP.createAIAnalyzer({
                header: header,
                keyframes: keyframes,
                allPackets: allPackets,
                settings: aiSettings,
                templates: promptTemplates,
                reportCache: reportCache,
                rid: rid,
                onProgress: function(stage, current, total) {
                    if (reportPanel) reportPanel.updateProgress(stage, current, total);
                },
                onPhaseReady: function(phaseIndex, status, result, errorMsg) {
                    if (!reportPanel) return;
                    if (phaseIndex === -1 && status === 'skeleton') {
                        lastL1Result = result;
                        reportPanel.renderSkeleton(result);
                        // Set L1 markers on timeline immediately
                        if (result.markers && result.markers.length > 0 && timelineMarkers) {
                            timelineMarkers.setMarkers(result.markers);
                        }
                    } else {
                        reportPanel.updatePhaseCard(phaseIndex, status, result, errorMsg);
                    }
                }
            });

            if (header.datFileCount > 0) {
                showLoading('\u6b63\u5728\u4e0b\u8f7d\u6570\u636e\u6587\u4ef6 1/' + header.datFileCount + '...', '');
                return downloader.readFileWithProgress('tp-rdp-1.tpd', function (received, total) {
                    var pct = total > 0 ? Math.round(received / total * 100) : 0;
                    loadingProgress.textContent = pct + '% (' + (received / 1024 / 1024).toFixed(1) + ' MB)';
                }).then(function (firstBuf) {
                    if (firstBuf) {
                        var pkts = TPP.iteratePackets(firstBuf, corruptedRanges);
                        for (var i = 0; i < pkts.length; i++) allPackets.push(pkts[i]);
                    }
                    allPackets.sort(function (a, b) { return a.timeMs - b.timeMs; });
                    player.load(allPackets, keyframes, header.timeMs);
                    renderCorruptMarks(corruptedRanges, allPackets, header.timeMs);

                    // Initialize timeline markers (heatmap + AI markers)
                    var markerTrack = document.getElementById('ai-marker-track');
                    if (markerTrack && TPP.createTimelineMarkers) {
                        timelineMarkers = TPP.createTimelineMarkers({
                            allPackets: allPackets,
                            totalMs: header.timeMs,
                            progressBar: progressBar,
                            markerTrack: markerTrack,
                            onSeek: function(timeMs) {
                                player.seek(timeMs);
                                updateProgressBar(timeMs, header.timeMs);
                            }
                        });
                        timelineMarkers.updateHeatmap();
                        // If a cached report with markers was already loaded, show them
                        reportCache.get(rid).then(function(entry) {
                            if (entry && entry.report && entry.report.markers && entry.report.markers.length > 0) {
                                timelineMarkers.setMarkers(entry.report.markers);
                            }
                        });
                    }

                    // Seek to first keyframe to get a clean initial frame (avoids garbled tiles)
                    var firstKfTime = -1;
                    for (var fi = 0; fi < allPackets.length; fi++) {
                        if (allPackets[fi].type === TYPE_RDP_KEYFRAME) {
                            firstKfTime = allPackets[fi].timeMs;
                            break;
                        }
                    }
                    if (firstKfTime >= 0) {
                        player.seek(firstKfTime);
                    }

                    updateProgressBar(player.currentMs, header.timeMs);
                    hideOverlays();
                    player.play();
                    btnPlay.textContent = '\u23F8';

                    // Refresh cache status in info panel after cache write completes
                    setTimeout(function () { updateInfoPanel(); }, 500);

                    downloadedFileCount = 1;
                    if (header.datFileCount <= 1) {
                        allDataReady = true;
                        if (reportPanel) {
                            reportPanel.setDataReady(true);
                        }
                    } else if (reportPanel) {
                        reportPanel.setDataReady(false, '\u6570\u636e\u4e0b\u8f7d\u4e2d... (1/' + header.datFileCount + ')');
                    }

                    if (corruptedRanges.length > 0) {
                        showToast('\u68c0\u6d4b\u5230 ' + corruptedRanges.length + ' \u5904\u6570\u636e\u635f\u574f\uff0c\u5df2\u81ea\u52a8\u8df3\u8fc7', 'warning');
                    }

                    // Background-download remaining files (non-blocking)
                    var chain = Promise.resolve();
                    for (var f = 2; f <= header.datFileCount; f++) {
                        (function (idx) {
                            chain = chain.then(function () {
                                return downloader.readFileWithProgress('tp-rdp-' + idx + '.tpd', function () {}).then(function (buf) {
                                    if (!buf) {
                                        showToast('\u6570\u636e\u6587\u4ef6 ' + idx + ' \u4e0d\u5b58\u5728\uff0c\u5df2\u8df3\u8fc7', 'warning');
                                        return;
                                    }
                                    var pkts = TPP.iteratePackets(buf, corruptedRanges);
                                    for (var j = 0; j < pkts.length; j++) allPackets.push(pkts[j]);
                                    allPackets.sort(function (a, b) { return a.timeMs - b.timeMs; });
                                    player.updatePackets(allPackets, keyframes, header.timeMs);
                                    renderCorruptMarks(corruptedRanges, allPackets, header.timeMs);
                                    if (timelineMarkers) timelineMarkers.updateHeatmap();
                                    setTimeout(function () { updateInfoPanel(); }, 500);
                                    downloadedFileCount = idx;
                                    if (idx >= header.datFileCount) {
                                        allDataReady = true;
                                        if (reportPanel) {
                                            reportPanel.setDataReady(true);
                                            if (reportPanel.getAutoAnalyze()) {
                                                reportPanel.loadCachedReport().then(function(hasCached) {
                                                    if (!hasCached) startAnalysis();
                                                });
                                            }
                                        }
                                    } else if (reportPanel) {
                                        reportPanel.setDataReady(false, '\u6570\u636e\u4e0b\u8f7d\u4e2d... (' + idx + '/' + header.datFileCount + ')');
                                    }
                                }).catch(function (err) {
                                    showToast('\u6570\u636e\u6587\u4ef6 ' + idx + ' \u52a0\u8f7d\u5931\u8d25: ' + err.message, 'warning');
                                });
                            });
                        })(f);
                    }
                    return chain;
                });
            }
            hideOverlays();
        }).catch(function (err) {
            console.error('Init error:', err);
            if (err.code === 'AUTH_EXPIRED') showError('\u8ba4\u8bc1\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u540e\u518d\u8bd5');
            else showError('\u52a0\u8f7d\u5931\u8d25: ' + err.message);
        });
    }

    // --- UI event handlers ---

    // Play/Pause
    btnPlay.addEventListener('click', function () {
        var isNowPlaying = player.togglePlayPause();
        btnPlay.textContent = isNowPlaying ? '\u23F8' : '\u25B6';
        showActionIcon(isNowPlaying ? '\u25B6' : '\u23F8');
    });

    // Segmented speed control
    for (var si = 0; si < speedBtns.length; si++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                setActiveSpeed(btn);
                savePrefs({ speed: parseInt(btn.getAttribute('data-speed'), 10) });
            });
        })(speedBtns[si]);
    }

    // Toggle switch — skip silence
    skipGroup.addEventListener('click', function () {
        skipToggle.classList.toggle('active');
        var isActive = skipToggle.classList.contains('active');
        player.setSkipSilence(isActive);
        savePrefs({ skipSilence: isActive });
    });

    // Progress bar seek
    var seeking = false, wasPlayingBeforeSeek = false;
    progressContainer.addEventListener('mousedown', function (e) {
        seeking = true;
        wasPlayingBeforeSeek = player.playing;
        player.pause();
        progressHandle.classList.add('active');
        seekToPosition(e);
    });
    window.addEventListener('mousemove', function (e) { if (seeking) seekToPosition(e); });
    window.addEventListener('mouseup', function () {
        if (seeking) {
            seeking = false;
            progressHandle.classList.remove('active');
            if (wasPlayingBeforeSeek) { player.play(); btnPlay.textContent = '\u23F8'; }
        }
    });
    function seekToPosition(e) {
        var rect = progressBar.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        player.seek(pct * player.totalMs);
    }

    // Zoom buttons
    btnFit.addEventListener('click', function () { zoom.fitToWindow(); updateZoomBtnState('fit'); savePrefs({ zoomMode: 'fit' }); });
    btnOriginal.addEventListener('click', function () { zoom.originalSize(); updateZoomBtnState('1:1'); savePrefs({ zoomMode: '1:1' }); });
    btnZoomIn.addEventListener('click', function () { zoom.zoomIn(); updateZoomBtnState(null); });
    btnZoomOut.addEventListener('click', function () { zoom.zoomOut(); updateZoomBtnState(null); });

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        switch (e.code) {
            case 'Space':
                e.preventDefault();
                var isNowPlaying = player.togglePlayPause();
                btnPlay.textContent = isNowPlaying ? '\u23F8' : '\u25B6';
                showActionIcon(isNowPlaying ? '\u25B6' : '\u23F8');
                break;
            case 'ArrowLeft':
                e.preventDefault();
                var wl = player.playing;
                player.seek(Math.max(0, player.currentMs - 10000));
                if (wl) player.play();
                showSeekIndicator('left');
                break;
            case 'ArrowRight':
                e.preventDefault();
                var wr = player.playing;
                player.seek(Math.min(player.totalMs, player.currentMs + 10000));
                if (wr) player.play();
                showSeekIndicator('right');
                break;
            case 'Equal': case 'NumpadAdd':
                e.preventDefault(); cycleSpeed(1); break;
            case 'Minus': case 'NumpadSubtract':
                e.preventDefault(); cycleSpeed(-1); break;
        }
    });

    // Retry & resize
    errorRetry.addEventListener('click', function () { init(); });
    window.addEventListener('resize', function () { zoom.handleResize(); });

    // --- Sidebar toggle ---
    var sidebar = document.getElementById('sidebar');
    var mainContent = document.getElementById('main-content');
    var btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
    var btnSidebarExpand = document.getElementById('btn-sidebar-expand');
    var resizeHandle = document.getElementById('sidebar-resize-handle');

    function toggleSidebar(collapsed) {
        sidebar.classList.toggle('collapsed', collapsed);
        mainContent.classList.toggle('sidebar-collapsed', collapsed);
        // Restore wide mode if AI tab is active when expanding
        if (!collapsed) {
            var activeTab = sidebar.querySelector('.sidebar-tab.active');
            var isAI = activeTab && activeTab.getAttribute('data-tab') === 'ai-report';
            sidebar.classList.toggle('wide', isAI);
            // Restore saved width if user had custom-dragged
            var sw = loadPrefs().sidebarWidth;
            if (sw && isAI) {
                sidebar.style.width = sw + 'px';
            } else {
                sidebar.style.width = '';
            }
        }
        savePrefs({ sidebarCollapsed: collapsed });
        setTimeout(function() { zoom.handleResize(); }, 280);
    }

    if (btnSidebarToggle) {
        btnSidebarToggle.addEventListener('click', function() {
            toggleSidebar(!sidebar.classList.contains('collapsed'));
        });
    }
    if (btnSidebarExpand) {
        btnSidebarExpand.addEventListener('click', function() {
            toggleSidebar(false);
        });
    }

    // --- Sidebar drag resize ---
    if (resizeHandle) {
        var dragState = null;
        resizeHandle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            dragState = { startX: e.clientX, startW: sidebar.offsetWidth };
            sidebar.classList.add('resizing');
            resizeHandle.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', function(e) {
            if (!dragState) return;
            var delta = dragState.startX - e.clientX;
            var newW = Math.max(180, Math.min(window.innerWidth * 0.6, dragState.startW + delta));
            sidebar.style.width = newW + 'px';
        });

        document.addEventListener('mouseup', function() {
            if (!dragState) return;
            var finalW = sidebar.offsetWidth;
            sidebar.classList.remove('resizing');
            resizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            dragState = null;
            savePrefs({ sidebarWidth: finalW });
            zoom.handleResize();
        });
    }

    // Restore sidebar state
    if (savedPrefs.sidebarCollapsed) {
        toggleSidebar(true);
    }

    init();
    notes.onReady(initNotes);
    initAIPanel();
})();
