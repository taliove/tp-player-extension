// Teleport Assessment Reviewer — API Proxy
// Centralized Teleport API calls with automatic auth retry.
// Runs in service worker context via importScripts().
(function() {
    'use strict';

    if (typeof self.TP === 'undefined') self.TP = {};

    TP.createAPIProxy = function(authManager) {
        function getServerUrl() {
            return new Promise(function(resolve, reject) {
                chrome.storage.local.get('tp_server_url', function(data) {
                    if (data.tp_server_url) resolve(data.tp_server_url.replace(/\/+$/, ''));
                    else reject(new Error('未配置服务器地址'));
                });
            });
        }

        function callAPI(path, args, isRetry) {
            return getServerUrl().then(function(serverUrl) {
                var url = serverUrl + path;
                var body = 'args=' + encodeURIComponent(JSON.stringify(args || {}));
                return fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: body,
                    credentials: 'include'
                });
            }).then(function(resp) {
                if (resp.status === 401 || resp.status === 403) {
                    if (isRetry) throw new Error('AUTH_EXPIRED');
                    return reLoginAndRetry(path, args);
                }
                var contentType = resp.headers.get('content-type') || '';
                if (contentType.indexOf('application/json') === -1) {
                    if (isRetry) throw new Error('AUTH_EXPIRED');
                    return reLoginAndRetry(path, args);
                }
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
            }).then(function(data) {
                if (data.code === -10) {
                    if (isRetry) throw new Error('AUTH_EXPIRED');
                    return reLoginAndRetry(path, args);
                }
                if (data.code !== 0) {
                    throw new Error(data.message || 'API error (code: ' + data.code + ')');
                }
                return data.data;
            });
        }

        function reLoginAndRetry(path, args) {
            return authManager.loadCredentials().then(function(creds) {
                if (!creds) throw new Error('AUTH_EXPIRED');
                return authManager.doLogin(creds.url, creds.username, creds.password, '');
            }).then(function() {
                chrome.storage.local.set({ tp_last_login: Date.now() });
                return callAPI(path, args, true);
            });
        }

        return {
            call: callAPI,

            getRecords: function(pageIndex, perPage) {
                return callAPI('/audit/get-records', {
                    filter: {},
                    order: { k: 'id', v: false },
                    limit: { page_index: pageIndex || 0, per_page: perPage || 100 }
                });
            },

            getHosts: function() {
                return callAPI('/asset/get-hosts', {});
            }
        };
    };
})();
