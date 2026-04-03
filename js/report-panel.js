// Teleport RDP Web Player — Report Panel (Phase Card Layout)
TPP.createReportPanel = function(opts) {
    var player = opts.player;
    var rid = opts.rid;
    var reportCache = opts.reportCache;
    var onStartAnalysis = opts.onStartAnalysis;
    var onCancelAnalysis = opts.onCancelAnalysis;
    var onRetryPhase = opts.onRetryPhase;

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

    // --- Tab switching ---
    var sidebar = document.getElementById('sidebar');

    for (var i = 0; i < tabs.length; i++) {
        (function(tab) {
            tab.addEventListener('click', function() {
                for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
                for (var k = 0; k < panels.length; k++) panels[k].classList.remove('active');
                tab.classList.add('active');
                var targetId = 'panel-' + tab.getAttribute('data-tab');
                var targetPanel = document.getElementById(targetId);
                if (targetPanel) targetPanel.classList.add('active');

                var isAI = tab.getAttribute('data-tab') === 'ai-report';
                if (sidebar) {
                    sidebar.classList.toggle('wide', isAI);
                    var sw = null;
                    try { sw = JSON.parse(localStorage.getItem('tp_player_prefs') || '{}').sidebarWidth; } catch(e) {}
                    if (isAI && sw) {
                        sidebar.style.width = sw + 'px';
                    } else {
                        sidebar.style.width = '';
                    }
                    setTimeout(function() {
                        if (window.__TP_ZOOM && window.__TP_ZOOM.handleResize) {
                            window.__TP_ZOOM.handleResize();
                        }
                    }, 280);
                }
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
        loading: '\u52a0\u8f7d\u8bbe\u7f6e...',
        l1_capture: 'L1 \u91c7\u5e27\u4e2d',
        l1_analyze: 'L1 \u5206\u6790\u4e2d...',
        l1_done: 'L1 \u5b8c\u6210\uff0c\u5f00\u59cb\u9010\u9636\u6bb5\u5206\u6790...',
        l2_phase: 'L2 \u9636\u6bb5\u5206\u6790\u4e2d',
        l3_check: 'L3 \u6df1\u5ea6\u68c0\u67e5\u4e2d',
        saving: '\u4fdd\u5b58\u62a5\u544a...',
        done: '\u5206\u6790\u5b8c\u6210'
    };

    var STAGE_WEIGHT = {
        loading:     { start: 0,  end: 2  },
        l1_capture:  { start: 2,  end: 12 },
        l1_analyze:  { start: 12, end: 25 },
        l1_done:     { start: 25, end: 25 },
        l2_phase:    { start: 25, end: 85 },
        l3_check:    { start: 85, end: 95 },
        saving:      { start: 95, end: 100 },
        done:        { start: 100, end: 100 }
    };

    function updateProgress(stage, current, total) {
        showProgress();
        var label = STAGE_LABELS[stage] || stage;
        var w = STAGE_WEIGHT[stage] || { start: 0, end: 0 };
        var pct;

        if (total > 0 && current > 0) {
            pct = w.start + (w.end - w.start) * (current / total);
            label += ' (' + current + '/' + total + ')';
        } else {
            pct = w.start;
        }

        pct = Math.round(Math.min(100, Math.max(0, pct)));

        if (progressBar) {
            progressBar.style.width = pct + '%';
            progressBar.classList.remove('indeterminate');
        }
        if (progressText) progressText.textContent = pct + '% \u2014 ' + label;
    }

    // --- Helpers ---
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

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- L1 Skeleton rendering ---

    var currentL1Result = null;

    function renderSkeleton(l1Result) {
        currentL1Result = l1Result;
        showResult();
        var html = '';

        // Overall Assessment header
        html += '<div class="ai-report-header">';
        if (l1Result.topic) {
            html += '<div class="ai-report-exam">';
            html += '<span class="ai-report-exam-topic">' + escapeHtml(l1Result.topic) + '</span>';
            if (l1Result.tech_stack && l1Result.tech_stack.length > 0) {
                html += '<span class="ai-report-exam-role">' + escapeHtml(l1Result.tech_stack.join(', ')) + '</span>';
            }
            html += '</div>';
        }
        html += '<div class="ai-report-score" id="ai-final-score">' + escapeHtml(l1Result.score || '-') + '</div>';
        html += '<div class="ai-report-summary" id="ai-final-summary">' + escapeHtml(l1Result.summary || '') + '</div>';

        // Dimension chips (names only, stars filled later)
        if (l1Result.dimensions && l1Result.dimensions.length > 0) {
            html += '<div class="ai-dimension-chips" id="ai-dimension-chips">';
            for (var d = 0; d < l1Result.dimensions.length; d++) {
                html += '<span class="ai-dim-chip">' + escapeHtml(l1Result.dimensions[d]) + ' <span class="ai-dim-chip-stars">\u00b7\u00b7\u00b7</span></span>';
            }
            html += '</div>';
        }
        html += '</div>';

        // Phase cards (pending state)
        html += '<div id="ai-phase-cards">';
        var phases = l1Result.phases || [];
        for (var i = 0; i < phases.length; i++) {
            var phase = phases[i];
            html += '<div class="ai-phase-card pending" id="ai-phase-' + i + '" data-phase="' + i + '">';
            html += '<div class="ai-phase-header">';
            html += '<span class="ai-phase-icon">\u23f3</span>';
            html += '<span class="ai-phase-name">' + escapeHtml(phase.name) + '</span>';
            html += '<span class="ai-phase-time">'
                + '<a class="ai-time-link" data-time="' + (phase.start_sec * 1000) + '">' + formatTimestamp(phase.start_sec) + '</a>'
                + ' - '
                + '<a class="ai-time-link" data-time="' + (phase.end_sec * 1000) + '">' + formatTimestamp(phase.end_sec) + '</a>'
                + '</span>';
            html += '</div>';
            html += '<div class="ai-phase-summary">' + escapeHtml(phase.summary || '') + '</div>';
            html += '<div class="ai-phase-detail" style="display:none"></div>';
            html += '</div>';
        }
        html += '</div>';

        resultDiv.innerHTML = html;
        bindTimeLinks(resultDiv);
        bindPhaseCardToggles();
    }

    // --- Phase card update (progressive rendering) ---

    function updatePhaseCard(phaseIndex, status, l2Result, errorMsg) {
        var card = document.getElementById('ai-phase-' + phaseIndex);
        if (!card) return;

        // Update status class and icon
        card.className = 'ai-phase-card ' + status;
        var icon = card.querySelector('.ai-phase-icon');
        if (icon) {
            var icons = { pending: '\u23f3', analyzing: '', done: '\u2705', warning: '\u26a0\ufe0f', error: '\u274c' };
            if (status === 'analyzing') {
                icon.innerHTML = '<span class="ai-phase-spinner"></span>';
            } else {
                icon.textContent = icons[status] || '\u23f3';
            }
        }

        if (status === 'error') {
            var detail = card.querySelector('.ai-phase-detail');
            if (detail) {
                detail.style.display = '';
                detail.innerHTML = '<div class="ai-phase-error">'
                    + escapeHtml(errorMsg || '\u5206\u6790\u5931\u8d25')
                    + ' <button class="ai-btn-retry" data-phase="' + phaseIndex + '">\u91cd\u8bd5</button>'
                    + '</div>';
                bindRetryButtons(detail);
            }
            return;
        }

        if (!l2Result || status === 'analyzing') return;

        // Fill in L2 evaluation
        var detail = card.querySelector('.ai-phase-detail');
        if (!detail) return;

        var html = '';

        if (l2Result.evaluation) {
            html += '<div class="ai-phase-eval">' + escapeHtml(l2Result.evaluation) + '</div>';
        }

        if (l2Result.dimensions && l2Result.dimensions.length > 0) {
            html += '<div class="ai-phase-dims">';
            for (var d = 0; d < l2Result.dimensions.length; d++) {
                var dim = l2Result.dimensions[d];
                html += '<div class="ai-phase-dim">';
                html += '<span class="ai-phase-dim-name">' + escapeHtml(dim.name) + '</span>';
                html += '<span class="ai-phase-dim-stars">' + renderStars(dim.stars) + '</span>';
                if (dim.comment) {
                    html += '<span class="ai-phase-dim-comment">' + escapeHtml(dim.comment) + '</span>';
                }
                if (dim.evidence_timestamps && dim.evidence_timestamps.length > 0) {
                    html += '<span class="ai-phase-dim-evidence">';
                    for (var e = 0; e < dim.evidence_timestamps.length; e++) {
                        html += '<a class="ai-time-link" data-time="' + (dim.evidence_timestamps[e] * 1000) + '">'
                            + formatTimestamp(dim.evidence_timestamps[e]) + '</a> ';
                    }
                    html += '</span>';
                }
                html += '</div>';
            }
            html += '</div>';
        }

        if (l2Result.suspicious) {
            html += '<div class="ai-phase-suspicious">';
            html += '\u26a0\ufe0f ' + escapeHtml(l2Result.suspicious.description || '');
            if (l2Result.suspicious.evidence_timestamps) {
                for (var s = 0; s < l2Result.suspicious.evidence_timestamps.length; s++) {
                    html += ' <a class="ai-time-link" data-time="' + (l2Result.suspicious.evidence_timestamps[s] * 1000) + '">'
                        + formatTimestamp(l2Result.suspicious.evidence_timestamps[s]) + '</a>';
                }
            }
            html += '</div>';
        }

        // L3 deep check findings
        if (l2Result.confirmed !== undefined) {
            html += '<div class="ai-phase-deep-check ' + (l2Result.confirmed ? 'confirmed' : 'dismissed') + '">';
            html += '<strong>' + (l2Result.confirmed ? '\u2757 \u786e\u8ba4' : '\u2705 \u6392\u9664') + ':</strong> ';
            html += escapeHtml(l2Result.description || '');
            if (l2Result.evidence) html += '<div class="ai-dc-evidence">' + escapeHtml(l2Result.evidence) + '</div>';
            html += '</div>';
        }

        detail.innerHTML = html;
        bindTimeLinks(detail);
    }

    // --- Final report rendering (from cache or after analysis) ---

    function renderReport(report) {
        showResult();
        var html = '';

        // Overall header
        html += '<div class="ai-report-header">';
        if (report.topic) {
            html += '<div class="ai-report-exam">';
            html += '<span class="ai-report-exam-topic">' + escapeHtml(report.topic) + '</span>';
            if (report.tech_stack && report.tech_stack.length > 0) {
                html += '<span class="ai-report-exam-role">' + escapeHtml(report.tech_stack.join(', ')) + '</span>';
            }
            html += '</div>';
        }
        if (!report.topic && window.__TP_HOST_INFO && window.__TP_HOST_INFO.parsed) {
            var p = window.__TP_HOST_INFO.parsed;
            if (p.topic || p.role) {
                html += '<div class="ai-report-exam">';
                if (p.topic) html += '<span class="ai-report-exam-topic">' + escapeHtml(p.topic) + '</span>';
                if (p.role) html += '<span class="ai-report-exam-role">' + escapeHtml(p.role) + '</span>';
                html += '</div>';
            }
        }
        html += '<div class="ai-report-score">' + escapeHtml(report.score || '-') + '</div>';
        html += '<div class="ai-report-summary">' + escapeHtml(report.summary || '') + '</div>';

        // Dimension summary chips
        if (report.dimensions && report.dimensions.length > 0) {
            html += '<div class="ai-dimension-chips">';
            for (var d = 0; d < report.dimensions.length; d++) {
                var dim = report.dimensions[d];
                html += '<span class="ai-dim-chip">' + escapeHtml(dim.name) + ' <span class="ai-dim-chip-stars">' + renderStars(dim.stars) + '</span></span>';
            }
            html += '</div>';
        }

        // Meta
        if (report._meta) {
            var m = report._meta;
            var dur = m.durationMs ? Math.round(m.durationMs / 1000) + 's' : '-';
            var tokIn = m.tokens ? (m.tokens.input || 0) : 0;
            var tokOut = m.tokens ? (m.tokens.output || 0) : 0;
            html += '<div class="ai-report-meta">';
            html += '<span title="\u6a21\u578b">' + escapeHtml(m.model || '-') + '</span>';
            html += '<span class="meta-sep">\u00b7</span>';
            html += '<span title="\u8017\u65f6">' + dur + '</span>';
            html += '<span class="meta-sep">\u00b7</span>';
            html += '<span title="Token \u6d88\u8017">' + tokIn.toLocaleString() + ' in / ' + tokOut.toLocaleString() + ' out</span>';
            html += '<span class="meta-sep">\u00b7</span>';
            html += '<span title="\u91c7\u5e27\u6570">' + (m.frames || '-') + ' \u5e27</span>';
            html += '</div>';
        }
        html += '</div>';

        // Phase cards
        html += '<div id="ai-phase-cards">';
        var phases = report.phases || [];
        for (var i = 0; i < phases.length; i++) {
            var phase = phases[i];
            var statusClass = phase.status || 'done';
            var icons = { done: '\u2705', warning: '\u26a0\ufe0f', error: '\u274c' };
            html += '<div class="ai-phase-card ' + statusClass + '" id="ai-phase-' + i + '" data-phase="' + i + '">';
            html += '<div class="ai-phase-header">';
            html += '<span class="ai-phase-icon">' + (icons[statusClass] || '\u2705') + '</span>';
            html += '<span class="ai-phase-name">' + escapeHtml(phase.name) + '</span>';
            html += '<span class="ai-phase-time">'
                + '<a class="ai-time-link" data-time="' + (phase.start_sec * 1000) + '">' + formatTimestamp(phase.start_sec) + '</a>'
                + ' - '
                + '<a class="ai-time-link" data-time="' + (phase.end_sec * 1000) + '">' + formatTimestamp(phase.end_sec) + '</a>'
                + '</span>';
            html += '</div>';
            html += '<div class="ai-phase-summary">' + escapeHtml(phase.summary || '') + '</div>';

            // Detail (collapsible, hidden by default)
            html += '<div class="ai-phase-detail" style="display:none">';
            if (phase.evaluation) {
                html += '<div class="ai-phase-eval">' + escapeHtml(phase.evaluation) + '</div>';
            }
            if (phase.dimensions && phase.dimensions.length > 0) {
                html += '<div class="ai-phase-dims">';
                for (var pd = 0; pd < phase.dimensions.length; pd++) {
                    var pdim = phase.dimensions[pd];
                    html += '<div class="ai-phase-dim">';
                    html += '<span class="ai-phase-dim-name">' + escapeHtml(pdim.name) + '</span>';
                    html += '<span class="ai-phase-dim-stars">' + renderStars(pdim.stars) + '</span>';
                    if (pdim.comment) html += '<span class="ai-phase-dim-comment">' + escapeHtml(pdim.comment) + '</span>';
                    if (pdim.evidence_timestamps && pdim.evidence_timestamps.length > 0) {
                        html += '<span class="ai-phase-dim-evidence">';
                        for (var pe = 0; pe < pdim.evidence_timestamps.length; pe++) {
                            html += '<a class="ai-time-link" data-time="' + (pdim.evidence_timestamps[pe] * 1000) + '">'
                                + formatTimestamp(pdim.evidence_timestamps[pe]) + '</a> ';
                        }
                        html += '</span>';
                    }
                    html += '</div>';
                }
                html += '</div>';
            }
            if (phase.suspicious) {
                html += '<div class="ai-phase-suspicious">\u26a0\ufe0f ' + escapeHtml(phase.suspicious.description || '') + '</div>';
            }
            if (phase.deep_check) {
                var dc = phase.deep_check;
                html += '<div class="ai-phase-deep-check ' + (dc.confirmed ? 'confirmed' : 'dismissed') + '">';
                html += '<strong>' + (dc.confirmed ? '\u2757 \u786e\u8ba4' : '\u2705 \u6392\u9664') + ':</strong> ';
                html += escapeHtml(dc.description || '');
                if (dc.evidence) html += '<div class="ai-dc-evidence">' + escapeHtml(dc.evidence) + '</div>';
                html += '</div>';
            }
            if (phase.error) {
                html += '<div class="ai-phase-error">' + escapeHtml(phase.error) + '</div>';
            }
            html += '</div>'; // close detail
            html += '</div>'; // close phase card
        }
        html += '</div>';

        // Conclusion
        var recMap = { '\u901a\u8fc7': 'pass', '\u5f85\u5b9a': 'pending', '\u4e0d\u901a\u8fc7': 'fail' };
        var recClass = recMap[report.recommendation] || 'unknown';
        html += '<div class="ai-report-section">';
        html += '<div class="ai-recommendation ai-rec-' + recClass + '">';
        html += '\u5efa\u8bae: ' + escapeHtml(report.recommendation || '-') + '</div>';
        html += '</div>';

        // Actions
        html += '<div class="ai-report-actions">';
        html += '<button id="btn-ai-copy" class="ai-btn-secondary">\ud83d\udccb \u590d\u5236\u62a5\u544a</button>';
        html += '<button id="btn-ai-export" class="ai-btn-secondary">\u5bfc\u51fa JSON</button>';
        html += '<button id="btn-ai-rerun" class="ai-btn-secondary">\u91cd\u65b0\u5206\u6790</button>';
        html += '</div>';

        resultDiv.innerHTML = html;
        bindTimeLinks(resultDiv);
        bindPhaseCardToggles();
        bindActionButtons(report);
    }

    // --- Event binding helpers ---

    function bindTimeLinks(container) {
        var timeLinks = container.querySelectorAll('.ai-time-link');
        for (var l = 0; l < timeLinks.length; l++) {
            (function(link) {
                link.addEventListener('click', function(ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    var timeMs = parseInt(link.getAttribute('data-time'), 10);
                    var wasPlaying = player.playing;
                    player.seek(timeMs);
                    if (wasPlaying) player.play();
                });
            })(timeLinks[l]);
        }
    }

    function bindPhaseCardToggles() {
        var cards = document.querySelectorAll('.ai-phase-card');
        for (var c = 0; c < cards.length; c++) {
            (function(card) {
                var header = card.querySelector('.ai-phase-header');
                if (!header) return;
                header.style.cursor = 'pointer';
                header.addEventListener('click', function() {
                    var detail = card.querySelector('.ai-phase-detail');
                    if (!detail) return;
                    var isOpen = detail.style.display !== 'none';
                    detail.style.display = isOpen ? 'none' : '';
                    card.classList.toggle('expanded', !isOpen);
                });
            })(cards[c]);
        }
    }

    function bindRetryButtons(container) {
        var btns = container.querySelectorAll('.ai-btn-retry');
        for (var b = 0; b < btns.length; b++) {
            (function(btn) {
                btn.addEventListener('click', function(ev) {
                    ev.stopPropagation();
                    var idx = parseInt(btn.getAttribute('data-phase'), 10);
                    if (onRetryPhase) onRetryPhase(idx);
                });
            })(btns[b]);
        }
    }

    function bindActionButtons(report) {
        var btnCopy = document.getElementById('btn-ai-copy');
        if (btnCopy) {
            btnCopy.addEventListener('click', function() {
                var markdown = reportToMarkdown(report);
                copyToClipboard(markdown).then(function() {
                    showToastInPanel('\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f');
                }).catch(function(err) {
                    showToastInPanel('\u590d\u5236\u5931\u8d25: ' + err.message);
                });
            });
        }

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

        var btnRerun = document.getElementById('btn-ai-rerun');
        if (btnRerun) {
            btnRerun.addEventListener('click', function() {
                if (onStartAnalysis) onStartAnalysis();
            });
        }
    }

    // --- Markdown export ---

    function reportToMarkdown(report) {
        var md = '# AI \u8bc4\u4f30\u62a5\u544a\n\n';
        if (report.topic) md += '**\u9898\u76ee:** ' + report.topic + '\n';
        if (report.tech_stack && report.tech_stack.length > 0) md += '**\u6280\u672f\u6808:** ' + report.tech_stack.join(', ') + '\n';
        md += '**\u7efc\u5408\u8bc4\u5206:** ' + (report.score || '-') + '\n';
        md += '**\u603b\u7ed3:** ' + (report.summary || '') + '\n';
        if (report._meta) {
            var m = report._meta;
            md += '**\u6a21\u578b:** ' + (m.model || '-');
            md += ' | **\u8017\u65f6:** ' + (m.durationMs ? Math.round(m.durationMs / 1000) + 's' : '-');
            md += ' | **Token:** ' + ((m.tokens ? m.tokens.input : 0) || 0) + ' in / ' + ((m.tokens ? m.tokens.output : 0) || 0) + ' out';
            md += ' | **\u91c7\u5e27:** ' + (m.frames || '-') + '\n';
        }
        md += '\n';

        // Dimensions
        if (report.dimensions && report.dimensions.length > 0) {
            md += '## \u8bc4\u4f30\u7ef4\u5ea6\n';
            for (var d = 0; d < report.dimensions.length; d++) {
                var dim = report.dimensions[d];
                md += '- **' + dim.name + '** ' + renderStars(dim.stars) + ' \u2014 ' + (dim.comment || '') + '\n';
            }
            md += '\n';
        }

        // Phases
        var phases = report.phases || [];
        for (var i = 0; i < phases.length; i++) {
            var phase = phases[i];
            var statusIcon = { done: '\u2705', warning: '\u26a0\ufe0f', error: '\u274c' };
            md += '## ' + (statusIcon[phase.status] || '\u2705') + ' ' + phase.name
                + ' (' + formatTimestamp(phase.start_sec) + '-' + formatTimestamp(phase.end_sec) + ')\n';
            if (phase.evaluation) md += phase.evaluation + '\n';
            if (phase.suspicious) md += '\n\u26a0\ufe0f **\u53ef\u7591\u884c\u4e3a:** ' + phase.suspicious.description + '\n';
            if (phase.deep_check) {
                md += '\n**\u6df1\u5ea6\u68c0\u67e5:** ' + (phase.deep_check.confirmed ? '\u2757\u786e\u8ba4' : '\u2705\u6392\u9664') + ' \u2014 ' + (phase.deep_check.description || '') + '\n';
            }
            md += '\n';
        }

        md += '## \u7ed3\u8bba\n';
        md += '**\u5efa\u8bae:** ' + (report.recommendation || '-') + '\n';
        return md;
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(function() {
                return execCommandCopy(text);
            });
        }
        return execCommandCopy(text);
    }

    function execCommandCopy(text) {
        return new Promise(function(resolve, reject) {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                var ok = document.execCommand('copy');
                document.body.removeChild(textarea);
                if (ok) resolve(); else reject(new Error('\u526a\u8d34\u677f\u4e0d\u53ef\u7528'));
            } catch (e) {
                document.body.removeChild(textarea);
                reject(e);
            }
        });
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
            document.getElementById('ai-set-timeout').value = s.apiTimeoutSec;
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
                apiTimeoutSec: parseInt(document.getElementById('ai-set-timeout').value, 10) || 60
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
        renderSkeleton: renderSkeleton,
        updatePhaseCard: updatePhaseCard,
        renderReport: renderReport,
        setDataReady: setDataReady,
        setAutoAnalyze: setAutoAnalyze,
        getAutoAnalyze: getAutoAnalyze,
        loadCachedReport: loadCachedReport
    };
};
