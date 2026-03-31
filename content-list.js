// Block TP-Assist detection — prevent custom protocol dialog
(function () {
    var s = document.createElement('script');
    s.textContent = '(' + function () {
        // Block window.open for tp-assist:// protocol
        var _open = window.open;
        window.open = function (url) {
            if (url && /^tp-assist:/i.test(String(url))) return null;
            return _open.apply(this, arguments);
        };
        // Block iframe src for tp-assist:// protocol
        var desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
        if (desc && desc.set) {
            Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
                set: function (v) {
                    if (/^tp-assist:/i.test(String(v))) return;
                    desc.set.call(this, v);
                },
                get: desc.get,
                configurable: true
            });
        }
        // Block location assignment for tp-assist://
        var origAssign = location.assign;
        location.assign = function (url) {
            if (/^tp-assist:/i.test(String(url))) return;
            return origAssign.call(this, url);
        };
    } + ')();';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
})();

// Content script for /audit/record* pages
// Replaces original table with compact card list, highlighting duration.
(function () {
    'use strict';

    var DURATION_THRESHOLD_MIN = 58;
    var NOTES_KEY = 'tp_player_notes';

    // --- Duration parsing ---
    function parseDurationText(text) {
        var clean = text.replace(/<[^>]*>/g, '').trim();
        var totalSec = 0;
        var h = clean.match(/(\d+)\s*小时/);
        var m = clean.match(/(\d+)\s*分/);
        var s = clean.match(/(\d+)\s*秒/);
        if (h) totalSec += parseInt(h[1], 10) * 3600;
        if (m) totalSec += parseInt(m[1], 10) * 60;
        if (s) totalSec += parseInt(s[1], 10);
        return totalSec;
    }

    function formatDuration(totalSec) {
        if (totalSec < 60) return totalSec + 's';
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
        return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    }

    function parseUserName(text) {
        var match = text.match(/^(.+?)\s*\((.+?)\)\s*$/);
        if (match) {
            if (/^[a-zA-Z0-9_.\-]+$/.test(match[1])) {
                return { display: match[2], sub: match[1] };
            }
            return { display: match[1], sub: match[2] };
        }
        return { display: text.trim(), sub: '' };
    }

    var GRADIENTS = [
        'linear-gradient(135deg, #667eea, #764ba2)',
        'linear-gradient(135deg, #f093fb, #f5576c)',
        'linear-gradient(135deg, #4facfe, #00f2fe)',
        'linear-gradient(135deg, #a18cd1, #fbc2eb)',
        'linear-gradient(135deg, #ffecd2, #fcb69f)',
        'linear-gradient(135deg, #89f7fe, #66a6ff)',
        'linear-gradient(135deg, #fbc2eb, #a6c1ee)',
        'linear-gradient(135deg, #fdcbf1, #e6dee9)',
        'linear-gradient(135deg, #a1c4fd, #c2e9fb)',
        'linear-gradient(135deg, #d4fc79, #96e6a1)',
    ];

    function hashCode(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    function getGradient(name) {
        return GRADIENTS[hashCode(name) % GRADIENTS.length];
    }

    function getInitial(displayName) {
        return displayName.charAt(0).toUpperCase();
    }

    function formatDate(dateStr) {
        var m = dateStr.match(/\d{4}-(\d{2}-\d{2})\s+(\d{2}:\d{2})/);
        return m ? m[1] + ' ' + m[2] : dateStr;
    }

    function readNotes() {
        try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || {}; }
        catch (e) { return {}; }
    }

    function extractRowData(tr) {
        var rowId = tr.getAttribute('data-row-id');
        if (!rowId) return null;

        var cells = tr.querySelectorAll('td');
        if (cells.length < 10) return null;

        var userText = cells[2] ? cells[2].textContent.trim() : '';
        var dateText = cells[6] ? cells[6].textContent.trim() : '';
        var durationHtml = cells[7] ? cells[7].innerHTML : '';
        var durationText = cells[7] ? cells[7].textContent.trim() : '';
        var statusEl = cells[8] ? cells[8].querySelector('.label') : null;
        var isActive = statusEl && statusEl.classList.contains('label-success');
        var replayBtn = cells[9] ? cells[9].querySelector('a[data-action="replay"]') : null;
        var recordId = replayBtn ? replayBtn.getAttribute('data-record-id') : null;

        if (!recordId) {
            var idCell = cells[0];
            recordId = idCell ? idCell.textContent.trim() : null;
        }

        var totalSec = parseDurationText(durationHtml);

        return {
            rowId: rowId,
            user: parseUserName(userText),
            date: dateText,
            dateFormatted: formatDate(dateText),
            durationSec: totalSec,
            durationFormatted: formatDuration(totalSec),
            isActive: isActive,
            recordId: recordId,
            durationRaw: durationText,
        };
    }

    function renderCard(data, notes) {
        var card = document.createElement('div');
        card.className = 'tp-card';
        card.setAttribute('data-row-id', data.rowId);

        var isLong = data.durationSec >= DURATION_THRESHOLD_MIN * 60;
        var noteData = data.recordId && notes[data.recordId];
        var tagHtml = '';
        if (noteData && noteData.tag) {
            var tagLabels = { pass: '通过', fail: '不通过', pending: '待定' };
            tagHtml = '<span class="tp-card-tag ' + noteData.tag + '">' + tagLabels[noteData.tag] + '</span>';
        }

        var rightHtml;
        var cachedHtml = '';
        try {
            var cacheMeta = JSON.parse(localStorage.getItem('tp_cache_meta')) || {};
            if (data.recordId && cacheMeta[data.recordId]) {
                cachedHtml = '<span class="tp-card-cached" title="\u5df2\u7f13\u5b58">\u25cf</span>';
            }
        } catch (e) { /* ignore */ }

        if (data.isActive) {
            rightHtml = ''
                + '<div class="tp-card-duration ' + (isLong ? 'long' : 'short') + '">' + data.durationRaw + '</div>'
                + '<div class="tp-card-active-badge"><span class="tp-card-pulse"></span>使用中</div>';
        } else {
            rightHtml = ''
                + '<div class="tp-card-duration ' + (isLong ? 'long' : 'short') + '">' + data.durationFormatted + '</div>'
                + cachedHtml
                + '<button class="tp-card-play" data-rid="' + (data.recordId || '') + '">&#9654; 播放</button>';
        }

        card.innerHTML = ''
            + '<div class="tp-card-left">'
            + '  <div class="tp-card-avatar" style="background: ' + getGradient(data.user.display) + ';">'
            + getInitial(data.user.display)
            + '  </div>'
            + '  <div class="tp-card-user">'
            + '    <div class="tp-card-name" title="' + data.user.sub + '">' + data.user.display + tagHtml + '</div>'
            + '    <div class="tp-card-time">' + data.dateFormatted + '</div>'
            + '  </div>'
            + '</div>'
            + '<div class="tp-card-right">' + rightHtml + '</div>';

        var playBtn = card.querySelector('.tp-card-play');
        if (playBtn) {
            playBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var rid = this.getAttribute('data-rid');
                if (rid) {
                    window.open(
                        '/audit/replay/1/' + rid + '?tp_web_player=1&rid=' + rid,
                        '_blank'
                    );
                }
            });
        }

        return card;
    }

    function renderCardList() {
        var tbody = document.querySelector('#table-record tbody');
        if (!tbody) return;

        var notes = readNotes();
        var rows = tbody.querySelectorAll('tr[data-row-id]');

        var container = document.getElementById('tp-card-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'tp-card-container';
            container.className = 'tp-card-list';
            var tableWrapper = document.querySelector('.table-responsive') || document.getElementById('table-record');
            if (tableWrapper && tableWrapper.parentElement) {
                tableWrapper.parentElement.insertBefore(container, tableWrapper);
            }
        }

        container.innerHTML = '';

        var pageBody = document.querySelector('.box-body') || document.body;
        pageBody.classList.add('tp-cards-active');

        for (var i = 0; i < rows.length; i++) {
            var data = extractRowData(rows[i]);
            if (data) {
                container.appendChild(renderCard(data, notes));
            }
        }
    }

    function init() {
        renderCardList();

        var tableEl = document.getElementById('table-record');
        if (tableEl) {
            new MutationObserver(renderCardList).observe(tableEl, { childList: true, subtree: true });
        }
    }

    if (document.getElementById('table-record')) {
        init();
    } else {
        var bodyObs = new MutationObserver(function () {
            if (document.getElementById('table-record')) {
                bodyObs.disconnect();
                init();
            }
        });
        bodyObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
})();
