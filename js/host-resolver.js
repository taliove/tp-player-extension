// Teleport RDP Web Player — Host Name Resolver
// Fetches host info from Teleport server, parses exam naming convention.
// Naming convention: "停车计费（初中级开发）-2" → { topic, role, index }
TPP.createHostResolver = function(serverBase) {
    var cache = null;
    var loading = null;

    function fetchHosts() {
        if (cache) return Promise.resolve(cache);
        if (loading) return loading;

        loading = fetch(serverBase + '/asset/get-hosts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: ''
        }).then(function(resp) {
            return resp.json();
        }).then(function(data) {
            cache = {};
            if (data.code === 0 && data.data && data.data.data) {
                for (var i = 0; i < data.data.data.length; i++) {
                    var h = data.data.data[i];
                    cache[h.ip] = { id: h.id, name: h.name, desc: h.desc };
                    cache['id_' + h.id] = { id: h.id, name: h.name, desc: h.desc };
                }
            }
            loading = null;
            return cache;
        }).catch(function(err) {
            console.warn('[HostResolver] Failed to fetch hosts:', err);
            loading = null;
            cache = {};
            return cache;
        });

        return loading;
    }

    function resolveByIp(ip) {
        return fetchHosts().then(function(hosts) {
            return hosts[ip] || null;
        });
    }

    function resolveById(hostId) {
        return fetchHosts().then(function(hosts) {
            return hosts['id_' + hostId] || null;
        });
    }

    function parseHostName(name) {
        if (!name) return { topic: '', role: '', index: 0, raw: '' };

        // Match: "停车计费（初中级开发）-2" or "停车计费(初中级开发)-2"
        var match = name.match(/^(.+?)\s*[（(](.+?)[）)]\s*(?:-\s*(\d+))?$/);
        if (match) {
            return {
                topic: match[1].trim(),
                role: match[2].trim(),
                index: parseInt(match[3]) || 0,
                raw: name
            };
        }

        // Fallback: just a name without role info
        var simpleMatch = name.match(/^(.+?)(?:-\s*(\d+))?$/);
        if (simpleMatch) {
            return {
                topic: simpleMatch[1].trim(),
                role: '',
                index: parseInt(simpleMatch[2]) || 0,
                raw: name
            };
        }

        return { topic: name, role: '', index: 0, raw: name };
    }

    // Map role text to prompt template ID
    var ROLE_MAP = [
        { pattern: /大数据/, template: 'bigdata' },
        { pattern: /测试/, template: 'qa' },
        { pattern: /运维/, template: 'devops' },
        { pattern: /Java|java|JAVA/, template: 'backend' },
        { pattern: /前端/, template: 'backend' },
        { pattern: /后端/, template: 'backend' },
        { pattern: /开发/, template: 'backend' }
    ];

    function detectTemplate(role) {
        if (!role) return null;
        for (var i = 0; i < ROLE_MAP.length; i++) {
            if (ROLE_MAP[i].pattern.test(role)) {
                return ROLE_MAP[i].template;
            }
        }
        return null;
    }

    function formatTitle(parsed, username) {
        var parts = [];
        if (parsed.topic) parts.push(parsed.topic);
        if (parsed.role) parts.push(parsed.role);
        if (username) parts.push(username);
        return parts.join(' - ');
    }

    return {
        fetchHosts: fetchHosts,
        resolveByIp: resolveByIp,
        resolveById: resolveById,
        parseHostName: parseHostName,
        detectTemplate: detectTemplate,
        formatTitle: formatTitle
    };
};
