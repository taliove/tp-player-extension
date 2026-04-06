// Teleport Assessment Reviewer — Onboarding Hints
// Shows first-use feature discovery hints, each dismissed and remembered.
(function() {
    'use strict';

    var HINT_KEYS = {
        drag: 'tp_hint_canvas_drag_seen',
        zoom: 'tp_hint_zoom_seen',
        resolution: 'tp_hint_resolution_seen'
    };

    function showHint(storageKey, text) {
        return new Promise(function(resolve) {
            chrome.storage.local.get(storageKey, function(data) {
                if (data[storageKey]) { resolve(false); return; }

                var overlay = document.createElement('div');
                overlay.className = 'tp-onboard-overlay';
                overlay.innerHTML = ''
                    + '<div class="tp-onboard-bubble">'
                    + '  <div class="tp-onboard-text">' + text + '</div>'
                    + '  <button class="tp-onboard-dismiss">知道了</button>'
                    + '</div>';

                document.body.appendChild(overlay);
                requestAnimationFrame(function() { overlay.classList.add('tp-onboard-visible'); });

                overlay.querySelector('.tp-onboard-dismiss').addEventListener('click', function() {
                    var setData = {};
                    setData[storageKey] = true;
                    chrome.storage.local.set(setData);
                    overlay.classList.remove('tp-onboard-visible');
                    setTimeout(function() { overlay.remove(); resolve(true); }, 300);
                });

                // Also dismiss on overlay background click
                overlay.addEventListener('click', function(e) {
                    if (e.target === overlay) {
                        overlay.querySelector('.tp-onboard-dismiss').click();
                    }
                });
            });
        });
    }

    // Inject styles once
    var style = document.createElement('style');
    style.textContent = ''
        + '.tp-onboard-overlay {'
        + '  position: fixed; top: 0; left: 0; right: 0; bottom: 0;'
        + '  background: rgba(0,0,0,0.5); z-index: 10000;'
        + '  display: flex; align-items: center; justify-content: center;'
        + '  opacity: 0; transition: opacity 0.3s;'
        + '}'
        + '.tp-onboard-overlay.tp-onboard-visible { opacity: 1; }'
        + '.tp-onboard-bubble {'
        + '  background: #2c2c2e; border: 1px solid #3a3a3c;'
        + '  border-radius: 12px; padding: 20px 24px;'
        + '  max-width: 320px; text-align: center;'
        + '  box-shadow: 0 8px 32px rgba(0,0,0,0.4);'
        + '  transform: translateY(10px); transition: transform 0.3s;'
        + '}'
        + '.tp-onboard-visible .tp-onboard-bubble { transform: translateY(0); }'
        + '.tp-onboard-text {'
        + '  font-size: 14px; color: #e0e0e0; line-height: 1.5;'
        + '  margin-bottom: 16px;'
        + '}'
        + '.tp-onboard-dismiss {'
        + '  padding: 6px 20px; font-size: 13px; font-weight: 600;'
        + '  color: #fff; background: #0a84ff; border: none;'
        + '  border-radius: 6px; cursor: pointer;'
        + '}';
    document.head.appendChild(style);

    TPP.createOnboarding = function() {
        return {
            showDragHint: function() {
                return showHint(HINT_KEYS.drag, '左键拖拽可平移画布');
            },
            showZoomHint: function() {
                return showHint(HINT_KEYS.zoom, '滚轮缩放，或使用底部缩放控件');
            },
            showResolutionHint: function(w, h) {
                var text = '原始分辨率 ' + w + ' x ' + h + '<br>录像按候选人实际屏幕尺寸播放';
                return showHint(HINT_KEYS.resolution, text);
            }
        };
    };
})();
