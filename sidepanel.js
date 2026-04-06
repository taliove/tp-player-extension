// Teleport Assessment Reviewer — Side Panel
(function() {
    'use strict';

    var DURATION_THRESHOLD_MIN = 58;
    var NOTES_KEY = 'tp_player_notes';

    // --- DOM refs ---
    var cardList = document.getElementById('sp-card-list');
    var stateLoading = document.getElementById('sp-loading');
    var stateEmpty = document.getElementById('sp-empty');
    var stateError = document.getElementById('sp-error');
    var stateUnauth = document.getElementById('sp-unauth');
    var errorText = document.getElementById('sp-error-text');
    var footer = document.getElementById('sp-footer');
    var statToday = document.getElementById('sp-stat-today');
    var statPending = document.getElementById('sp-stat-pending');
    var searchBar = document.getElementById('sp-search-bar');
    var searchInput = document.getElementById('sp-search-input');
    var statusDot = document.getElementById('sp-status-dot');
    var contextMenu = document.getElementById('sp-context-menu');

    var allRecords = [];
    var hostCache = {};
    var notesCache = {};
    var activeFilter = 'all';
    var searchQuery = '';
    var contextMenuRid = null;
    var searchTimeout = null;

    // --- Init ---
    chrome.storage.local.get('tp_auth_state', function(data) {
        if (data.tp_auth_state === 'authenticated') {
            statusDot.classList.add('connected');
            fetchRecords();
        } else {
            showState('unauth');
        }
    });

    // --- Fetch records ---
    function fetchRecords(silent) {
        if (!silent) showState('loading');

        // Fetch records and hosts in parallel
        var recordsPromise = new Promise(function(resolve, reject) {
            chrome.runtime.sendMessage({ type: 'get-records', page: 0, perPage: 100 }, function(resp) {
                if (resp && resp.success) resolve(resp.data);
                else reject(new Error(resp && resp.error ? resp.error : '获取记录失败'));
            });
        });

        var hostsPromise = new Promise(function(resolve) {
            chrome.runtime.sendMessage({ type: 'get-hosts' }, function(resp) {
                if (resp && resp.success && resp.data && resp.data.data) {
                    var cache = {};
                    for (var i = 0; i < resp.data.data.length; i++) {
                        var h = resp.data.data[i];
                        if (h.ip && h.name) cache[h.ip] = h.name;
                    }
                    resolve(cache);
                } else {
                    resolve({});
                }
            });
        });

        Promise.all([recordsPromise, hostsPromise]).then(function(results) {
            allRecords = normalizeRecords(results[0].data || []);
            hostCache = results[1];
            loadNotes();
            renderCards();
        }).catch(function(err) {
            if (err.message === 'AUTH_EXPIRED') {
                showState('unauth');
            } else {
                errorText.textContent = err.message;
                showState('error');
            }
        });
    }

    function normalizeRecords(rawRecords) {
        return rawRecords.map(function(r) {
            // API fields: user_surname, user_username, time_begin (unix), time_end (unix),
            // host_ip, protocol_type, state, id
            var displayName = r.user_surname || r.user_username || '';
            var subName = r.user_username || '';
            var user = { display: displayName, sub: subName };

            var hostIp = r.host_ip || '';

            // time_begin/time_end are unix timestamps (seconds)
            var beginTs = r.time_begin || 0;
            var endTs = r.time_end || 0;
            var durationSec = endTs > beginTs ? endTs - beginTs : 0;

            // Format date from unix timestamp
            var dateStr = '';
            var dateFormatted = '';
            if (beginTs > 0) {
                var d = new Date(beginTs * 1000);
                var mm = String(d.getMonth() + 1).padStart(2, '0');
                var dd = String(d.getDate()).padStart(2, '0');
                var hh = String(d.getHours()).padStart(2, '0');
                var mi = String(d.getMinutes()).padStart(2, '0');
                dateStr = d.getFullYear() + '-' + mm + '-' + dd + ' ' + hh + ':' + mi;
                dateFormatted = mm + '-' + dd + ' ' + hh + ':' + mi;
            }

            // state: 9999 = finished, others = active
            var isActive = (r.state !== 9999 && r.state !== 0);

            return {
                rowId: r.id,
                recordId: String(r.id),
                user: user,
                date: dateStr,
                dateFormatted: dateFormatted,
                durationSec: durationSec,
                durationFormatted: TPP.formatDuration(durationSec),
                isActive: isActive,
                hostIp: hostIp,
                protocolType: r.protocol_type
            };
        });
    }

    function loadNotes() {
        chrome.storage.local.get(NOTES_KEY, function(data) {
            notesCache = data[NOTES_KEY] || {};
        });
    }

    // --- Render cards ---
    function renderCards() {
        var filtered = filterRecords(allRecords);
        cardList.innerHTML = '';

        if (filtered.length === 0) {
            showState('empty');
            return;
        }

        showState('list');

        for (var i = 0; i < filtered.length; i++) {
            cardList.appendChild(createCard(filtered[i]));
        }

        updateStats();
    }

    function filterRecords(records) {
        var result = records;

        // Apply filter tab
        if (activeFilter === 'today') {
            var now = new Date();
            var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
            result = result.filter(function(r) {
                return r.date && r.date.indexOf(todayStart) === 0;
            });
        } else if (activeFilter === 'pending') {
            result = result.filter(function(r) {
                return !notesCache[r.recordId] || !notesCache[r.recordId].tag;
            });
        } else if (activeFilter === 'tagged') {
            result = result.filter(function(r) {
                return notesCache[r.recordId] && notesCache[r.recordId].tag;
            });
        }

        // Apply search
        if (searchQuery) {
            var q = searchQuery.toLowerCase();
            result = result.filter(function(r) {
                var hostName = hostCache[r.hostIp] || '';
                return r.user.display.toLowerCase().indexOf(q) !== -1
                    || r.user.sub.toLowerCase().indexOf(q) !== -1
                    || hostName.toLowerCase().indexOf(q) !== -1;
            });
        }

        return result;
    }

    function createCard(data) {
        var card = document.createElement('div');
        card.className = 'sp-card';
        card.setAttribute('data-rid', data.recordId);

        var isLong = data.durationSec >= DURATION_THRESHOLD_MIN * 60;
        var noteData = notesCache[data.recordId];
        var tagHtml = '';
        if (noteData && noteData.tag) {
            var tagLabels = { pass: '通过', fail: '不通过', pending: '待定' };
            tagHtml = '<span class="sp-card-tag ' + noteData.tag + '">' + (tagLabels[noteData.tag] || '') + '</span>';
        }

        var examHtml = '';
        if (data.hostIp && hostCache[data.hostIp]) {
            var parsed = TPP.parseHostNameStr(hostCache[data.hostIp]);
            if (parsed) {
                examHtml = '<div class="sp-card-exam">' + TPP.escapeHtml(parsed.topic)
                    + (parsed.role ? ' <span class="sp-card-role">' + TPP.escapeHtml(parsed.role) + '</span>' : '')
                    + '</div>';
            }
        }

        var statusHtml;
        if (data.isActive) {
            statusHtml = '<div class="sp-card-active"><span class="sp-card-pulse"></span>使用中</div>';
        } else {
            statusHtml = '<div class="sp-card-duration ' + (isLong ? 'long' : 'short') + '">'
                + data.durationFormatted + '</div>';
        }

        card.innerHTML = ''
            + '<div class="sp-card-left">'
            + '  <div class="sp-card-avatar" style="background:' + TPP.getGradient(data.user.display) + '">'
            + TPP.getInitial(data.user.display)
            + '  </div>'
            + '  <div class="sp-card-info">'
            + '    <div class="sp-card-name">' + TPP.escapeHtml(data.user.display) + tagHtml + '</div>'
            + examHtml
            + '    <div class="sp-card-time">' + data.dateFormatted + '</div>'
            + '  </div>'
            + '</div>'
            + '<div class="sp-card-right">'
            + statusHtml
            + '  <button class="sp-card-more" title="更多">&middot;&middot;&middot;</button>'
            + '</div>';

        // Click card -> open player
        card.addEventListener('click', function(e) {
            if (e.target.closest('.sp-card-more')) return;
            if (data.isActive) return;
            if (data.protocolType !== 1) return; // Only RDP
            var playerUrl = chrome.runtime.getURL('player.html') + '?rid=' + data.recordId;
            // Use window.open as fallback if chrome.tabs isn't available in side panel
            try {
                chrome.tabs.create({ url: playerUrl });
            } catch (err) {
                window.open(playerUrl, '_blank');
            }
        });

        // More button -> context menu
        var moreBtn = card.querySelector('.sp-card-more');
        moreBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            showContextMenu(data.recordId, e.target);
        });

        return card;
    }

    // --- Context menu ---
    function showContextMenu(rid, anchor) {
        contextMenuRid = rid;
        var rect = anchor.getBoundingClientRect();
        contextMenu.style.display = '';
        contextMenu.style.top = (rect.bottom + 4) + 'px';
        contextMenu.style.right = '12px';
        contextMenu.style.left = 'auto';
    }

    function hideContextMenu() {
        contextMenu.style.display = 'none';
        contextMenuRid = null;
    }

    document.addEventListener('click', function(e) {
        if (!contextMenu.contains(e.target)) hideContextMenu();
    });

    contextMenu.addEventListener('click', function(e) {
        var item = e.target.closest('.sp-menu-item');
        if (!item || !contextMenuRid) return;

        var tag = item.getAttribute('data-tag');
        var action = item.getAttribute('data-action');

        if (tag) {
            var existing = notesCache[contextMenuRid] || {};
            if (existing.tag === tag) {
                delete existing.tag;
            } else {
                existing.tag = tag;
            }
            existing.ts = Date.now();
            notesCache[contextMenuRid] = existing;
            saveNotes();
            renderCards();
        }

        if (action === 'note') {
            var currentNote = (notesCache[contextMenuRid] || {}).note || '';
            var newNote = prompt('备注:', currentNote);
            if (newNote !== null) {
                var entry = notesCache[contextMenuRid] || {};
                entry.note = newNote;
                entry.ts = Date.now();
                notesCache[contextMenuRid] = entry;
                saveNotes();
            }
        }

        hideContextMenu();
    });

    function saveNotes() {
        var data = {};
        data[NOTES_KEY] = notesCache;
        chrome.storage.local.set(data);
    }

    // --- State management ---
    function showState(state) {
        cardList.style.display = state === 'list' ? '' : 'none';
        stateLoading.style.display = state === 'loading' ? '' : 'none';
        stateEmpty.style.display = state === 'empty' ? '' : 'none';
        stateError.style.display = state === 'error' ? '' : 'none';
        stateUnauth.style.display = state === 'unauth' ? '' : 'none';
        footer.style.display = state === 'list' ? '' : 'none';
    }

    function updateStats() {
        var now = new Date();
        var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
        var todayCount = 0;
        var pendingCount = 0;
        for (var i = 0; i < allRecords.length; i++) {
            if (allRecords[i].date && allRecords[i].date.indexOf(todayStart) === 0) todayCount++;
            if (!notesCache[allRecords[i].recordId] || !notesCache[allRecords[i].recordId].tag) pendingCount++;
        }
        statToday.textContent = '今日: ' + todayCount + '条';
        statPending.textContent = '待审: ' + pendingCount + '条';
    }

    // --- Filter tabs ---
    var tabs = document.querySelectorAll('.sp-tab');
    tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            tabs.forEach(function(t) { t.classList.remove('active'); });
            tab.classList.add('active');
            activeFilter = tab.getAttribute('data-filter');
            renderCards();
        });
    });

    // --- Search ---
    document.getElementById('btn-search-toggle').addEventListener('click', function() {
        var visible = searchBar.style.display !== 'none';
        searchBar.style.display = visible ? 'none' : '';
        if (!visible) searchInput.focus();
        else { searchInput.value = ''; searchQuery = ''; renderCards(); }
    });

    searchInput.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(function() {
            searchQuery = searchInput.value.trim();
            renderCards();
        }, 300);
    });

    // --- Refresh ---
    document.getElementById('btn-refresh').addEventListener('click', function() { fetchRecords(); });
    document.getElementById('btn-empty-refresh').addEventListener('click', function() { fetchRecords(); });
    document.getElementById('btn-error-retry').addEventListener('click', function() { fetchRecords(); });

    // --- Unauth -> login ---
    document.getElementById('btn-go-login').addEventListener('click', function() {
        chrome.action.setPopup({ popup: 'popup.html' });
        chrome.action.openPopup();
    });

    // --- Auto-refresh from service worker ---
    chrome.runtime.onMessage.addListener(function(message) {
        if (message && message.type === 'records-refresh-tick') {
            fetchRecords(true);
        }
    });

    // --- Listen for auth state changes ---
    chrome.storage.onChanged.addListener(function(changes, area) {
        if (area === 'local' && changes.tp_auth_state) {
            if (changes.tp_auth_state.newValue === 'authenticated') {
                statusDot.classList.add('connected');
                fetchRecords();
            } else {
                statusDot.classList.remove('connected');
                showState('unauth');
            }
        }
    });
})();
