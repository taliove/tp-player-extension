// Teleport Assessment Reviewer — Auth Manager
// Handles credential encryption, storage, and login API calls.
// Runs in service worker context via importScripts().
(function() {
    'use strict';

    if (typeof self.TP === 'undefined') self.TP = {};

    var SALT = new Uint8Array([84,80,45,65,85,84,72,45,83,65,76,84,45,50,48,50,54]);
    var STORAGE_KEYS = {
        serverUrl: 'tp_server_url',
        username: 'tp_username',
        passwordEnc: 'tp_password_enc',
        remember: 'tp_remember',
        lastLogin: 'tp_last_login',
        authState: 'tp_auth_state'
    };

    function deriveKey() {
        var id = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)
            ? chrome.runtime.id : 'tp-extension-fallback';
        var enc = new TextEncoder();
        return crypto.subtle.importKey(
            'raw', enc.encode(id), 'PBKDF2', false, ['deriveKey']
        ).then(function(baseKey) {
            return crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
                baseKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
        });
    }

    function encrypt(plaintext) {
        var iv = crypto.getRandomValues(new Uint8Array(12));
        var enc = new TextEncoder();
        return deriveKey().then(function(key) {
            return crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                enc.encode(plaintext)
            );
        }).then(function(cipherBuf) {
            return {
                iv: btoa(String.fromCharCode.apply(null, iv)),
                ciphertext: btoa(String.fromCharCode.apply(null, new Uint8Array(cipherBuf)))
            };
        });
    }

    function decrypt(encrypted) {
        if (!encrypted || !encrypted.iv || !encrypted.ciphertext) {
            return Promise.reject(new Error('Invalid encrypted data'));
        }
        var iv = new Uint8Array(atob(encrypted.iv).split('').map(function(c) { return c.charCodeAt(0); }));
        var cipherBytes = new Uint8Array(atob(encrypted.ciphertext).split('').map(function(c) { return c.charCodeAt(0); }));
        return deriveKey().then(function(key) {
            return crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                cipherBytes
            );
        }).then(function(plainBuf) {
            return new TextDecoder().decode(plainBuf);
        });
    }

    TP.createAuthManager = function() {
        return {
            saveCredentials: function(url, username, password, remember) {
                var storageArea = remember ? chrome.storage.local : chrome.storage.session;
                return encrypt(password).then(function(enc) {
                    var data = {};
                    data[STORAGE_KEYS.serverUrl] = url;
                    data[STORAGE_KEYS.username] = username;
                    data[STORAGE_KEYS.passwordEnc] = enc;
                    data[STORAGE_KEYS.remember] = remember;
                    return new Promise(function(resolve) {
                        storageArea.set(data, resolve);
                    });
                });
            },

            loadCredentials: function() {
                return new Promise(function(resolve) {
                    chrome.storage.local.get(
                        [STORAGE_KEYS.serverUrl, STORAGE_KEYS.username, STORAGE_KEYS.passwordEnc, STORAGE_KEYS.remember],
                        function(data) {
                            if (data[STORAGE_KEYS.passwordEnc]) {
                                resolve(data);
                            } else {
                                chrome.storage.session.get(
                                    [STORAGE_KEYS.serverUrl, STORAGE_KEYS.username, STORAGE_KEYS.passwordEnc],
                                    function(sessionData) {
                                        resolve(sessionData[STORAGE_KEYS.passwordEnc] ? sessionData : null);
                                    }
                                );
                            }
                        }
                    );
                }).then(function(data) {
                    if (!data || !data[STORAGE_KEYS.passwordEnc]) return null;
                    return decrypt(data[STORAGE_KEYS.passwordEnc]).then(function(password) {
                        return {
                            url: data[STORAGE_KEYS.serverUrl],
                            username: data[STORAGE_KEYS.username],
                            password: password
                        };
                    });
                });
            },

            clearCredentials: function() {
                var keys = Object.values(STORAGE_KEYS);
                return Promise.all([
                    new Promise(function(resolve) { chrome.storage.local.remove(keys, resolve); }),
                    new Promise(function(resolve) { chrome.storage.session.remove(keys, resolve); })
                ]);
            },

            doLogin: function(serverUrl, username, password, captcha) {
                var loginArgs = JSON.stringify({
                    type: captcha ? 2 : 1,
                    captcha: captcha || '',
                    username: username,
                    password: password,
                    oath: '',
                    remember: true
                });
                var url = serverUrl.replace(/\/+$/, '') + '/auth/do-login';
                return fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'args=' + encodeURIComponent(loginArgs),
                    credentials: 'include'
                }).then(function(resp) {
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    return resp.json();
                }).then(function(data) {
                    if (data.code !== 0) {
                        throw new Error(data.message || '登录失败 (code: ' + data.code + ')');
                    }
                    return { success: true };
                });
            },

            isAuthenticated: function() {
                return new Promise(function(resolve) {
                    chrome.storage.local.get(STORAGE_KEYS.authState, function(data) {
                        resolve(data[STORAGE_KEYS.authState] === 'authenticated');
                    });
                });
            },

            getServerUrl: function() {
                return new Promise(function(resolve) {
                    chrome.storage.local.get(STORAGE_KEYS.serverUrl, function(data) {
                        resolve(data[STORAGE_KEYS.serverUrl] || null);
                    });
                });
            }
        };
    };
})();
