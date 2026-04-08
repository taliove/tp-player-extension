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
    var menuMeta = document.getElementById('info-bar-meta');
    var noteTags = document.getElementById('note-tags');
    var noteText = document.getElementById('note-text');
    var infoList = document.getElementById('info-list');
    var btnTour = document.getElementById('btn-tour');
    var tourOverlay = document.getElementById('tour-overlay');
    var tourCounter = document.getElementById('tour-counter');
    var tourNextBtn = document.getElementById('tour-next');
    var tourExitBtn = document.getElementById('tour-exit');

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
    var verdictBanner = null;
    var timelineMarkers = null;
    var tourMode = null;
    var reportGenerator = null;
    var allDataReady = false;
    var downloadedFileCount = 0;

    var player = TPP.createPlayer(renderer, imageCache, {
        onProgress: function (cur, total) {
            updateProgressBar(cur, total);
            // Capture thumbnails during playback
            if (window.__TP_THUMB_CAPTURE) window.__TP_THUMB_CAPTURE(cur);
        },
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

    // --- Back button ---
    document.getElementById('btn-back').addEventListener('click', function () {
        if (window.__TP_FROM_EXT) {
            // Opened from extension sidebar: close this tab
            window.close();
        } else {
            // Opened from URL/bookmark: navigate to audit page
            chrome.storage.local.get('tp_server_url', function(data) {
                if (data.tp_server_url) {
                    window.location.href = data.tp_server_url.replace(/\/+$/, '') + '/audit/record';
                } else {
                    window.location.href = '/audit/record';
                }
            });
        }
    });

    // --- Tour mode UI ---
    function updateTourUI(active, idx, total) {
        if (tourOverlay) tourOverlay.style.display = active ? '' : 'none';
        if (tourCounter) tourCounter.textContent = total > 0 ? (idx + 1) + '/' + total : '';
        if (btnTour) {
            if (active) btnTour.classList.add('active');
            else btnTour.classList.remove('active');
        }
        if (canvasContainer) {
            if (active) canvasContainer.classList.add('tour-active');
            else canvasContainer.classList.remove('tour-active');
        }
    }

    if (btnTour) {
        btnTour.addEventListener('click', function() {
            if (tourMode && tourMode.isActive()) {
                tourMode.stop();
                return;
            }
            if (!tourMode) {
                showToast('\u8bf7\u5148\u8fd0\u884c AI \u5206\u6790');
                return;
            }
            if (!tourMode.start()) {
                showToast('\u6ca1\u6709\u53ef\u5bfc\u89c8\u7684\u6807\u8bb0\u70b9');
            }
        });
    }
    if (tourNextBtn) {
        tourNextBtn.addEventListener('click', function() {
            if (tourMode) tourMode.next();
        });
    }
    if (tourExitBtn) {
        tourExitBtn.addEventListener('click', function() {
            if (tourMode) tourMode.stop();
        });
    }

    // --- Shortcut overlay (? key) ---
    var shortcutOverlay = document.getElementById('shortcut-overlay');
    document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Escape' && tourMode && tourMode.isActive()) {
            tourMode.stop();
            return;
        }
        if (e.key === '?') {
            shortcutOverlay.style.display = shortcutOverlay.style.display === 'none' ? '' : 'none';
        }
        if (e.key === 'Escape' && shortcutOverlay.style.display !== 'none') {
            shortcutOverlay.style.display = 'none';
        }
    });
    shortcutOverlay.addEventListener('click', function() {
        shortcutOverlay.style.display = 'none';
    });

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
        verdictBanner.showProgress('正在采帧...');

        aiAnalyzer.runAnalysis().then(function(report) {
            if (!report || typeof report !== 'object') {
                throw new Error('AI 返回了空结果');
            }
            // Show verdict banner result
            verdictBanner.showResult(report);
            // Set markers on timeline
            if (report.markers && report.markers.length > 0 && timelineMarkers) {
                timelineMarkers.setMarkers(report.markers);
            }
            // Toast notification
            showToast('分析完成，点击导览查看关键时刻', 'info');
        }).catch(function(err) {
            if (err.message === '已取消') {
                verdictBanner.showIdle(true);
            } else {
                console.error('[AI] Analysis error:', err);
                verdictBanner.showError(err.message);
            }
        });
    }

    function cancelAnalysis() {
        if (aiAnalyzer) aiAnalyzer.cancel();
    }

    function initVerdictBanner() {
        // DOM refs for verdict banner states
        var bannerEl = document.getElementById('verdict-banner');
        var idleEl = document.getElementById('verdict-idle');
        var progressEl = document.getElementById('verdict-progress');
        var resultEl = document.getElementById('verdict-result');
        var errorEl = document.getElementById('verdict-error');
        var phasesEl = document.getElementById('verdict-phases');

        var btnAnalyze = document.getElementById('btn-ai-analyze');
        var btnCancel = document.getElementById('btn-ai-cancel');
        var btnRetry = document.getElementById('btn-ai-retry');
        var btnExpand = document.getElementById('verdict-expand');
        var progressText = document.getElementById('verdict-progress-text');
        var badgeEl = document.getElementById('verdict-badge');
        var scoreEl = document.getElementById('verdict-score');
        var onelinerEl = document.getElementById('verdict-oneliner');
        var errorTextEl = document.getElementById('verdict-error-text');
        var chkAuto = document.getElementById('chk-ai-auto');

        // Settings modal DOM refs
        var settingsModal = document.getElementById('ai-settings-modal');
        var btnSettings = document.getElementById('btn-ai-settings');
        var btnSettingsResult = document.getElementById('btn-ai-settings-result');
        var btnSettingsError = document.getElementById('btn-ai-settings-error');
        var btnSaveSettings = document.getElementById('btn-ai-save-settings');
        var btnCancelSettings = document.getElementById('btn-ai-cancel-settings');
        var btnImport = document.getElementById('btn-ai-import');
        var btnTest = document.getElementById('btn-ai-test');
        var importFile = document.getElementById('ai-import-file');
        var btnToggleKey = document.getElementById('btn-ai-toggle-key');

        var phasesExpanded = false;
        var currentReport = null;

        function hideAll() {
            idleEl.style.display = 'none';
            progressEl.style.display = 'none';
            resultEl.style.display = 'none';
            errorEl.style.display = 'none';
            phasesEl.style.display = 'none';
            phasesExpanded = false;
        }

        function showIdle(dataReady) {
            hideAll();
            idleEl.style.display = '';
            btnAnalyze.disabled = !dataReady;
            btnAnalyze.textContent = dataReady ? 'AI 分析' : '数据加载中...';
        }

        function showProgress(text) {
            hideAll();
            progressEl.style.display = '';
            progressText.textContent = text || '准备中...';
        }

        function showResult(report) {
            hideAll();
            resultEl.style.display = '';
            currentReport = report;

            // Verdict badge
            var verdict = report.verdict || '';
            var verdictClass = 'verdict-pending';
            var verdictLabel = '待定';
            if (verdict === '通过') { verdictClass = 'verdict-pass'; verdictLabel = '通过'; }
            else if (verdict === '不通过') { verdictClass = 'verdict-fail'; verdictLabel = '不通过'; }
            else { verdictLabel = verdict || '待定'; }
            badgeEl.className = 'verdict-badge ' + verdictClass;
            badgeEl.textContent = verdictLabel;

            // Score
            scoreEl.textContent = report.score ? '[' + report.score + ']' : '';

            // One-liner
            onelinerEl.textContent = report.one_liner || '';

            // Pre-render phases card
            renderPhasesCard(report.phases || []);
        }

        function showError(msg) {
            hideAll();
            errorEl.style.display = '';
            errorTextEl.textContent = msg || '分析失败';
        }

        function setAutoAnalyze(on) {
            chkAuto.classList.toggle('active', on);
        }

        function getAutoAnalyze() {
            return chkAuto.classList.contains('active');
        }

        function resetBanner() {
            hideAll();
            idleEl.style.display = '';
            btnAnalyze.disabled = true;
            btnAnalyze.textContent = '数据加载中...';
            currentReport = null;
        }

        function renderPhasesCard(phases) {
            phasesEl.innerHTML = '';
            if (!phases || phases.length === 0) return;
            for (var i = 0; i < phases.length; i++) {
                var p = phases[i];
                var item = document.createElement('div');
                item.className = 'verdict-phase-item';
                var timeStr = formatTime(p.start_sec * 1000) + ' - ' + formatTime(p.end_sec * 1000);
                item.innerHTML = '<span class="verdict-phase-name">' + TPP.escapeHtml(p.name) + '</span>'
                    + '<span class="verdict-phase-time">' + timeStr + '</span>'
                    + (p.summary ? '<span class="verdict-phase-summary">' + TPP.escapeHtml(p.summary) + '</span>' : '');
                (function(phase) {
                    item.addEventListener('click', function() {
                        player.seek(phase.start_sec * 1000);
                        updateProgressBar(phase.start_sec * 1000, player.totalMs);
                    });
                })(p);
                phasesEl.appendChild(item);
            }
        }

        // --- Wire click events ---
        btnAnalyze.addEventListener('click', function() { startAnalysis(); });
        btnCancel.addEventListener('click', function() { cancelAnalysis(); });
        btnRetry.addEventListener('click', function() { startAnalysis(); });

        btnExpand.addEventListener('click', function() {
            phasesExpanded = !phasesExpanded;
            phasesEl.style.display = phasesExpanded ? '' : 'none';
            btnExpand.innerHTML = phasesExpanded ? '&#9650;' : '&#9660;';
        });

        // Auto-analyze toggle
        document.getElementById('ai-auto-group').addEventListener('click', function() {
            var isOn = !chkAuto.classList.contains('active');
            chkAuto.classList.toggle('active', isOn);
            aiSettings.update({ autoAnalyze: isOn });
        });

        // --- Settings modal ---
        function openSettings() {
            aiSettings.load().then(function(s) {
                var radios = settingsModal.querySelectorAll('input[name="ai-protocol"]');
                for (var i = 0; i < radios.length; i++) {
                    radios[i].checked = radios[i].value === s.protocol;
                }
                document.getElementById('ai-set-endpoint').value = s.endpoint || '';
                document.getElementById('ai-set-apikey').value = s.apiKey || '';
                document.getElementById('ai-set-model').value = s.model || '';
                document.getElementById('ai-set-timeout').value = s.apiTimeoutSec || 60;
                settingsModal.style.display = '';
            });
        }

        function closeSettings() { settingsModal.style.display = 'none'; }

        function getFormSettings() {
            var radios = settingsModal.querySelectorAll('input[name="ai-protocol"]');
            var protocol = 'claude';
            for (var i = 0; i < radios.length; i++) {
                if (radios[i].checked) { protocol = radios[i].value; break; }
            }
            return {
                protocol: protocol,
                endpoint: document.getElementById('ai-set-endpoint').value.trim(),
                apiKey: document.getElementById('ai-set-apikey').value.trim(),
                model: document.getElementById('ai-set-model').value.trim(),
                apiTimeoutSec: parseInt(document.getElementById('ai-set-timeout').value, 10) || 60
            };
        }

        if (btnSettings) btnSettings.addEventListener('click', openSettings);
        if (btnSettingsResult) btnSettingsResult.addEventListener('click', openSettings);
        if (btnSettingsError) btnSettingsError.addEventListener('click', openSettings);

        btnSaveSettings.addEventListener('click', function() {
            var formData = getFormSettings();
            aiSettings.save(formData).then(function() {
                showToast('AI 配置已保存', 'info');
                closeSettings();
            }).catch(function(err) {
                showToast('保存失败: ' + err.message, 'error');
            });
        });

        btnCancelSettings.addEventListener('click', closeSettings);

        // Close modal on backdrop click
        settingsModal.addEventListener('click', function(e) {
            if (e.target === settingsModal) closeSettings();
        });

        // Toggle API key visibility
        if (btnToggleKey) {
            btnToggleKey.addEventListener('click', function() {
                var input = document.getElementById('ai-set-apikey');
                input.type = input.type === 'password' ? 'text' : 'password';
            });
        }

        // Import from file
        if (btnImport) {
            btnImport.addEventListener('click', function() { importFile.click(); });
            importFile.addEventListener('change', function() {
                if (!importFile.files.length) return;
                var reader = new FileReader();
                reader.onload = function() {
                    try {
                        var imported = aiSettings.importFromJSON(reader.result);
                        if (imported.endpoint) document.getElementById('ai-set-endpoint').value = imported.endpoint;
                        if (imported.apiKey) document.getElementById('ai-set-apikey').value = imported.apiKey;
                        if (imported.model) document.getElementById('ai-set-model').value = imported.model;
                        if (imported.protocol) {
                            var radios = settingsModal.querySelectorAll('input[name="ai-protocol"]');
                            for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === imported.protocol;
                        }
                        showToast('配置已导入，请确认后保存', 'info');
                    } catch (err) {
                        showToast('导入失败: ' + err.message, 'error');
                    }
                };
                reader.readAsText(importFile.files[0]);
                importFile.value = '';
            });
        }

        // Test connection
        if (btnTest) {
            btnTest.addEventListener('click', function() {
                btnTest.disabled = true;
                btnTest.textContent = '测试中...';
                var formData = getFormSettings();
                aiSettings.testConnection(formData).then(function(result) {
                    showToast('连接成功! 模型: ' + result.model, 'info');
                }).catch(function(err) {
                    showToast('连接失败: ' + err.message, 'error');
                }).then(function() {
                    btnTest.disabled = false;
                    btnTest.textContent = '测试连接';
                });
            });
        }

        // Load saved auto-analyze state
        aiSettings.load().then(function(s) {
            setAutoAnalyze(s.autoAnalyze);
        });

        verdictBanner = {
            showIdle: showIdle,
            showProgress: showProgress,
            showResult: showResult,
            showError: showError,
            setAutoAnalyze: setAutoAnalyze,
            getAutoAnalyze: getAutoAnalyze,
            resetBanner: resetBanner
        };
    }

    // --- Report Generator ---
    function initReportGenerator() {
        if (!TPP.createReportGenerator) return;
        reportGenerator = TPP.createReportGenerator({
            reportCache: reportCache,
            aiAnalyzer: null, // set later when aiAnalyzer is created
            notes: notes,
            rid: rid,
            showToast: showToast
        });

        var btnReport = document.getElementById('btn-export-report');
        var btnReportIdle = document.getElementById('btn-export-report-idle');

        function onReportClick(e) {
            if (reportGenerator) {
                reportGenerator.generateReport(e.shiftKey);
            }
        }

        if (btnReport) {
            btnReport.addEventListener('click', onReportClick);
        }
        if (btnReportIdle) {
            btnReportIdle.addEventListener('click', onReportClick);
        }
    }

    function enableReportButtons() {
        var btns = [document.getElementById('btn-export-report'), document.getElementById('btn-export-report-idle')];
        for (var i = 0; i < btns.length; i++) {
            if (btns[i]) {
                btns[i].disabled = false;
                btns[i].title = '\u5bfc\u51fa\u62a5\u544a';
            }
        }
    }

    // --- Info panel ---
    function updateInfoPanel(header) {
        if (header) window.__TP_HEADER = header;
        if (!infoList) return;
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
                    if (!verdictBanner) return;
                    var text = '分析中...';
                    if (stage === 'l1_capture') text = '正在采帧 (' + current + '/' + total + ')';
                    else if (stage === 'l1_analyze') text = '正在分析截图...';
                    else if (stage === 'saving') text = '正在保存报告...';
                    else if (stage === 'loading') text = '正在加载配置...';
                    verdictBanner.showProgress(text);
                }
            });

            // Wire aiAnalyzer to reportGenerator for frame capture
            if (reportGenerator) {
                reportGenerator.aiAnalyzer = aiAnalyzer;
            }

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
                    var heatmapBar = document.getElementById('heatmap-bar');
                    if (markerTrack && TPP.createTimelineMarkers) {
                        timelineMarkers = TPP.createTimelineMarkers({
                            allPackets: allPackets,
                            totalMs: header.timeMs,
                            progressContainer: document.getElementById('progress-container'),
                            progressBar: progressBar,
                            markerTrack: markerTrack,
                            heatmapBar: heatmapBar,
                            onSeek: function(timeMs) {
                                player.seek(timeMs);
                                updateProgressBar(timeMs, header.timeMs);
                            }
                        });
                        timelineMarkers.updateHeatmap();

                        // Thumbnail capture: hook into player's onProgress callback
                        // Thumbnails are captured from the RENDERED canvas during playback,
                        // not from raw packet data (RDP frames are delta-encoded, can't random seek)
                        var totalSec = header.timeMs / 1000;
                        if (totalSec >= 60) {
                            var thumbInterval = Math.max(10, totalSec / 100);
                            var thumbs = [];
                            var nextThumbSec = 0;
                            var offCanvas = document.createElement('canvas');
                            offCanvas.width = 160;
                            offCanvas.height = 90;
                            var offCtx = offCanvas.getContext('2d');
                            var thumbCapture = function(curMs) {
                                var curSec = curMs / 1000;
                                if (curSec >= nextThumbSec && thumbs.length < 100) {
                                    if (!performance.memory || performance.memory.usedJSHeapSize < 500 * 1024 * 1024) {
                                        try {
                                            offCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 160, 90);
                                            thumbs.push({ time_sec: curSec, dataUrl: offCanvas.toDataURL('image/jpeg', 0.5) });
                                            timelineMarkers.setThumbnails(thumbs);
                                        } catch(e) { /* skip */ }
                                    }
                                    nextThumbSec = curSec + thumbInterval;
                                }
                            };
                            // Store capture function so onProgress can call it
                            window.__TP_THUMB_CAPTURE = thumbCapture;
                        }

                        // If a cached report with markers was already loaded, show them
                        reportCache.get(rid).then(function(entry) {
                            if (entry && entry.report) {
                                var report = entry.report;
                                if (report.markers && report.markers.length > 0 && timelineMarkers) {
                                    timelineMarkers.setMarkers(report.markers);
                                }
                                if (verdictBanner) verdictBanner.showResult(report);
                            }
                        });

                        // Initialize tour mode
                        if (TPP.createTourMode) {
                            tourMode = TPP.createTourMode({
                                player: player,
                                getMarkers: function() { return timelineMarkers ? timelineMarkers.getMarkers() : []; },
                                onSeek: function(timeMs) {
                                    player.seek(timeMs);
                                    updateProgressBar(timeMs, header.timeMs);
                                },
                                onStateChange: function(active, idx, total) {
                                    updateTourUI(active, idx, total);
                                }
                            });
                        }
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
                        if (verdictBanner) {
                            verdictBanner.showIdle(true);
                        }
                        if (reportGenerator) reportGenerator.setReady(true);
                        enableReportButtons();
                    } else if (verdictBanner) {
                        verdictBanner.showIdle(false);
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
                                        if (reportGenerator) reportGenerator.setReady(true);
                                        enableReportButtons();
                                        if (verdictBanner) {
                                            verdictBanner.showIdle(true);
                                            if (verdictBanner.getAutoAnalyze()) {
                                                reportCache.get(rid).then(function(entry) {
                                                    if (!entry || !entry.report) startAnalysis();
                                                });
                                            }
                                        }
                                    } else if (verdictBanner) {
                                        verdictBanner.showIdle(false);
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
            case 'KeyA':
                e.preventDefault(); startAnalysis(); break;
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
    initVerdictBanner();
    initReportGenerator();

    // --- Expose resetPlayer for single-tab reuse ---
    window.__TP_RESET = function(newRid) {
        // 1. Save current notes
        if (noteText && noteText.value) {
            notes.setText(noteText.value);
        }

        // 2. Stop current playback
        if (player) {
            try { player.pause(); } catch (e) {}
        }

        // 3. Show loading overlay over the last frame (semi-transparent)
        var loadingOverlay = document.getElementById('loading-overlay');
        var loadingText = document.getElementById('loading-text');
        var loadingProgress = document.getElementById('loading-progress');
        loadingOverlay.style.display = '';
        loadingOverlay.style.background = 'rgba(28, 28, 30, 0.85)';
        if (loadingText) loadingText.textContent = '正在切换录像...';
        if (loadingProgress) loadingProgress.textContent = '';

        // 4. Hide error overlay if visible
        var errOverlay = document.getElementById('error-overlay');
        if (errOverlay) errOverlay.style.display = 'none';

        // 5. Update global RID
        window.__TP_RID = String(newRid);
        rid = String(newRid);
        document.title = 'RDP 录屏 #' + rid;

        // 6. Reset modules
        imageCache = TPP.createImageCache();
        try { cacheManager = TPP.createCacheManager(rid); } catch (e) { cacheManager = null; }
        downloader = TPP.createDownloader(serverBase, rid, cacheManager);
        notes = TPP.createNotes(rid);
        notes.onReady(initNotes);

        // 7. Reset AI state
        aiAnalyzer = null;
        if (verdictBanner) {
            try { verdictBanner.resetBanner(); } catch (e) {}
        }
        if (timelineMarkers) {
            try { timelineMarkers.destroy(); } catch (e) {}
            timelineMarkers = null;
        }
        if (tourMode) {
            try { tourMode.destroy(); } catch (e) {}
            tourMode = null;
        }
        updateTourUI(false, 0, 0);
        allDataReady = false;
        downloadedFileCount = 0;
        window.__TP_THUMB_CAPTURE = null;

        // 8. Reset player
        player = TPP.createPlayer(renderer, imageCache, {
            onProgress: function (cur, total) {
                updateProgressBar(cur, total);
                if (window.__TP_THUMB_CAPTURE) window.__TP_THUMB_CAPTURE(cur);
            },
            onEnd: function () { btnPlay.textContent = '\u25B6'; },
            onError: function (err) { console.error('Playback error:', err); },
        });

        // 9. Reset zoom to fit
        zoom.resetFit();

        // 10. Restart download
        init();
    };
})();
