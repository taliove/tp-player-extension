// Teleport RDP Web Player — Report Panel
TPP.createReportPanel = function(opts) {
    var player = opts.player;
    var rid = opts.rid;
    var reportCache = opts.reportCache;
    var onStartAnalysis = opts.onStartAnalysis;
    var onCancelAnalysis = opts.onCancelAnalysis;

    // --- DOM refs ---
    var tabs = document.querySelectorAll('.sidebar-tab');
    var panels = document.querySelectorAll('.sidebar-panel');
    var idleDiv = document.getElementById('ai-report-idle');
    var progressDiv = document.getElementById('ai-report-progress');
    var resultDiv = document.getElementById('ai-report-result');
    var settingsPanel = document.getElementById('ai-settings-panel');
    var btnAnalyze = document.getElementById('btn-ai-analyze');
    var btnCancel = document.getElementById('btn-ai-cancel');
    var progressBar = document.getElementById('ai-progress-bar');
    var progressText = document.getElementById('ai-progress-text');
    var chkAuto = document.getElementById('chk-ai-auto');
    var frameEstimate = document.getElementById('ai-frame-estimate');

    // --- Tab switching ---
    for (var i = 0; i < tabs.length; i++) {
        (function(tab) {
            tab.addEventListener('click', function() {
                for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
                for (var k = 0; k < panels.length; k++) panels[k].classList.remove('active');
                tab.classList.add('active');
                var targetId = 'panel-' + tab.getAttribute('data-tab');
                var targetPanel = document.getElementById(targetId);
                if (targetPanel) targetPanel.classList.add('active');
            });
        })(tabs[i]);
    }

    // --- Analyze button ---
    if (btnAnalyze) {
        btnAnalyze.addEventListener('click', function() {
            if (btnAnalyze.disabled) return;
            if (onStartAnalysis) onStartAnalysis();
        });
    }

    if (btnCancel) {
        btnCancel.addEventListener('click', function() {
            if (onCancelAnalysis) onCancelAnalysis();
        });
    }

    // --- State control ---
    function showIdle() {
        if (idleDiv) idleDiv.style.display = '';
        if (progressDiv) progressDiv.style.display = 'none';
        if (resultDiv) resultDiv.style.display = 'none';
        if (settingsPanel) settingsPanel.style.display = 'none';
    }

    function showProgress() {
        if (idleDiv) idleDiv.style.display = 'none';
        if (progressDiv) progressDiv.style.display = '';
        if (resultDiv) resultDiv.style.display = 'none';
        if (settingsPanel) settingsPanel.style.display = 'none';
    }

    function showResult() {
        if (idleDiv) idleDiv.style.display = 'none';
        if (progressDiv) progressDiv.style.display = 'none';
        if (resultDiv) resultDiv.style.display = '';
        if (settingsPanel) settingsPanel.style.display = 'none';
    }

    var STAGE_LABELS = {
        loading: '加载设置...',
        scanning: '扫描录像数据...',
        capturing: '采帧中',
        round1: '第一轮 AI 分析中...',
        layer2: '补帧中...',
        round2: '第二轮 AI 分析中...',
        saving: '保存报告...',
        done: '分析完成'
    };

    function updateProgress(stage, current, total) {
        showProgress();
        var label = STAGE_LABELS[stage] || stage;
        if (total > 0) {
            label += ' (' + current + '/' + total + ')';
            if (progressBar) {
                progressBar.style.width = Math.round(current / total * 100) + '%';
                progressBar.classList.remove('indeterminate');
            }
        } else {
            if (progressBar) {
                progressBar.style.width = '';
                progressBar.classList.add('indeterminate');
            }
        }
        if (progressText) progressText.textContent = label;
    }

    // --- Report rendering ---
    function formatTimestamp(sec) {
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function renderStars(count) {
        var full = Math.min(count, 5);
        var html = '';
        for (var i = 0; i < 5; i++) {
            html += i < full ? '\u2605' : '\u2606';
        }
        return html;
    }

    function renderReport(report) {
        showResult();
        var html = '';

        // Score header
        html += '<div class="ai-report-header">';
        html += '<div class="ai-report-score">' + escapeHtml(report.score || '-') + '</div>';
        html += '<div class="ai-report-summary">' + escapeHtml(report.summary || '') + '</div>';
        html += '</div>';

        // Test result
        if (report.test_result) {
            var tr = report.test_result;
            var confClass = tr.confidence === 'low' ? ' ai-low-confidence' : '';
            html += '<div class="ai-report-section">';
            html += '<div class="ai-report-section-title">\u6d4b\u8bd5\u7ed3\u679c</div>';
            html += '<div class="ai-test-result' + confClass + '">';
            html += tr.passed + '/' + tr.total + ' \u901a\u8fc7';
            if (tr.total > 0) html += ' (' + Math.round(tr.passed / tr.total * 100) + '%)';
            if (tr.timestamp_sec > 0) {
                html += ' <a class="ai-time-link" data-time="' + (tr.timestamp_sec * 1000) + '">'
                    + formatTimestamp(tr.timestamp_sec) + '</a>';
            }
            html += '</div></div>';
        }

        // Timeline
        if (report.timeline && report.timeline.length > 0) {
            html += '<div class="ai-report-section">';
            html += '<div class="ai-report-section-title">\u65f6\u95f4\u7ebf</div>';
            for (var t = 0; t < report.timeline.length; t++) {
                var item = report.timeline[t];
                html += '<div class="ai-timeline-item">';
                html += '<a class="ai-time-link" data-time="' + (item.timestamp_sec * 1000) + '">'
                    + formatTimestamp(item.timestamp_sec) + '</a>';
                html += '<span class="ai-timeline-activity"> ' + escapeHtml(item.activity) + '</span>';
                if (item.detail) {
                    html += '<div class="ai-timeline-detail">' + escapeHtml(item.detail) + '</div>';
                }
                html += '</div>';
            }
            html += '</div>';
        }

        // Dimensions
        if (report.dimensions && report.dimensions.length > 0) {
            html += '<div class="ai-report-section">';
            html += '<div class="ai-report-section-title">\u8be6\u7ec6\u8bc4\u4f30</div>';
            for (var d = 0; d < report.dimensions.length; d++) {
                var dim = report.dimensions[d];
                html += '<div class="ai-dimension">';
                html += '<div class="ai-dimension-header">';
                html += '<span class="ai-dimension-name">' + escapeHtml(dim.name) + '</span>';
                html += '<span class="ai-dimension-stars">' + renderStars(dim.stars) + '</span>';
                html += '</div>';
                html += '<div class="ai-dimension-comment">' + escapeHtml(dim.comment) + '</div>';
                if (dim.evidence_timestamps && dim.evidence_timestamps.length > 0) {
                    html += '<div class="ai-dimension-evidence">';
                    for (var e = 0; e < dim.evidence_timestamps.length; e++) {
                        html += '<a class="ai-time-link" data-time="' + (dim.evidence_timestamps[e] * 1000) + '">'
                            + formatTimestamp(dim.evidence_timestamps[e]) + '</a> ';
                    }
                    html += '</div>';
                }
                html += '</div>';
            }
            html += '</div>';
        }

        // Conclusion
        html += '<div class="ai-report-section">';
        html += '<div class="ai-report-section-title">\u7ed3\u8bba</div>';
        var recMap = { '\u901a\u8fc7': 'pass', '\u5f85\u5b9a': 'pending', '\u4e0d\u901a\u8fc7': 'fail' };
        var recClass = recMap[report.recommendation] || 'unknown';
        html += '<div class="ai-recommendation ai-rec-' + recClass + '">';
        html += '\u5efa\u8bae: ' + escapeHtml(report.recommendation || '-') + '</div>';
        html += '<div class="ai-conclusion">' + escapeHtml(report.conclusion || '') + '</div>';
        html += '</div>';

        // Actions
        html += '<div class="ai-report-actions">';
        html += '<button id="btn-ai-copy" class="ai-btn-secondary">\ud83d\udccb \u590d\u5236\u62a5\u544a</button>';
        html += '<button id="btn-ai-export" class="ai-btn-secondary">\u5bfc\u51fa JSON</button>';
        html += '<button id="btn-ai-rerun" class="ai-btn-secondary">\u91cd\u65b0\u5206\u6790</button>';
        html += '</div>';

        resultDiv.innerHTML = html;

        // Bind time link clicks
        var timeLinks = resultDiv.querySelectorAll('.ai-time-link');
        for (var l = 0; l < timeLinks.length; l++) {
            (function(link) {
                link.addEventListener('click', function(ev) {
                    ev.preventDefault();
                    var timeMs = parseInt(link.getAttribute('data-time'), 10);
                    var wasPlaying = player.playing;
                    player.seek(timeMs);
                    if (wasPlaying) player.play();
                });
            })(timeLinks[l]);
        }

        // Copy report
        var btnCopy = document.getElementById('btn-ai-copy');
        if (btnCopy) {
            btnCopy.addEventListener('click', function() {
                var markdown = reportToMarkdown(report);
                navigator.clipboard.writeText(markdown).then(function() {
                    showToastInPanel('\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f');
                });
            });
        }

        // Export JSON
        var btnExport = document.getElementById('btn-ai-export');
        if (btnExport) {
            btnExport.addEventListener('click', function() {
                var jsonStr = JSON.stringify(report, null, 2);
                var blob = new Blob([jsonStr], { type: 'application/json' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'ai-report-' + rid + '.json';
                a.click();
                URL.revokeObjectURL(url);
            });
        }

        // Rerun
        var btnRerun = document.getElementById('btn-ai-rerun');
        if (btnRerun) {
            btnRerun.addEventListener('click', function() {
                if (onStartAnalysis) onStartAnalysis();
            });
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function reportToMarkdown(report) {
        var md = '# AI \u8bc4\u4f30\u62a5\u544a\n\n';
        md += '**\u7efc\u5408\u8bc4\u5206:** ' + (report.score || '-') + '\n';
        md += '**\u603b\u7ed3:** ' + (report.summary || '') + '\n\n';

        if (report.test_result) {
            md += '## \u6d4b\u8bd5\u7ed3\u679c\n';
            md += report.test_result.passed + '/' + report.test_result.total + ' \u901a\u8fc7\n\n';
        }

        if (report.timeline && report.timeline.length > 0) {
            md += '## \u65f6\u95f4\u7ebf\n';
            for (var t = 0; t < report.timeline.length; t++) {
                var item = report.timeline[t];
                md += '- ' + formatTimestamp(item.timestamp_sec) + ' ' + item.activity;
                if (item.detail) md += ' \u2014 ' + item.detail;
                md += '\n';
            }
            md += '\n';
        }

        if (report.dimensions && report.dimensions.length > 0) {
            md += '## \u8be6\u7ec6\u8bc4\u4f30\n';
            for (var d = 0; d < report.dimensions.length; d++) {
                var dim = report.dimensions[d];
                md += '### ' + dim.name + ' ' + renderStars(dim.stars) + '\n';
                md += dim.comment + '\n\n';
            }
        }

        md += '## \u7ed3\u8bba\n';
        md += '**\u5efa\u8bae:** ' + (report.recommendation || '-') + '\n\n';
        md += report.conclusion || '';
        return md;
    }

    function showToastInPanel(msg) {
        var toast = document.createElement('div');
        toast.className = 'ai-panel-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(function() { toast.remove(); }, 2000);
    }

    // --- Data readiness ---
    function setDataReady(ready, downloadStatus) {
        if (!btnAnalyze) return;
        if (ready) {
            btnAnalyze.disabled = false;
            btnAnalyze.textContent = '\u5f00\u59cb\u5206\u6790';
        } else {
            btnAnalyze.disabled = true;
            btnAnalyze.textContent = downloadStatus || '\u6570\u636e\u52a0\u8f7d\u4e2d...';
        }
    }

    function setFrameEstimate(count) {
        if (frameEstimate) {
            frameEstimate.textContent = '\u9884\u4f30\u91c7\u5e27: ~' + count + ' \u5e27';
        }
    }

    function setAutoAnalyze(checked) {
        if (chkAuto) chkAuto.classList.toggle('active', checked);
    }

    function getAutoAnalyze() {
        return chkAuto ? chkAuto.classList.contains('active') : false;
    }

    var aiAutoGroup = document.getElementById('ai-auto-group');
    if (aiAutoGroup && chkAuto) {
        aiAutoGroup.addEventListener('click', function() {
            chkAuto.classList.toggle('active');
            if (opts.onAutoChanged) opts.onAutoChanged(chkAuto.classList.contains('active'));
        });
    }

    function loadCachedReport() {
        return reportCache.get(rid).then(function(entry) {
            if (entry && entry.report) {
                renderReport(entry.report);
                return true;
            }
            return false;
        });
    }

    // --- Settings panel ---
    var btnSettings = document.getElementById('btn-ai-settings');
    var btnSaveSettings = document.getElementById('btn-ai-save-settings');
    var btnCancelSettings = document.getElementById('btn-ai-cancel-settings');
    var btnTest = document.getElementById('btn-ai-test');
    var btnImport = document.getElementById('btn-ai-import');
    var importFile = document.getElementById('ai-import-file');
    var btnToggleKey = document.getElementById('btn-ai-toggle-key');

    function showSettings() {
        if (idleDiv) idleDiv.style.display = 'none';
        if (progressDiv) progressDiv.style.display = 'none';
        if (resultDiv) resultDiv.style.display = 'none';
        if (settingsPanel) settingsPanel.style.display = '';

        opts.aiSettings.load().then(function(s) {
            var radios = document.querySelectorAll('input[name="ai-protocol"]');
            for (var i = 0; i < radios.length; i++) {
                radios[i].checked = radios[i].value === s.protocol;
            }
            document.getElementById('ai-set-endpoint').value = s.endpoint;
            document.getElementById('ai-set-apikey').value = s.apiKey;
            document.getElementById('ai-set-model').value = s.model;
            document.getElementById('ai-set-end-minutes').value = s.endSegmentMinutes;
            document.getElementById('ai-set-max-frames').value = s.maxFrames;
            document.getElementById('ai-set-timeout').value = s.apiTimeoutSec;

            return opts.templates.getAll().then(function(all) {
                var select = document.getElementById('ai-set-template');
                select.innerHTML = '';
                var keys = Object.keys(all);
                for (var k = 0; k < keys.length; k++) {
                    var option = document.createElement('option');
                    option.value = keys[k];
                    option.textContent = all[keys[k]].name;
                    if (keys[k] === s.currentTemplate) option.selected = true;
                    select.appendChild(option);
                }
            });
        });
    }

    function hideSettings() {
        if (settingsPanel) settingsPanel.style.display = 'none';
        showIdle();
    }

    if (btnSettings) btnSettings.addEventListener('click', showSettings);
    if (btnCancelSettings) btnCancelSettings.addEventListener('click', hideSettings);

    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', function() {
            var protocol = 'claude';
            var radios = document.querySelectorAll('input[name="ai-protocol"]');
            for (var i = 0; i < radios.length; i++) {
                if (radios[i].checked) { protocol = radios[i].value; break; }
            }
            opts.aiSettings.update({
                protocol: protocol,
                endpoint: document.getElementById('ai-set-endpoint').value.trim(),
                apiKey: document.getElementById('ai-set-apikey').value.trim(),
                model: document.getElementById('ai-set-model').value.trim(),
                currentTemplate: document.getElementById('ai-set-template').value,
                endSegmentMinutes: parseInt(document.getElementById('ai-set-end-minutes').value, 10) || 5,
                maxFrames: parseInt(document.getElementById('ai-set-max-frames').value, 10) || 80,
                apiTimeoutSec: parseInt(document.getElementById('ai-set-timeout').value, 10) || 120
            }).then(function() {
                showToastInPanel('\u8bbe\u7f6e\u5df2\u4fdd\u5b58');
                hideSettings();
            });
        });
    }

    if (btnToggleKey) {
        btnToggleKey.addEventListener('click', function() {
            var input = document.getElementById('ai-set-apikey');
            input.type = input.type === 'password' ? 'text' : 'password';
        });
    }

    if (btnTest) {
        btnTest.addEventListener('click', function() {
            var protocol = 'claude';
            var radios = document.querySelectorAll('input[name="ai-protocol"]');
            for (var i = 0; i < radios.length; i++) {
                if (radios[i].checked) { protocol = radios[i].value; break; }
            }
            btnTest.textContent = '\u6d4b\u8bd5\u4e2d...';
            btnTest.disabled = true;
            setTestResult('');
            opts.aiSettings.testConnection({
                protocol: protocol,
                endpoint: document.getElementById('ai-set-endpoint').value.trim(),
                apiKey: document.getElementById('ai-set-apikey').value.trim(),
                model: document.getElementById('ai-set-model').value.trim()
            }).then(function() {
                setTestResult('\u2705 \u8fde\u63a5\u6210\u529f');
            }).catch(function(err) {
                setTestResult('\u274c ' + err.message);
            }).then(function() {
                btnTest.textContent = '\u6d4b\u8bd5\u8fde\u63a5';
                btnTest.disabled = false;
            });
        });
    }

    function setTestResult(msg) {
        var el = document.getElementById('ai-test-result');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ai-test-result';
            if (btnTest && btnTest.parentNode) {
                btnTest.parentNode.appendChild(el);
            }
        }
        el.textContent = msg;
        el.className = 'ai-test-result-msg';
    }

    if (btnImport) {
        btnImport.addEventListener('click', function() { importFile.click(); });
    }

    if (importFile) {
        importFile.addEventListener('change', function(e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function() {
                try {
                    var imported = opts.aiSettings.importFromJSON(reader.result);
                    if (imported.endpoint) document.getElementById('ai-set-endpoint').value = imported.endpoint;
                    if (imported.apiKey) document.getElementById('ai-set-apikey').value = imported.apiKey;
                    if (imported.model) document.getElementById('ai-set-model').value = imported.model;
                    if (imported.protocol) {
                        var radios = document.querySelectorAll('input[name="ai-protocol"]');
                        for (var i = 0; i < radios.length; i++) {
                            radios[i].checked = radios[i].value === imported.protocol;
                        }
                    }
                    showToastInPanel('\u5df2\u5bfc\u5165\u914d\u7f6e');
                } catch (err) {
                    showToastInPanel('\u5bfc\u5165\u5931\u8d25: ' + err.message);
                }
            };
            reader.readAsText(file);
            importFile.value = '';
        });
    }

    return {
        showIdle: showIdle,
        showProgress: showProgress,
        showResult: showResult,
        updateProgress: updateProgress,
        renderReport: renderReport,
        setDataReady: setDataReady,
        setFrameEstimate: setFrameEstimate,
        setAutoAnalyze: setAutoAnalyze,
        getAutoAnalyze: getAutoAnalyze,
        loadCachedReport: loadCachedReport
    };
};
