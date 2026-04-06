// Teleport Assessment Reviewer — Shared Utilities
// Extracted from content-list.js for use in side panel and other standalone pages.
// Depends on TPP namespace from constants.js.
(function() {
    'use strict';

    // --- Duration parsing (Chinese time strings) ---
    TPP.parseDurationText = function(text) {
        var clean = text.replace(/<[^>]*>/g, '').trim();
        var totalSec = 0;
        var h = clean.match(/(\d+)\s*小时/);
        var m = clean.match(/(\d+)\s*分/);
        var s = clean.match(/(\d+)\s*秒/);
        if (h) totalSec += parseInt(h[1], 10) * 3600;
        if (m) totalSec += parseInt(m[1], 10) * 60;
        if (s) totalSec += parseInt(s[1], 10);
        return totalSec;
    };

    TPP.formatDuration = function(totalSec) {
        if (totalSec < 60) return totalSec + 's';
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
        return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    };

    // --- User name parsing ---
    TPP.parseUserName = function(text) {
        var match = text.match(/^(.+?)\s*\((.+?)\)\s*$/);
        if (match) {
            if (/^[a-zA-Z0-9_.\-]+$/.test(match[1])) {
                return { display: match[2], sub: match[1] };
            }
            return { display: match[1], sub: match[2] };
        }
        return { display: text.trim(), sub: '' };
    };

    // --- Avatar gradients ---
    TPP.GRADIENTS = [
        'linear-gradient(135deg, #667eea, #764ba2)',
        'linear-gradient(135deg, #f093fb, #f5576c)',
        'linear-gradient(135deg, #4facfe, #00f2fe)',
        'linear-gradient(135deg, #a18cd1, #fbc2eb)',
        'linear-gradient(135deg, #ffecd2, #fcb69f)',
        'linear-gradient(135deg, #89f7fe, #66a6ff)',
        'linear-gradient(135deg, #fbc2eb, #a6c1ee)',
        'linear-gradient(135deg, #fdcbf1, #e6dee9)',
        'linear-gradient(135deg, #a1c4fd, #c2e9fb)',
        'linear-gradient(135deg, #d4fc79, #96e6a1)'
    ];

    TPP.hashCode = function(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    };

    TPP.getGradient = function(name) {
        return TPP.GRADIENTS[TPP.hashCode(name) % TPP.GRADIENTS.length];
    };

    TPP.getInitial = function(displayName) {
        return displayName.charAt(0).toUpperCase();
    };

    // --- Date formatting ---
    TPP.formatDate = function(dateStr) {
        var m = dateStr.match(/\d{4}-(\d{2}-\d{2})\s+(\d{2}:\d{2})/);
        return m ? m[1] + ' ' + m[2] : dateStr;
    };

    // --- Host name parsing ---
    TPP.parseHostNameStr = function(name) {
        if (!name) return null;
        var match = name.match(/^(.+?)\s*[（(](.+?)[）)]\s*(?:-\s*\d+)?$/);
        if (match) return { topic: match[1].trim(), role: match[2].trim() };
        return { topic: name.replace(/-\s*\d+$/, '').trim(), role: '' };
    };

    // --- Compute duration from begin/end timestamps ---
    TPP.computeDurationSec = function(beginStr, endStr) {
        if (!beginStr || !endStr) return 0;
        var begin = new Date(beginStr.replace(' ', 'T'));
        var end = new Date(endStr.replace(' ', 'T'));
        var sec = Math.round((end - begin) / 1000);
        return sec > 0 ? sec : 0;
    };
})();
