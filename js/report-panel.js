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

    // Map stages to pipeline steps
    var STAGE_PIPELINE = {
        loading: 'l1', l1_capture: 'l1', l1_analyze: 'l1', l1_done: 'l1',
        l2_phase: 'l2', l3_check: 'l3', saving: 'l3', done: 'l3'
    };
    var PIPELINE_ORDER = ['l1', 'l2', 'l3'];

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

        // Update SVG circular progress
        var circle = document.getElementById('ai-progress-circle');
        var pctEl = document.getElementById('ai-progress-pct');
        if (circle) {
            var circumference = 2 * Math.PI * 34; // r=34
            var offset = circumference * (1 - pct / 100);
            circle.style.strokeDasharray = circumference;
            circle.style.strokeDashoffset = offset;
        }
        if (pctEl) pctEl.textContent = pct + '%';
        if (progressText) progressText.textContent = label;

        // Update pipeline steps
        var activeStep = STAGE_PIPELINE[stage] || 'l1';
        var activeIdx = PIPELINE_ORDER.indexOf(activeStep);
        var steps = document.querySelectorAll('.ai-pipeline-step');
        var connectors = document.querySelectorAll('.ai-pipeline-connector');
        for (var i = 0; i < steps.length; i++) {
            var step = steps[i];
            var stepName = step.getAttribute('data-step');
            var stepIdx = PIPELINE_ORDER.indexOf(stepName);
            step.classList.remove('done', 'active');
            if (stepIdx < activeIdx) step.classList.add('done');
            else if (stepIdx === activeIdx) step.classList.add('active');
        }
        for (var c = 0; c < connectors.length; c++) {
            connectors[c].classList.toggle('done', c < activeIdx);
        }
    }

    // --- Helpers ---
    function formatTimestamp(sec) {
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function renderRatingBar(count) {
        var full = Math.min(Math.max(count || 0, 0), 5);
        var html = '<span class="ai-rating-bar">';
        for (var i = 0; i < 5; i++) {
            html += '<span class="ai-rating-seg' + (i < full ? ' filled' : '') + '"></span>';
        }
        html += '</span>';
        return html;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var GRADE_MAP = { 'A': 95, 'B+': 82, 'B': 72, 'C+': 62, 'C': 52, 'D': 30 };

    function gradeToNum(score) {
        if (score == null) return NaN;
        var s = String(score).trim().toUpperCase();
        if (GRADE_MAP.hasOwnProperty(s)) return GRADE_MAP[s];
        return parseInt(s, 10);
    }

    function scoreColor(score) {
        var n = gradeToNum(score);
        if (isNaN(n)) return 'var(--text-tertiary)';
        if (n >= 70) return 'var(--score-excellent)';
        if (n >= 50) return 'var(--score-good)';
        if (n >= 30) return 'var(--score-medium)';
        return 'var(--score-low)';
    }

    function scorePct(score) {
        var n = gradeToNum(score);
        if (isNaN(n)) return 0;
        return Math.max(0, Math.min(100, n));
    }

    // --- L1 Skeleton rendering ---

    var currentL1Result = null;

    function renderSkeleton(l1Result) {
        currentL1Result = l1Result;
        showResult();
        var html = '';
        var sc = scorePct(l1Result.score);
        var sColor = scoreColor(l1Result.score);

        // Overall Assessment header
        html += '<div class="ai-report-header">';
        html += '<div class="ai-score-ring" style="--score-pct:' + sc + ';--score-color:' + sColor + '">';
        html += '<span class="ai-score-value" id="ai-final-score">' + escapeHtml(l1Result.score || '-') + '</span>';
        html += '</div>';
        html += '<div class="ai-report-header-body">';
        if (l1Result.topic) {
            html += '<div class="ai-report-exam">';
            html += '<span class="ai-report-exam-topic">' + escapeHtml(l1Result.topic) + '</span>';
            if (l1Result.tech_stack && l1Result.tech_stack.length > 0) {
                html += '<span class="ai-report-exam-role">' + escapeHtml(l1Result.tech_stack.join(', ')) + '</span>';
            }
            html += '</div>';
        }
        html += '<div class="ai-report-summary" id="ai-final-summary">' + escapeHtml(l1Result.summary || '') + '</div>';

        // Dimension chips (names only, bars filled later)
        if (l1Result.dimensions && l1Result.dimensions.length > 0) {
            html += '<div class="ai-dimension-list" id="ai-dimension-chips">';
            for (var d = 0; d < l1Result.dimensions.length; d++) {
                html += '<div class="ai-dim-row"><span class="ai-dim-name">' + escapeHtml(l1Result.dimensions[d]) + '</span>'
                    + '<span class="ai-rating-bar"><span class="ai-rating-seg"></span><span class="ai-rating-seg"></span><span class="ai-rating-seg"></span><span class="ai-rating-seg"></span><span class="ai-rating-seg"></span></span>'
                    + '</div>';
            }
            html += '</div>';
        }
        html += '</div>'; // .ai-report-header-body
        html += '</div>'; // .ai-report-header

        // Phase cards (pending state)
        html += '<div id="ai-phase-cards">';
        var phases = l1Result.phases || [];
        for (var i = 0; i < phases.length; i++) {
            var phase = phases[i];
            html += '<div class="ai-phase-card pending" id="ai-phase-' + i + '" data-phase="' + i + '">';
            html += '<div class="ai-phase-header">';
            html += '<span class="ai-status-dot pending"></span>';
            html += '<span class="ai-phase-name">' + escapeHtml(phase.name) + '</span>';
            html += '<span class="ai-phase-time">'
                + '<a class="ai-time-link" data-time="' + (phase.start_sec * 1000) + '">' + formatTimestamp(phase.start_sec) + '</a>'
                + ' - '
                + '<a class="ai-time-link" data-time="' + (phase.end_sec * 1000) + '">' + formatTimestamp(phase.end_sec) + '</a>'
                + '</span>';
            html += '<span class="ai-phase-chevron"></span>';
            html += '</div>';
            html += '<div class="ai-phase-summary">' + escapeHtml(phase.summary || '') + '</div>';
            html += '<div class="ai-phase-detail"></div>';
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

        card.className = 'ai-phase-card ' + status;
        var dot = card.querySelector('.ai-status-dot');
        if (dot) dot.className = 'ai-status-dot ' + status;

        if (status === 'error') {
            var detail = card.querySelector('.ai-phase-detail');
            if (detail) {
                card.classList.add('expanded');
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
                html += renderRatingBar(dim.stars);
                if (dim.comment) html += '<span class="ai-phase-dim-comment">' + escapeHtml(dim.comment) + '</span>';
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
            html += '<span class="ai-alert-icon">\u26a0</span> ' + escapeHtml(l2Result.suspicious.description || '');
            if (l2Result.suspicious.evidence_timestamps) {
                for (var s = 0; s < l2Result.suspicious.evidence_timestamps.length; s++) {
                    html += ' <a class="ai-time-link" data-time="' + (l2Result.suspicious.evidence_timestamps[s] * 1000) + '">'
                        + formatTimestamp(l2Result.suspicious.evidence_timestamps[s]) + '</a>';
                }
            }
            html += '</div>';
        }

        if (l2Result.confirmed !== undefined) {
            html += '<div class="ai-phase-deep-check ' + (l2Result.confirmed ? 'confirmed' : 'dismissed') + '">';
            html += '<span class="ai-dc-label">' + (l2Result.confirmed ? '\u786e\u8ba4' : '\u6392\u9664') + '</span> ';
            html += escapeHtml(l2Result.description || '');
            if (l2Result.evidence) html += '<div class="ai-dc-evidence">' + escapeHtml(l2Result.evidence) + '</div>';
            html += '</div>';
        }

        detail.innerHTML = html;
        card.classList.add('expanded');
        bindTimeLinks(detail);
    }

    // --- Verdict banner (compact view with expandable detail) ---

    function verdictClass(report) {
        var verdict = report.verdict || report.recommendation || '待定';
        if (verdict === '通过') return 'pass';
        if (verdict === '不通过') return 'fail';
        return 'pending';
    }

    function renderVerdictBanner(report) {
        showResult();
        var vClass = verdictClass(report);
        var verdictText = escapeHtml(report.verdict || report.recommendation || '待定');
        var oneLiner = report.one_liner || report.summary || '';
        if (oneLiner.length > 50) oneLiner = oneLiner.substring(0, 50) + '...';
        var scoreBadge = escapeHtml(String(report.score || '-'));

        var html = '';

        // Verdict banner
        html += '<div class="ai-verdict-banner ai-verdict-' + vClass + '">';
        html += '<div class="ai-verdict-main">';
        html += '<span class="ai-verdict-score-badge">' + scoreBadge + '</span>';
        html += '<span class="ai-verdict-text">' + verdictText + '</span>';
        html += '<span class="ai-verdict-oneliner">' + escapeHtml(oneLiner) + '</span>';
        html += '</div>';
        html += '<button class="ai-verdict-expand-btn">展开详细报告 ▼</button>';
        html += '</div>';

        // Actions row (visible in banner view)
        html += '<div class="ai-report-actions">';
        html += '<button id="btn-ai-copy" class="ai-btn-secondary">复制报告</button>';
        html += '<button id="btn-ai-export" class="ai-btn-secondary">导出 JSON</button>';
        html += '<button id="btn-ai-rerun" class="ai-btn-secondary">重新分析</button>';
        html += '<button id="btn-ai-settings-result" class="ai-btn-icon-sm" title="设置">&#9881;</button>';
        html += '</div>';

        // Hidden detail container
        html += '<div class="ai-report-detail" style="display:none">';
        html += '</div>';

        resultDiv.innerHTML = html;

        // Fill the detail container with the full report content
        var detailContainer = resultDiv.querySelector('.ai-report-detail');
        if (detailContainer) {
            detailContainer.innerHTML = buildReportHtml(report);
            bindTimeLinks(detailContainer);
            bindPhaseCardToggles();
        }

        // Bind expand/collapse toggle
        var expandBtn = resultDiv.querySelector('.ai-verdict-expand-btn');
        if (expandBtn && detailContainer) {
            expandBtn.addEventListener('click', function() {
                var isHidden = detailContainer.style.display === 'none';
                detailContainer.style.display = isHidden ? '' : 'none';
                expandBtn.textContent = isHidden ? '收起 ▲' : '展开详细报告 ▼';
            });
        }

        bindActionButtons(report);
    }

    // --- Build report HTML (shared by renderReport and renderVerdictBanner) ---

    function buildReportHtml(report) {
        var html = '';
        var sc = scorePct(report.score);
        var sColor = scoreColor(report.score);

        // Overall header with score ring
        html += '<div class="ai-report-header">';
        html += '<div class="ai-score-ring" style="--score-pct:' + sc + ';--score-color:' + sColor + '">';
        html += '<span class="ai-score-value">' + escapeHtml(report.score || '-') + '</span>';
        html += '</div>';
        html += '<div class="ai-report-header-body">';
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
        html += '<div class="ai-report-summary">' + escapeHtml(report.summary || '') + '</div>';

        // Dimension rating bars
        if (report.dimensions && report.dimensions.length > 0) {
            html += '<div class="ai-dimension-list">';
            for (var d = 0; d < report.dimensions.length; d++) {
                var dim = report.dimensions[d];
                html += '<div class="ai-dim-row"><span class="ai-dim-name">' + escapeHtml(dim.name) + '</span>'
                    + renderRatingBar(dim.stars)
                    + '</div>';
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
            html += '<span class="ai-meta-pill" title="\u6a21\u578b">' + escapeHtml(m.model || '-') + '</span>';
            html += '<span class="ai-meta-pill" title="\u8017\u65f6">' + dur + '</span>';
            html += '<span class="ai-meta-pill" title="Token">' + tokIn.toLocaleString() + ' / ' + tokOut.toLocaleString() + '</span>';
            html += '<span class="ai-meta-pill" title="\u91c7\u5e27">' + (m.frames || '-') + ' \u5e27</span>';
            html += '</div>';
        }
        html += '</div>'; // .ai-report-header-body
        html += '</div>'; // .ai-report-header

        // Phase cards
        html += '<div id="ai-phase-cards">';
        var phases = report.phases || [];
        for (var i = 0; i < phases.length; i++) {
            var phase = phases[i];
            var statusClass = phase.status || 'done';
            html += '<div class="ai-phase-card ' + statusClass + '" id="ai-phase-' + i + '" data-phase="' + i + '">';
            html += '<div class="ai-phase-header">';
            html += '<span class="ai-status-dot ' + statusClass + '"></span>';
            html += '<span class="ai-phase-name">' + escapeHtml(phase.name) + '</span>';
            html += '<span class="ai-phase-time">'
                + '<a class="ai-time-link" data-time="' + (phase.start_sec * 1000) + '">' + formatTimestamp(phase.start_sec) + '</a>'
                + ' - '
                + '<a class="ai-time-link" data-time="' + (phase.end_sec * 1000) + '">' + formatTimestamp(phase.end_sec) + '</a>'
                + '</span>';
            html += '<span class="ai-phase-chevron"></span>';
            html += '</div>';
            html += '<div class="ai-phase-summary">' + escapeHtml(phase.summary || '') + '</div>';

            // Detail (collapsible, collapsed by default via CSS)
            html += '<div class="ai-phase-detail">';
            if (phase.evaluation) {
                html += '<div class="ai-phase-eval">' + escapeHtml(phase.evaluation) + '</div>';
            }
            if (phase.dimensions && phase.dimensions.length > 0) {
                html += '<div class="ai-phase-dims">';
                for (var pd = 0; pd < phase.dimensions.length; pd++) {
                    var pdim = phase.dimensions[pd];
                    html += '<div class="ai-phase-dim">';
                    html += '<span class="ai-phase-dim-name">' + escapeHtml(pdim.name) + '</span>';
                    html += renderRatingBar(pdim.stars);
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
                html += '<div class="ai-phase-suspicious"><span class="ai-alert-icon">\u26a0</span> ' + escapeHtml(phase.suspicious.description || '') + '</div>';
            }
            if (phase.deep_check) {
                var dc = phase.deep_check;
                html += '<div class="ai-phase-deep-check ' + (dc.confirmed ? 'confirmed' : 'dismissed') + '">';
                html += '<span class="ai-dc-label">' + (dc.confirmed ? '\u786e\u8ba4' : '\u6392\u9664') + '</span> ';
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

        // Recommendation banner
        var recMap = { '\u901a\u8fc7': 'pass', '\u5f85\u5b9a': 'pending', '\u4e0d\u901a\u8fc7': 'fail' };
        var recClass = recMap[report.recommendation] || 'unknown';
        html += '<div class="ai-recommendation-banner ai-rec-' + recClass + '">';
        html += escapeHtml(report.recommendation || '-');
        html += '</div>';

        return html;
    }

    // --- Final report rendering (from cache or after analysis) ---

    function renderReport(report) {
        showResult();
        var html = buildReportHtml(report);

        // Actions
        html += '<div class="ai-report-actions">';
        html += '<button id="btn-ai-copy" class="ai-btn-secondary">\u590d\u5236\u62a5\u544a</button>';
        html += '<button id="btn-ai-export" class="ai-btn-secondary">\u5bfc\u51fa JSON</button>';
        html += '<button id="btn-ai-rerun" class="ai-btn-secondary">\u91cd\u65b0\u5206\u6790</button>';
        html += '<button id="btn-ai-settings-result" class="ai-btn-icon-sm" title="\u8bbe\u7f6e">&#9881;</button>';
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
                    card.classList.toggle('expanded');
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

        var btnSettingsResult = document.getElementById('btn-ai-settings-result');
        if (btnSettingsResult) {
            btnSettingsResult.addEventListener('click', function() {
                showSettings('result');
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
                md += '- **' + dim.name + '** ' + dim.stars + '/5 \u2014 ' + (dim.comment || '') + '\n';
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
                if (entry.report.markers) {
                    renderVerdictBanner(entry.report);
                } else {
                    renderReport(entry.report);
                }
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

    var settingsReturnTo = 'idle'; // 'idle' or 'result'

    function showSettings(returnTo) {
        settingsReturnTo = returnTo || 'idle';
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
        if (settingsReturnTo === 'result') {
            showResult();
        } else {
            showIdle();
        }
    }

    if (btnSettings) btnSettings.addEventListener('click', function() { showSettings('idle'); });
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
        renderVerdictBanner: renderVerdictBanner,
        setDataReady: setDataReady,
        setAutoAnalyze: setAutoAnalyze,
        getAutoAnalyze: getAutoAnalyze,
        loadCachedReport: loadCachedReport
    };
};
