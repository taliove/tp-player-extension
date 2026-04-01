// Teleport RDP Web Player — AI Settings Manager
TPP.createAISettings = function() {
    var STORAGE_KEY = 'tp_ai_settings';

    var defaults = {
        protocol: 'claude',
        endpoint: 'https://api.anthropic.com',
        apiKey: '',
        model: 'claude-sonnet-4-6',
        autoAnalyze: false,
        endSegmentMinutes: 5,
        maxFrames: 80,
        apiTimeoutSec: 120,
        currentTemplate: 'backend'
    };

    function load() {
        return TPP.extBridge.storageGet(STORAGE_KEY).then(function(result) {
            var saved = result[STORAGE_KEY];
            return Object.assign({}, defaults, saved || {});
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
        return TPP.extBridge.sendMessage({
            type: 'vl-analyze',
            payload: {
                config: {
                    protocol: settings.protocol,
                    endpoint: settings.endpoint,
                    apiKey: settings.apiKey,
                    model: settings.model,
                    timeoutMs: 15000
                },
                images: [],
                prompt: 'Reply with just "OK" to confirm connection.',
                systemPrompt: 'You are a connection test assistant.'
            }
        }).then(function(resp) {
            if (!resp.success) throw new Error(resp.error);
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
