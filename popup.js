// Teleport Assessment Reviewer — Popup
(function() {
    'use strict';

    var viewLogin = document.getElementById('view-login');
    var viewStatus = document.getElementById('view-status');
    var viewSettings = document.getElementById('view-settings');
    var inputUrl = document.getElementById('input-url');
    var inputUsername = document.getElementById('input-username');
    var inputPassword = document.getElementById('input-password');
    var inputCaptcha = document.getElementById('input-captcha');
    var captchaGroup = document.getElementById('captcha-group');
    var captchaImg = document.getElementById('captcha-img');
    var captchaSpinner = document.getElementById('captcha-spinner');
    var inputRemember = document.getElementById('input-remember');
    var btnLogin = document.getElementById('btn-login');
    var loginError = document.getElementById('login-error');
    var statusUrl = document.getElementById('status-url');
    var statusUsername = document.getElementById('status-username');
    var btnOpenPanel = document.getElementById('btn-open-panel');
    var btnSettings = document.getElementById('btn-settings');
    var btnLogout = document.getElementById('btn-logout');

    // Settings view refs
    var settingsUrl = document.getElementById('settings-url');
    var settingsUsername = document.getElementById('settings-username');
    var settingsPassword = document.getElementById('settings-password');
    var btnSettingsSave = document.getElementById('btn-settings-save');
    var btnSettingsBack = document.getElementById('btn-settings-back');
    var settingsError = document.getElementById('settings-error');
    var settingsSuccess = document.getElementById('settings-success');

    var captchaVisible = false;
    var captchaDetected = false; // Prevents re-detection on subsequent blurs

    // --- Init: check auth state ---
    chrome.storage.local.get(['tp_auth_state', 'tp_server_url', 'tp_username'], function(data) {
        if (data.tp_auth_state === 'authenticated') {
            showStatusView(data.tp_server_url, data.tp_username);
        } else {
            showLoginView(data.tp_server_url || '', data.tp_username || '');
        }
    });

    function showView(name) {
        viewLogin.style.display = name === 'login' ? '' : 'none';
        viewStatus.style.display = name === 'status' ? '' : 'none';
        viewSettings.style.display = name === 'settings' ? '' : 'none';
    }

    function showLoginView(savedUrl, savedUsername) {
        showView('login');
        if (savedUrl) inputUrl.value = savedUrl;
        if (savedUsername) inputUsername.value = savedUsername;
        loginError.style.display = 'none';
        // Detect captcha if URL is already set
        if (savedUrl && !captchaDetected) detectCaptcha(savedUrl);
    }

    function showStatusView(url, username) {
        showView('status');
        statusUrl.textContent = url || '';
        statusUsername.textContent = username || '';
    }

    function showSettingsView() {
        showView('settings');
        settingsError.style.display = 'none';
        settingsSuccess.style.display = 'none';
        chrome.storage.local.get(['tp_server_url', 'tp_username'], function(data) {
            settingsUrl.value = data.tp_server_url || '';
            settingsUsername.value = data.tp_username || '';
            settingsPassword.value = ''; // Don't pre-fill password
            settingsPassword.placeholder = '••••••••';
        });
    }

    // --- Captcha auto-detection ---
    function detectCaptcha(serverUrl) {
        if (!serverUrl || captchaDetected) return;
        var url = serverUrl.replace(/\/+$/, '');
        if (!/^https?:\/\//.test(url)) url = 'https://' + url;

        // Show spinner while detecting
        captchaGroup.style.display = '';
        captchaSpinner.style.display = '';
        captchaImg.style.display = 'none';
        captchaVisible = false;

        var detectTimeout = setTimeout(function() {
            // Timeout: assume no captcha
            captchaGroup.style.display = 'none';
            captchaVisible = false;
            captchaDetected = true;
        }, 3000);

        chrome.runtime.sendMessage({
            type: 'fetch-captcha',
            url: url + '/auth/captcha?h=36&_t=' + Date.now()
        }, function(resp) {
            clearTimeout(detectTimeout);
            captchaSpinner.style.display = 'none';
            if (resp && resp.success && resp.dataUrl) {
                // Server has captcha
                captchaImg.src = resp.dataUrl;
                captchaImg.style.display = '';
                captchaVisible = true;
                captchaDetected = true;
            } else {
                // No captcha (404, error, or empty)
                captchaGroup.style.display = 'none';
                captchaVisible = false;
                captchaDetected = true;
            }
        });
    }

    function refreshCaptcha(serverUrl) {
        if (!serverUrl) return;
        var url = serverUrl.replace(/\/+$/, '');
        if (!/^https?:\/\//.test(url)) url = 'https://' + url;
        chrome.runtime.sendMessage({
            type: 'fetch-captcha',
            url: url + '/auth/captcha?h=36&_t=' + Date.now()
        }, function(resp) {
            if (resp && resp.success && resp.dataUrl) {
                captchaImg.src = resp.dataUrl;
            }
        });
    }

    // Click captcha image to refresh
    captchaImg.addEventListener('click', function() {
        var url = inputUrl.value.trim();
        if (url) refreshCaptcha(url);
    });

    // Auto-detect captcha when URL field loses focus (only once)
    inputUrl.addEventListener('blur', function() {
        var url = inputUrl.value.trim();
        if (url && !captchaDetected) {
            detectCaptcha(url);
        }
    });

    // --- Login ---
    btnLogin.addEventListener('click', function() {
        var url = inputUrl.value.trim();
        var username = inputUsername.value.trim();
        var password = inputPassword.value;
        var captcha = captchaVisible ? inputCaptcha.value.trim() : '';
        var remember = inputRemember.checked;

        if (!url) { showLoginError('请输入服务器地址'); inputUrl.focus(); return; }
        if (!username) { showLoginError('请输入用户名'); inputUsername.focus(); return; }
        if (!password) { showLoginError('请输入密码'); inputPassword.focus(); return; }
        if (captchaVisible && !captcha) { showLoginError('请输入验证码'); inputCaptcha.focus(); return; }

        // Normalize URL
        if (!/^https?:\/\//.test(url)) url = 'https://' + url;
        url = url.replace(/\/+$/, '');

        setLoginLoading(true);
        loginError.style.display = 'none';

        chrome.runtime.sendMessage({
            type: 'login',
            url: url,
            username: username,
            password: password,
            captcha: captcha,
            remember: remember
        }, function(response) {
            setLoginLoading(false);
            if (response && response.success) {
                chrome.runtime.sendMessage({ type: 'open-side-panel' }, function() {
                    window.close();
                });
            } else {
                showLoginError(response && response.error ? response.error : '连接失败，请检查地址和凭据');
                if (captchaVisible) {
                    inputCaptcha.value = '';
                    refreshCaptcha(url);
                }
            }
        });
    });

    // Enter key submits login
    [inputUrl, inputUsername, inputPassword, inputCaptcha].forEach(function(el) {
        el.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') btnLogin.click();
        });
    });

    // --- Open Side Panel ---
    btnOpenPanel.addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'open-side-panel' }, function() {
            window.close();
        });
    });

    // --- Settings ---
    btnSettings.addEventListener('click', function() {
        showSettingsView();
    });

    btnSettingsBack.addEventListener('click', function() {
        chrome.storage.local.get(['tp_server_url', 'tp_username'], function(data) {
            showStatusView(data.tp_server_url, data.tp_username);
        });
    });

    btnSettingsSave.addEventListener('click', function() {
        var url = settingsUrl.value.trim();
        var username = settingsUsername.value.trim();
        var password = settingsPassword.value; // Empty = keep existing

        if (!url) { showSettingsError('请输入服务器地址'); settingsUrl.focus(); return; }
        if (!username) { showSettingsError('请输入用户名'); settingsUsername.focus(); return; }

        // Normalize URL
        if (!/^https?:\/\//.test(url)) url = 'https://' + url;
        url = url.replace(/\/+$/, '');

        setSettingsLoading(true);
        settingsError.style.display = 'none';
        settingsSuccess.style.display = 'none';

        // If password is empty, use existing password via re-login message
        chrome.runtime.sendMessage({
            type: 'update-settings',
            url: url,
            username: username,
            password: password || null // null = keep existing
        }, function(response) {
            setSettingsLoading(false);
            if (response && response.success) {
                settingsSuccess.style.display = '';
                setTimeout(function() {
                    chrome.storage.local.get(['tp_server_url', 'tp_username'], function(data) {
                        showStatusView(data.tp_server_url, data.tp_username);
                    });
                }, 1000);
            } else {
                showSettingsError(response && response.error ? response.error : '认证失败，已恢复原配置');
            }
        });
    });

    // --- Logout ---
    btnLogout.addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'logout' }, function() {
            captchaDetected = false; // Reset captcha detection for next login
            showLoginView('', '');
        });
    });

    // --- Listen for auth state changes (sync with sidebar settings) ---
    chrome.storage.onChanged.addListener(function(changes, area) {
        if (area !== 'local') return;
        if (changes.tp_auth_state) {
            if (changes.tp_auth_state.newValue === 'authenticated') {
                chrome.storage.local.get(['tp_server_url', 'tp_username'], function(data) {
                    showStatusView(data.tp_server_url, data.tp_username);
                });
            } else {
                captchaDetected = false;
                showLoginView('', '');
            }
        }
        if (changes.tp_server_url || changes.tp_username) {
            // Settings changed from sidebar, update status view if visible
            if (viewStatus.style.display !== 'none') {
                chrome.storage.local.get(['tp_server_url', 'tp_username'], function(data) {
                    statusUrl.textContent = data.tp_server_url || '';
                    statusUsername.textContent = data.tp_username || '';
                });
            }
        }
    });

    function showLoginError(msg) {
        loginError.textContent = msg;
        loginError.style.display = '';
    }

    function showSettingsError(msg) {
        settingsError.textContent = msg;
        settingsError.style.display = '';
    }

    function setLoginLoading(loading) {
        btnLogin.disabled = loading;
        inputUrl.disabled = loading;
        inputUsername.disabled = loading;
        inputPassword.disabled = loading;
        inputCaptcha.disabled = loading;
        if (loading) btnLogin.classList.add('loading');
        else btnLogin.classList.remove('loading');
    }

    function setSettingsLoading(loading) {
        btnSettingsSave.disabled = loading;
        settingsUrl.disabled = loading;
        settingsUsername.disabled = loading;
        settingsPassword.disabled = loading;
        if (loading) btnSettingsSave.classList.add('loading');
        else btnSettingsSave.classList.remove('loading');
    }
})();
