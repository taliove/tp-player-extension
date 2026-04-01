// Teleport Web Player — Background Service Worker
// VL API proxy: relays requests from content script to external VL APIs
// Supports both Anthropic Claude API and OpenAI-compatible API

// Debug: run testAPI('endpoint', 'key', 'model') in service worker console
self.testAPI = function(endpoint, key, model) {
    console.log('[BG] Testing:', endpoint, model);
    callClaude(
        { endpoint: endpoint, apiKey: key, model: model || 'claude-sonnet-4-6' },
        [], 'say hi', '', 30000
    ).then(function(r) { console.log('[BG] OK:', r.text); })
     .catch(function(e) { console.error('[BG] FAIL:', e.message); });
};

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.type !== 'vl-analyze') return false;
    console.log('[BG] Received vl-analyze, protocol:', message.payload.config.protocol,
        'endpoint:', message.payload.config.endpoint,
        'images:', message.payload.images.length);
    handleAnalyze(message.payload).then(function(result) {
        console.log('[BG] Success, response length:', result.text.length);
        sendResponse({ success: true, data: result });
    }).catch(function(err) {
        console.error('[BG] Error:', err.message);
        sendResponse({ success: false, error: err.message });
    });
    return true; // keep message channel open for async response
});

function handleAnalyze(payload) {
    var config = payload.config;
    var images = payload.images;
    var prompt = payload.prompt;
    var systemPrompt = payload.systemPrompt || '';
    var timeoutMs = config.timeoutMs || 120000;

    if (config.protocol === 'claude') {
        return callClaude(config, images, prompt, systemPrompt, timeoutMs);
    } else {
        return callOpenAI(config, images, prompt, systemPrompt, timeoutMs);
    }
}

function callClaude(config, images, prompt, systemPrompt, timeoutMs) {
    var content = [];
    for (var i = 0; i < images.length; i++) {
        content.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: images[i].base64
            }
        });
        content.push({
            type: 'text',
            text: '[' + formatTimestamp(images[i].timestamp_sec) + '] ' + (images[i].label || '')
        });
    }
    content.push({ type: 'text', text: prompt });

    var body = {
        model: config.model || 'claude-sonnet-4-6-20250514',
        max_tokens: 8192,
        messages: [{ role: 'user', content: content }]
    };
    if (systemPrompt) {
        body.system = systemPrompt;
    }

    var endpoint = config.endpoint.replace(/\/+$/, '');
    if (endpoint.indexOf('/v1/messages') === -1) {
        endpoint += '/v1/messages';
    }

    return fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
    }, timeoutMs).then(function(resp) {
        if (!resp.ok) {
            return resp.text().then(function(text) {
                throw new Error('Claude API ' + resp.status + ': ' + text);
            });
        }
        return resp.json();
    }).then(function(data) {
        var text = '';
        for (var i = 0; i < data.content.length; i++) {
            if (data.content[i].type === 'text') text += data.content[i].text;
        }
        return {
            text: text,
            usage: data.usage
        };
    });
}

function callOpenAI(config, images, prompt, systemPrompt, timeoutMs) {
    var content = [];
    for (var i = 0; i < images.length; i++) {
        content.push({
            type: 'image_url',
            image_url: {
                url: 'data:image/jpeg;base64,' + images[i].base64,
                detail: 'high'
            }
        });
        content.push({
            type: 'text',
            text: '[' + formatTimestamp(images[i].timestamp_sec) + '] ' + (images[i].label || '')
        });
    }
    content.push({ type: 'text', text: prompt });

    var messages = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: content });

    var body = {
        model: config.model || 'gpt-4o',
        max_tokens: 8192,
        messages: messages
    };

    var endpoint = config.endpoint.replace(/\/+$/, '');
    if (endpoint.indexOf('/v1/chat/completions') === -1) {
        endpoint += '/v1/chat/completions';
    }

    return fetchWithTimeout(endpoint, {
            'Authorization': 'Bearer ' + config.apiKey
        },
        body: JSON.stringify(body)
    }, timeoutMs).then(function(resp) {
        if (!resp.ok) {
            return resp.text().then(function(text) {
                throw new Error('OpenAI API ' + resp.status + ': ' + text);
            });
        }
        return resp.json();
    }).then(function(data) {
        return {
            text: data.choices[0].message.content,
            usage: data.usage
        };
    });
}

function fetchWithTimeout(url, options, timeoutMs) {
    var bodySize = options.body ? (options.body.length / 1024 / 1024).toFixed(1) : '0';
    console.log('[BG] Fetching:', url, 'body:', bodySize + 'MB', 'timeout:', timeoutMs + 'ms');
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
    options.signal = controller.signal;
    return fetch(url, options).then(function(resp) {
        clearTimeout(timer);
        console.log('[BG] Response status:', resp.status);
        return resp;
    }).catch(function(err) {
        clearTimeout(timer);
        console.error('[BG] Fetch error:', err.name, err.message);
        if (err.name === 'AbortError') throw new Error('API request timeout (' + (timeoutMs / 1000) + 's)');
        throw err;
    });
}

function formatTimestamp(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
