// Neutralize TP-Assist system — Chrome extension handles RDP replay.
// This file runs in the MAIN world (via manifest "world": "MAIN") so it has
// direct access to page JS objects. No <script> injection needed.
(function () {
    'use strict';

    var ASSIST_RE = /localhost:(50022|50023)/;
    var PROTO_RE = /^(tp-assist|teleport):/i;

    // --- Layer 1: Block XHR to localhost:50022/50023 ---
    // Prevents $assist.init() AJAX call from triggering macOS URL handler dialog.
    var _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        if (url && ASSIST_RE.test(String(url))) {
            this._tpBlocked = true;
            return;
        }
        return _xhrOpen.apply(this, arguments);
    };
    var _xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
        if (this._tpBlocked) {
            var self = this;
            setTimeout(function () {
                if (typeof self.onerror === 'function') self.onerror();
            }, 0);
            return;
        }
        return _xhrSend.apply(this, arguments);
    };

    // Also block jQuery AJAX which may use its own transport
    // jQuery calls $.ajaxTransport or $.ajaxSetup — intercept at $.ajax level
    // after jQuery loads (DOMContentLoaded).

    // --- Layer 2: Block teleport:// and tp-assist:// protocol URLs ---
    var _open = window.open;
    window.open = function (url) {
        if (url && PROTO_RE.test(String(url))) return null;
        return _open.apply(this, arguments);
    };

    var _setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if (this.tagName === 'IFRAME' && name.toLowerCase() === 'src' && PROTO_RE.test(String(value))) return;
        return _setAttr.apply(this, arguments);
    };

    // --- Layer 3: Override $tp.assist before $tp.init() fires ---
    // $tp.init() is called from $(function(){ $tp.init(); }) which fires on
    // DOMContentLoaded. We register our listener BEFORE jQuery loads, so ours
    // fires first.
    document.addEventListener('DOMContentLoaded', function () {
        // Patch $tp.assist if it exists
        if (typeof $tp !== 'undefined' && $tp.assist) {
            $tp.assist.running = true;
            $tp.assist.version = 'web-player';
            $tp.assist.init = function (cb_stack) { cb_stack.exec(); };
            $tp.assist.check = function () { return true; };
            $tp.assist.alert_assist_not_found = function () {};

            if (typeof $tp.assist_checked === 'function') {
                $tp.assist_checked();
            }
        }

        // Also patch jQuery AJAX to block assist requests
        if (typeof $ !== 'undefined' && $.ajax) {
            var _ajax = $.ajax;
            $.ajax = function (opts) {
                if (opts && opts.url && ASSIST_RE.test(String(opts.url))) {
                    // Fire the error callback so the page handles it gracefully
                    if (typeof opts.error === 'function') {
                        setTimeout(opts.error, 0);
                    }
                    return;
                }
                return _ajax.apply(this, arguments);
            };
        }
    }, false);
})();
