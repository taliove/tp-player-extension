// Teleport RDP Web Player — AI Settings Manager
TPP.createAISettings = function() {
    var STORAGE_KEY = 'tp_ai_settings';

    var defaults = {
        protocol: 'claude',
        endpoint: 'https://api.anthropic.com',
        apiKey: '',
        model: 'claude-sonnet-4-6',
        autoAnalyze: false,
        apiTimeoutSec: 60
    };

    function load() {
        return TPP.extBridge.storageGet(STORAGE_KEY).then(function(result) {
            var saved = result[STORAGE_KEY];
            var merged = Object.assign({}, defaults, saved || {});
            // Remove deprecated fields from stored data
            delete merged.currentTemplate;
            delete merged.maxFrames;
            delete merged.endSegmentMinutes;
            delete merged.skipStartSec;
            return merged;
        });
    }

    function save(settings) {
        var data = {};
        data[STORAGE_KEY] = settings;
        return TPP.extBridge.storageSet(data);
    }

    function update(partial) {
        return load().then(function(current) {
            var merged = Object.assign({}, current, partial);
            return save(merged).then(function() { return merged; });
        });
    }

    function importFromJSON(jsonString) {
        try {
            var parsed = JSON.parse(jsonString);
        } catch (e) {
            throw new Error('Invalid JSON format');
        }
        var imported = {};
        if (parsed.apiKey) imported.apiKey = parsed.apiKey;
        if (parsed.model) imported.model = parsed.model;
        if (parsed.endpoint) imported.endpoint = parsed.endpoint;
        if (parsed.protocol) imported.protocol = parsed.protocol;
        return imported;
    }

    function testConnection(settings) {
        var endpoint = (settings.endpoint || '').replace(/\/+$/, '');
        if (settings.protocol === 'openai') {
            if (endpoint.indexOf('/v1/chat/completions') === -1) endpoint += '/v1/chat/completions';
        } else {
            if (endpoint.indexOf('/v1/messages') === -1) endpoint += '/v1/messages';
        }

        var headers, body;
        if (settings.protocol === 'openai') {
            headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey };
            body = JSON.stringify({ model: settings.model || 'gpt-4o', max_tokens: 50,
                messages: [{ role: 'user', content: 'say OK' }] });
        } else {
            headers = { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' };
            body = JSON.stringify({ model: settings.model || 'claude-sonnet-4-6', max_tokens: 50,
                messages: [{ role: 'user', content: 'say OK' }] });
        }

        return TPP.extBridge.fetchProxy(endpoint, {
            method: 'POST', headers: headers, body: body
        }, 30000).then(function(resp) {
            if (resp && resp.error) throw new Error(resp.error);
            if (!resp || !resp.ok) throw new Error('HTTP ' + (resp ? resp.status : '?') + ': ' + (resp ? resp.text : ''));
            return { success: true, model: settings.model };
        });
    }

    return {
        load: load,
        save: save,
        update: update,
        importFromJSON: importFromJSON,
        testConnection: testConnection,
        defaults: defaults
    };
};
