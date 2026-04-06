// Teleport Assessment Reviewer — Popup
(function() {
    'use strict';

    var viewLogin = document.getElementById('view-login');
    var viewStatus = document.getElementById('view-status');
    var inputUrl = document.getElementById('input-url');
    var inputUsername = document.getElementById('input-username');
    var inputPassword = document.getElementById('input-password');
    var inputCaptcha = document.getElementById('input-captcha');
    var captchaImg = document.getElementById('captcha-img');
    var inputRemember = document.getElementById('input-remember');
    var btnLogin = document.getElementById('btn-login');
    var loginError = document.getElementById('login-error');
    var statusUrl = document.getElementById('status-url');
    var statusUsername = document.getElementById('status-username');
    var btnOpenPanel = document.getElementById('btn-open-panel');
    var btnLogout = document.getElementById('btn-logout');

    // --- Init: check auth state ---
    chrome.storage.local.get(['tp_auth_state', 'tp_server_url', 'tp_username'], function(data) {
        if (data.tp_auth_state === 'authenticated') {
            showStatusView(data.tp_server_url, data.tp_username);
        } else {
            showLoginView(data.tp_server_url || '', data.tp_username || '');
        }
    });

    function showLoginView(savedUrl, savedUsername) {
        viewLogin.style.display = '';
        viewStatus.style.display = 'none';
        if (savedUrl) inputUrl.value = savedUrl;
        if (savedUsername) inputUsername.value = savedUsername;
        loginError.style.display = 'none';
        // Load captcha if URL is already set
        if (savedUrl) refreshCaptcha(savedUrl);
    }

    function showStatusView(url, username) {
        viewLogin.style.display = 'none';
        viewStatus.style.display = '';
        statusUrl.textContent = url || '';
        statusUsername.textContent = username || '';
    }

    // --- Captcha ---
    function refreshCaptcha(serverUrl) {
        if (!serverUrl) return;
        var url = serverUrl.replace(/\/+$/, '');
        // Fetch captcha through service worker to maintain session cookie
        chrome.runtime.sendMessage({
            type: 'fetch-captcha',
            url: url + '/auth/captcha?h=36&_t=' + Date.now()
        }, function(resp) {
            if (resp && resp.success && resp.dataUrl) {
                captchaImg.src = resp.dataUrl;
            } else {
                captchaImg.alt = '加载失败';
            }
        });
    }

    // Click captcha image to refresh
    captchaImg.addEventListener('click', function() {
        var url = inputUrl.value.trim();
        if (url) {
            if (!/^https?:\/\//.test(url)) url = 'https://' + url;
            refreshCaptcha(url);
        }
    });

    // Auto-load captcha when URL field loses focus
    inputUrl.addEventListener('blur', function() {
        var url = inputUrl.value.trim();
        if (url) {
            if (!/^https?:\/\//.test(url)) url = 'https://' + url;
            refreshCaptcha(url);
        }
    });

    // --- Login ---
    btnLogin.addEventListener('click', function() {
        var url = inputUrl.value.trim();
        var username = inputUsername.value.trim();
        var password = inputPassword.value;
        var captcha = inputCaptcha.value.trim();
        var remember = inputRemember.checked;

        if (!url) { showLoginError('请输入服务器地址'); inputUrl.focus(); return; }
        if (!username) { showLoginError('请输入用户名'); inputUsername.focus(); return; }
        if (!password) { showLoginError('请输入密码'); inputPassword.focus(); return; }
        if (!captcha) { showLoginError('请输入验证码'); inputCaptcha.focus(); return; }

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
                // Open side panel and close popup
                chrome.runtime.sendMessage({ type: 'open-side-panel' }, function() {
                    window.close();
                });
            } else {
                showLoginError(response && response.error ? response.error : '连接失败，请检查地址和凭据');
                // Refresh captcha on failed login
                inputCaptcha.value = '';
                refreshCaptcha(url);
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

    // --- Logout ---
    btnLogout.addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'logout' }, function() {
            showLoginView('', '');
        });
    });

    function showLoginError(msg) {
        loginError.textContent = msg;
        loginError.style.display = '';
    }

    function setLoginLoading(loading) {
        btnLogin.disabled = loading;
        inputUrl.disabled = loading;
        inputUsername.disabled = loading;
        inputPassword.disabled = loading;
        inputCaptcha.disabled = loading;
        if (loading) {
            btnLogin.classList.add('loading');
        } else {
            btnLogin.classList.remove('loading');
        }
    }
})();
