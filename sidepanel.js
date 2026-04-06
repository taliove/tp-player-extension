// Teleport Assessment Reviewer — Side Panel
(function() {
    'use strict';

    // --- Sidebar port (for player sidebar auto-collapse detection) ---
    try { chrome.runtime.connect({ name: 'sidebar' }); } catch(e) {}

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
    var selectedTopics = []; // empty = all topics (no filter)
    var contextMenuRid = null;
    var searchTimeout = null;
    var activePlayerTabId = null;
    var activeRecordId = null;
    var topicDropdown = document.getElementById('sp-topic-dropdown');
    var topicList = document.getElementById('sp-topic-list');
    var topicTab = document.getElementById('sp-tab-topic');

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
            buildTopicDropdown();
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
            // Show filter-aware empty state
            var hasActiveFilter = activeFilter !== 'all' || searchQuery || selectedTopics.length > 0;
            if (hasActiveFilter && allRecords.length > 0) {
                showState('empty');
                var emptyEl = document.getElementById('sp-empty');
                emptyEl.querySelector('.sp-state-text').textContent = '没有匹配的录像记录';
                var clearBtn = document.getElementById('btn-empty-refresh');
                clearBtn.textContent = '清除筛选';
                clearBtn.onclick = function() {
                    // Reset all filters
                    activeFilter = 'all';
                    searchQuery = '';
                    searchInput.value = '';
                    searchBar.style.display = 'none';
                    selectedTopics = [];
                    chrome.storage.local.set({ tp_filter_topic: [] });
                    updateTopicCheckboxes();
                    topicTab.classList.remove('has-filter');
                    var allTabs = document.querySelectorAll('.sp-tab:not(.sp-tab-topic)');
                    allTabs.forEach(function(t) { t.classList.remove('active'); });
                    allTabs[0].classList.add('active');
                    renderCards();
                };
            } else {
                showState('empty');
                document.getElementById('sp-empty').querySelector('.sp-state-text').textContent = '暂无会话记录';
                var refreshBtn = document.getElementById('btn-empty-refresh');
                refreshBtn.textContent = '刷新';
                refreshBtn.onclick = function() { fetchRecords(); };
            }
            return;
        }

        showState('list');

        for (var i = 0; i < filtered.length; i++) {
            cardList.appendChild(createCard(filtered[i]));
        }

        updateStats();
    }

    // --- Topic filter dropdown ---
    function buildTopicDropdown() {
        var topics = {};
        var hasOther = false;
        var ips = Object.keys(hostCache);
        for (var i = 0; i < ips.length; i++) {
            var parsed = TPP.parseHostNameStr(hostCache[ips[i]]);
            if (parsed && parsed.topic) {
                var key = parsed.topic + (parsed.role ? '（' + parsed.role + '）' : '');
                topics[key] = true;
            } else {
                hasOther = true;
            }
        }

        topicList.innerHTML = '';
        var keys = Object.keys(topics).sort();
        for (var j = 0; j < keys.length; j++) {
            var label = document.createElement('label');
            label.className = 'sp-topic-option';
            label.innerHTML = '<input type="checkbox" value="' + TPP.escapeHtml(keys[j]) + '"><span>' + TPP.escapeHtml(keys[j]) + '</span>';
            topicList.appendChild(label);
        }
        if (hasOther) {
            var divider = document.createElement('div');
            divider.className = 'sp-topic-divider';
            topicList.appendChild(divider);
            var otherLabel = document.createElement('label');
            otherLabel.className = 'sp-topic-option';
            otherLabel.innerHTML = '<input type="checkbox" value="__other__"><span>其他</span>';
            topicList.appendChild(otherLabel);
        }

        // Restore saved filter state
        chrome.storage.local.get('tp_filter_topic', function(data) {
            if (data.tp_filter_topic && Array.isArray(data.tp_filter_topic) && data.tp_filter_topic.length > 0) {
                selectedTopics = data.tp_filter_topic;
                updateTopicCheckboxes();
                topicTab.classList.add('has-filter');
                renderCards();
            }
        });
    }

    function updateTopicCheckboxes() {
        var allCheckbox = topicDropdown.querySelector('input[value="__all__"]');
        var checkboxes = topicList.querySelectorAll('input[type="checkbox"]');
        if (selectedTopics.length === 0) {
            allCheckbox.checked = true;
            for (var i = 0; i < checkboxes.length; i++) checkboxes[i].checked = false;
        } else {
            allCheckbox.checked = false;
            for (var j = 0; j < checkboxes.length; j++) {
                checkboxes[j].checked = selectedTopics.indexOf(checkboxes[j].value) !== -1;
            }
        }
    }

    // "全部岗位" checkbox
    topicDropdown.querySelector('input[value="__all__"]').addEventListener('change', function() {
        selectedTopics = [];
        updateTopicCheckboxes();
        topicTab.classList.remove('has-filter');
        chrome.storage.local.set({ tp_filter_topic: [] });
        renderCards();
    });

    // Individual topic checkboxes (delegated)
    topicList.addEventListener('change', function(e) {
        if (e.target.type !== 'checkbox') return;
        var val = e.target.value;
        if (e.target.checked) {
            if (selectedTopics.indexOf(val) === -1) selectedTopics.push(val);
        } else {
            selectedTopics = selectedTopics.filter(function(t) { return t !== val; });
        }
        updateTopicCheckboxes();
        topicTab.classList.toggle('has-filter', selectedTopics.length > 0);
        chrome.storage.local.set({ tp_filter_topic: selectedTopics });
        renderCards();
    });

    // Topic tab click toggles dropdown visibility
    topicTab.addEventListener('click', function(e) {
        e.stopPropagation();
        var visible = topicDropdown.style.display !== 'none';
        topicDropdown.style.display = visible ? 'none' : '';
    });

    // Close dropdown when clicking elsewhere
    document.addEventListener('click', function(e) {
        if (!topicDropdown.contains(e.target) && e.target !== topicTab) {
            topicDropdown.style.display = 'none';
        }
    });

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

        // Apply topic filter
        if (selectedTopics.length > 0) {
            result = result.filter(function(r) {
                var hostName = hostCache[r.hostIp] || '';
                var parsed = TPP.parseHostNameStr(hostName);
                if (!parsed) return selectedTopics.indexOf('__other__') !== -1;
                var topicKey = parsed.topic + (parsed.role ? '（' + parsed.role + '）' : '');
                return selectedTopics.indexOf(topicKey) !== -1;
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
        card.className = 'sp-card' + (data.recordId === activeRecordId ? ' sp-card-playing' : '');
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

        // Click card -> open/reuse player tab
        card.addEventListener('click', function(e) {
            if (e.target.closest('.sp-card-more')) return;
            if (data.isActive) return;
            if (data.protocolType !== 1) return; // Only RDP

            var newTab = e.ctrlKey || e.metaKey || e.button === 1;
            var playerUrl = chrome.runtime.getURL('player.html') + '?rid=' + data.recordId + '&from=ext';

            if (newTab) {
                // Ctrl/Cmd+Click or middle-click: always new tab
                try { chrome.tabs.create({ url: playerUrl }); }
                catch (err) { window.open(playerUrl, '_blank'); }
                return;
            }

            // Default: reuse existing player tab
            if (activePlayerTabId !== null) {
                chrome.tabs.get(activePlayerTabId, function(tab) {
                    if (chrome.runtime.lastError || !tab) {
                        // Tab was closed, create new
                        openNewPlayerTab(playerUrl, data.recordId);
                    } else {
                        // Tab exists, send switch message and focus it
                        chrome.runtime.sendMessage({
                            type: 'switch-recording',
                            rid: data.recordId,
                            targetTabId: activePlayerTabId
                        });
                        chrome.tabs.update(activePlayerTabId, { active: true });
                        activeRecordId = data.recordId;
                        renderCards();
                    }
                });
            } else {
                openNewPlayerTab(playerUrl, data.recordId);
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

    function openNewPlayerTab(url, recordId) {
        try {
            chrome.tabs.create({ url: url }, function(tab) {
                if (tab) activePlayerTabId = tab.id;
                activeRecordId = recordId;
                renderCards();
            });
        } catch (err) {
            window.open(url, '_blank');
        }
    }

    // Listen for tab close to clear activePlayerTabId
    if (chrome.tabs && chrome.tabs.onRemoved) {
        chrome.tabs.onRemoved.addListener(function(tabId) {
            if (tabId === activePlayerTabId) {
                activePlayerTabId = null;
                activeRecordId = null;
                renderCards();
            }
        });
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

        // Show "now playing" info if a recording is active
        if (activeRecordId) {
            var activeRecord = allRecords.find(function(r) { return r.recordId === activeRecordId; });
            if (activeRecord) {
                var hostName = hostCache[activeRecord.hostIp] || '';
                var parsed = TPP.parseHostNameStr(hostName);
                var info = activeRecord.user.display;
                if (parsed && parsed.topic) info += ' — ' + parsed.topic;
                statToday.textContent = '▶ ' + info;
                statPending.textContent = '';
                return;
            }
        }
        statToday.textContent = '今日: ' + todayCount + '条';
        statPending.textContent = '待审: ' + pendingCount + '条';
    }

    // --- Filter tabs ---
    var tabs = document.querySelectorAll('.sp-tab:not(.sp-tab-topic)');
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

    // --- Header title -> open Teleport main page ---
    document.getElementById('sp-header-title').addEventListener('click', function() {
        chrome.storage.local.get('tp_server_url', function(data) {
            if (data.tp_server_url) {
                chrome.tabs.create({ url: data.tp_server_url });
            }
        });
    });

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

    // --- Settings panel ---
    var spSettings = document.getElementById('sp-settings');
    var spSettingsUrl = document.getElementById('sp-settings-url');
    var spSettingsUsername = document.getElementById('sp-settings-username');
    var spSettingsPassword = document.getElementById('sp-settings-password');
    var spSettingsError = document.getElementById('sp-settings-error');
    var spSettingsSuccess = document.getElementById('sp-settings-success');

    document.getElementById('btn-settings').addEventListener('click', function() {
        spSettingsError.style.display = 'none';
        spSettingsSuccess.style.display = 'none';
        chrome.storage.local.get(['tp_server_url', 'tp_username'], function(data) {
            spSettingsUrl.value = data.tp_server_url || '';
            spSettingsUsername.value = data.tp_username || '';
            spSettingsPassword.value = '';
            spSettingsPassword.placeholder = '••••••••';
        });
        spSettings.style.display = '';
    });

    document.getElementById('btn-settings-back').addEventListener('click', function() {
        spSettings.style.display = 'none';
    });

    document.getElementById('btn-sp-settings-save').addEventListener('click', function() {
        var url = spSettingsUrl.value.trim();
        var username = spSettingsUsername.value.trim();
        var password = spSettingsPassword.value;

        if (!url) { spSettingsError.textContent = '请输入服务器地址'; spSettingsError.style.display = ''; return; }
        if (!username) { spSettingsError.textContent = '请输入用户名'; spSettingsError.style.display = ''; return; }

        if (!/^https?:\/\//.test(url)) url = 'https://' + url;
        url = url.replace(/\/+$/, '');

        var saveBtn = document.getElementById('btn-sp-settings-save');
        saveBtn.disabled = true;
        spSettingsError.style.display = 'none';
        spSettingsSuccess.style.display = 'none';

        chrome.runtime.sendMessage({
            type: 'update-settings',
            url: url,
            username: username,
            password: password || null
        }, function(response) {
            saveBtn.disabled = false;
            if (response && response.success) {
                spSettingsSuccess.style.display = '';
                setTimeout(function() { spSettings.style.display = 'none'; }, 1000);
            } else {
                spSettingsError.textContent = response && response.error ? response.error : '认证失败，已恢复原配置';
                spSettingsError.style.display = '';
            }
        });
    });

    document.getElementById('btn-sp-logout').addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'logout' }, function() {
            spSettings.style.display = 'none';
        });
    });
})();
