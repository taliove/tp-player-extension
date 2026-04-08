// Teleport RDP Web Player — PDF Report HTML Template
// Builds a self-contained HTML string for the assessment report print overlay.
// All design decisions from /plan-design-review applied:
//   - Print-safe CSS (borders, not backgrounds for critical elements)
//   - 3 primary cards + inline secondary row
//   - No duplicate score in verdict
//   - No-AI reflow (muted banner, larger screenshots)
//   - Screenshot auto-height with max-height
//   - Page overflow with page-break rules
//   - H:MM:SS time format
//   - 4px spacing scale (8,12,16,24,32), border-radius 6px/8px
//   - Conditional footer text
//   - Descriptive alt text on screenshots

(function() {
    'use strict';

    function esc(str) {
        return TPP.escapeHtml(str || '');
    }

    function formatTimeHMS(sec) {
        if (!sec && sec !== 0) return '0:00:00';
        sec = Math.round(sec);
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function formatDuration(ms) {
        if (!ms) return '0\u5206\u949f';
        var totalSec = Math.round(ms / 1000);
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        if (h > 0) return h + '\u5c0f\u65f6' + (m > 0 ? m + '\u5206' : '');
        if (m > 0) return m + '\u5206\u949f';
        return s + '\u79d2';
    }

    function formatDate(timestamp) {
        if (!timestamp) return '';
        var d = new Date(timestamp * 1000);
        var y = d.getFullYear();
        var mo = d.getMonth() + 1;
        var day = d.getDate();
        var hh = d.getHours();
        var mm = d.getMinutes();
        return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (day < 10 ? '0' : '') + day
            + ' ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    }

    function getVerdictClass(verdict) {
        if (!verdict) return 'unknown';
        if (verdict === '\u901a\u8fc7') return 'pass';
        if (verdict === '\u4e0d\u901a\u8fc7') return 'fail';
        return 'pending';
    }

    function getVerdictIcon(verdict) {
        var cls = getVerdictClass(verdict);
        if (cls === 'pass') return '\u2705';
        if (cls === 'fail') return '\u274c';
        if (cls === 'pending') return '\u26a0\ufe0f';
        return '\u2014';
    }

    function getResultText(aiReport, notes) {
        if (aiReport && aiReport.verdict) {
            var icon = aiReport.verdict === '\u901a\u8fc7' ? '\u2713' : aiReport.verdict === '\u4e0d\u901a\u8fc7' ? '\u2717' : '\u25cb';
            return { text: icon + ' ' + aiReport.verdict, cls: getVerdictClass(aiReport.verdict) };
        }
        if (notes && notes.tag) {
            var tagMap = { pass: '\u2713 \u901a\u8fc7', fail: '\u2717 \u6dd8\u6c70', pending: '\u25cb \u5f85\u5b9a' };
            var tagCls = { pass: 'pass', fail: 'fail', pending: 'pending' };
            return { text: tagMap[notes.tag] || notes.tag, cls: tagCls[notes.tag] || 'unknown' };
        }
        return { text: '\u672a\u8bc4\u5b9a', cls: 'unknown' };
    }

    function buildScreenshotHTML(screenshots, hasAI) {
        if (!screenshots || screenshots.length === 0) return '';
        var maxH = hasAI ? '180px' : '220px';
        var html = '<h2 class="rpt-section-title">\u5173\u952e\u65f6\u523b Key Moments</h2>';
        html += '<div class="rpt-screenshot-grid">';
        for (var i = 0; i < screenshots.length; i++) {
            var s = screenshots[i];
            var src = 'data:image/jpeg;base64,' + esc(s.base64);
            var alt = s.label ? esc(s.label) + ' at ' + formatTimeHMS(s.timestamp_sec) : '\u5f55\u50cf\u622a\u56fe at ' + formatTimeHMS(s.timestamp_sec);
            if (s.description) alt += ' \u2014 ' + esc(s.description);
            html += '<div class="rpt-screenshot-card">';
            html += '<div class="rpt-screenshot-img-wrap">';
            html += '<img src="' + src + '" alt="' + alt + '" style="width:100%;height:auto;max-height:' + maxH + ';object-fit:contain;display:block;">';
            html += '<span class="rpt-time-badge">' + formatTimeHMS(s.timestamp_sec) + '</span>';
            html += '</div>';
            if (s.label || s.description) {
                html += '<div class="rpt-screenshot-caption">';
                if (s.label) html += '<span class="rpt-marker-label">' + esc(s.label) + '</span>';
                if (s.description) html += ' \u2014 ' + esc(s.description);
                html += '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function buildPhasesHTML(phases) {
        if (!phases || phases.length === 0) return '';
        var html = '<div class="rpt-phases-section">';
        html += '<h2 class="rpt-section-title">\u8bc4\u4f30\u9636\u6bb5 Assessment Phases</h2>';
        html += '<table class="rpt-phase-table"><thead><tr>';
        html += '<th>\u9636\u6bb5</th><th>\u65f6\u95f4\u533a\u95f4</th><th>\u8bc4\u4f30</th>';
        html += '</tr></thead><tbody>';
        for (var i = 0; i < phases.length; i++) {
            var p = phases[i];
            html += '<tr>';
            html += '<td class="rpt-phase-name">' + esc(p.name) + '</td>';
            html += '<td class="rpt-phase-time">' + formatTimeHMS(p.start_sec) + ' - ' + formatTimeHMS(p.end_sec) + '</td>';
            html += '<td>' + esc(p.summary) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        return html;
    }

    function getReportCSS() {
        return [
            '* { margin:0; padding:0; box-sizing:border-box; }',
            'body { font-family:-apple-system,"PingFang SC","Noto Sans SC",sans-serif; color:#1a1a1a; }',

            // Print overlay — hidden by default via JS, shown before window.print()
            '#report-print-overlay { display:none; }',
            '@media print {',
            '  #player-app, #control-bar, #toast-container, #info-bar,',
            '  #verdict-banner, #main-content, #shortcut-overlay,',
            '  #ai-settings-modal, #shortcut-bar { display:none !important; }',
            '  body { background:white; }',
            '}',
            '@page { size:A4; margin:15mm 12mm; }',

            // Page container
            '.rpt-page { max-width:210mm; margin:0 auto; padding:32px; }',

            // Header
            '.rpt-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; padding-bottom:16px; border-bottom:2px solid #1a1a1a; }',
            '.rpt-header h1 { font-size:22px; font-weight:700; color:#1a1a1a; margin-bottom:4px; }',
            '.rpt-header .rpt-subtitle { font-size:12px; color:#6b7280; }',
            '.rpt-header-right { text-align:right; }',
            '.rpt-logo { font-size:13px; font-weight:600; color:#1a1a1a; letter-spacing:1px; }',
            '.rpt-date { font-size:11px; color:#9ca3af; margin-top:2px; }',

            // Info cards (3 primary)
            '.rpt-info-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:12px; }',
            '.rpt-info-card { border:1px solid #d1d5db; border-radius:8px; padding:12px 16px; background:#fafafa; }',
            '.rpt-info-card .rpt-label { font-size:11px; color:#9ca3af; margin-bottom:4px; }',
            '.rpt-info-card .rpt-value { font-size:16px; font-weight:600; color:#1a1a1a; }',
            '.rpt-info-card .rpt-value-sm { font-size:14px; font-weight:600; color:#1a1a1a; }',

            // Secondary info row
            '.rpt-secondary-row { font-size:13px; color:#374151; margin-bottom:24px; }',
            '.rpt-secondary-row .rpt-result-pass { color:#16a34a; font-weight:600; }',
            '.rpt-secondary-row .rpt-result-fail { color:#dc2626; font-weight:600; }',
            '.rpt-secondary-row .rpt-result-pending { color:#d97706; font-weight:600; }',
            '.rpt-secondary-row .rpt-result-unknown { color:#9ca3af; font-weight:600; }',
            '.rpt-sep { margin:0 8px; color:#d1d5db; }',

            // Verdict box (print-safe: border-left, not background)
            '.rpt-verdict-box { display:flex; align-items:center; gap:16px; padding:16px 24px; border-radius:8px; margin-bottom:24px; border:1px solid #e5e7eb; }',
            '.rpt-verdict-box.pass { border-left:4px solid #16a34a; background:#f0fdf4; }',
            '.rpt-verdict-box.fail { border-left:4px solid #dc2626; background:#fef2f2; }',
            '.rpt-verdict-box.pending { border-left:4px solid #d97706; background:#fffbeb; }',
            '.rpt-verdict-icon { font-size:28px; }',
            '.rpt-verdict-content { flex:1; }',
            '.rpt-verdict-grade { font-size:20px; font-weight:700; }',
            '.rpt-verdict-box.pass .rpt-verdict-grade { color:#16a34a; }',
            '.rpt-verdict-box.fail .rpt-verdict-grade { color:#dc2626; }',
            '.rpt-verdict-box.pending .rpt-verdict-grade { color:#d97706; }',
            '.rpt-verdict-summary { font-size:13px; color:#374151; margin-top:4px; line-height:1.5; }',

            // No-AI muted banner
            '.rpt-no-ai-banner { border:1px dashed #d1d5db; border-radius:8px; padding:16px; text-align:center; color:#9ca3af; font-size:13px; margin-bottom:24px; }',

            // Section titles
            '.rpt-section-title { font-size:14px; font-weight:700; color:#1a1a1a; margin-bottom:12px; padding-bottom:6px; border-bottom:1px solid #e5e7eb; }',

            // Screenshot grid
            '.rpt-screenshot-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:24px; }',
            '.rpt-screenshot-card { border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; page-break-inside:avoid; }',
            '.rpt-screenshot-img-wrap { position:relative; background:#f3f4f6; }',
            '.rpt-time-badge { position:absolute; top:6px; left:6px; background:rgba(0,0,0,0.7); color:white; font-size:10px; padding:2px 6px; border-radius:6px; }',
            '.rpt-screenshot-caption { padding:8px 12px; font-size:11px; color:#374151; line-height:1.4; }',
            '.rpt-marker-label { font-weight:600; color:#1a1a1a; }',

            // Phase table
            '.rpt-phases-section { page-break-before:auto; }',
            '.rpt-phase-table { width:100%; border-collapse:collapse; margin-bottom:24px; font-size:12px; }',
            '.rpt-phase-table th { text-align:left; padding:8px 12px; background:#f9fafb; border-bottom:2px solid #e5e7eb; color:#6b7280; font-weight:600; font-size:11px; }',
            '.rpt-phase-table td { padding:8px 12px; border-bottom:1px solid #f3f4f6; }',
            '.rpt-phase-name { font-weight:500; }',
            '.rpt-phase-time { color:#6b7280; font-size:11px; }',

            // Footer
            '.rpt-footer { margin-top:24px; padding-top:12px; border-top:1px solid #e5e7eb; display:flex; justify-content:space-between; font-size:10px; color:#9ca3af; }',

            // Print hint (visible on screen, hidden in PDF)
            '.rpt-print-hint { text-align:center; padding:8px; font-size:11px; color:#9ca3af; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; margin-bottom:16px; }',
            '@media print { .rpt-print-hint { display:none !important; } }',

            // Print color safety
            '@media print {',
            '  .rpt-verdict-box { -webkit-print-color-adjust:exact; print-color-adjust:exact; }',
            '  .rpt-screenshot-img-wrap { -webkit-print-color-adjust:exact; print-color-adjust:exact; }',
            '  .rpt-time-badge { -webkit-print-color-adjust:exact; print-color-adjust:exact; }',
            '}'
        ].join('\n');
    }

    TPP.buildReportHTML = function(data) {
        var hasAI = !!(data.aiReport && (data.aiReport.score != null || data.aiReport.verdict));
        var result = getResultText(data.aiReport, data.notes);
        var dateStr = formatDate(data.startTime);
        var todayStr = new Date().toISOString().split('T')[0];

        var html = '';
        html += '<div id="report-print-overlay">';
        html += '<style>' + getReportCSS() + '</style>';
        html += '<div class="rpt-page">';

        // Print hint (screen only)
        html += '<div class="rpt-print-hint">\u5efa\u8bae\u52fe\u9009\u300c\u80cc\u666f\u56fe\u5f62\u300d\u4ee5\u83b7\u5f97\u6700\u4f73\u6253\u5370\u6548\u679c</div>';

        // Header
        html += '<div class="rpt-header">';
        html += '<div><h1>\u6280\u672f\u8bc4\u4f30\u62a5\u544a</h1>';
        html += '<div class="rpt-subtitle">Technical Assessment Report</div></div>';
        html += '<div class="rpt-header-right">';
        html += '<div class="rpt-logo">TELEPORT</div>';
        html += '<div class="rpt-date">' + esc(todayStr) + '</div>';
        html += '</div></div>';

        // Primary info cards
        html += '<div class="rpt-info-grid">';
        html += '<div class="rpt-info-card"><div class="rpt-label">\u5019\u9009\u4eba</div><div class="rpt-value">' + esc(data.candidate) + '</div></div>';
        html += '<div class="rpt-info-card"><div class="rpt-label">\u5e94\u8058\u5c97\u4f4d</div><div class="rpt-value-sm">' + esc(data.role || '\u672a\u77e5') + '</div></div>';
        html += '<div class="rpt-info-card"><div class="rpt-label">\u8003\u8bd5\u65f6\u957f</div><div class="rpt-value">' + esc(formatDuration(data.duration)) + '</div></div>';
        html += '</div>';

        // Secondary info row
        html += '<div class="rpt-secondary-row">';
        html += esc(data.topic || '\u672a\u77e5');
        html += '<span class="rpt-sep">\u00b7</span>';
        html += esc(dateStr);
        html += '<span class="rpt-sep">\u00b7</span>';
        html += '<span class="rpt-result-' + result.cls + '">' + esc(result.text) + '</span>';
        html += '</div>';

        // Verdict box (only with AI)
        if (hasAI) {
            var vCls = getVerdictClass(data.aiReport.verdict);
            html += '<div class="rpt-verdict-box ' + vCls + '">';
            html += '<div class="rpt-verdict-icon">' + getVerdictIcon(data.aiReport.verdict) + '</div>';
            html += '<div class="rpt-verdict-content">';
            html += '<div class="rpt-verdict-grade">' + esc(data.aiReport.score) + ' ' + esc(data.aiReport.verdict) + '</div>';
            html += '<div class="rpt-verdict-summary">' + esc(data.aiReport.one_liner) + '</div>';
            html += '</div></div>';
        } else {
            html += '<div class="rpt-no-ai-banner">AI \u5206\u6790\u672a\u5b8c\u6210</div>';
        }

        // Screenshots
        html += buildScreenshotHTML(data.screenshots, hasAI);

        // Phases (only with AI)
        if (hasAI && data.aiReport.phases && data.aiReport.phases.length > 0) {
            html += buildPhasesHTML(data.aiReport.phases);
        }

        // Footer
        var footerMid = hasAI ? 'AI \u8f85\u52a9\u5206\u6790' : '\u624b\u52a8\u5ba1\u9605';
        html += '<div class="rpt-footer">';
        html += '<div>Teleport Assessment' + (data.version ? ' v' + esc(data.version) : '') + '</div>';
        html += '<div>' + footerMid + ' \u00b7 \u4ec5\u4f9b\u5185\u90e8\u53c2\u8003</div>';
        html += '<div>' + esc(data.generatedAt || todayStr) + '</div>';
        html += '</div>';

        html += '</div></div>';
        return html;
    };
})();
