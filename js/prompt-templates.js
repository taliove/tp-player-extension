// Teleport RDP Web Player — Prompt Templates
TPP.createPromptTemplates = function() {
    var STORAGE_KEY = 'tp_ai_templates';

    var SYSTEM_PROMPT = '你是一个技术面试评审专家。你将看到一组来自候选人远程桌面操作录像的关键帧截图，'
        + '每张标注了时间戳。候选人在 Windows 桌面上使用 IDE 完成编程题目。'
        + '请严格按照指定的 JSON 格式输出分析结果。';

    var OUTPUT_FORMAT = '\n\n请严格按以下 JSON 格式输出（不要输出其他内容）：\n'
        + '```json\n'
        + '{\n'
        + '  "summary": "一句话总结",\n'
        + '  "score": "A/B+/B/C+/C/D",\n'
        + '  "test_result": {\n'
        + '    "passed": 0, "total": 0,\n'
        + '    "timestamp_sec": 0,\n'
        + '    "confidence": "high/medium/low"\n'
        + '  },\n'
        + '  "timeline": [\n'
        + '    { "timestamp_sec": 0, "activity": "活动描述", "detail": "详细说明" }\n'
        + '  ],\n'
        + '  "dimensions": [\n'
        + '    {\n'
        + '      "name": "维度名",\n'
        + '      "stars": 4,\n'
        + '      "comment": "评价",\n'
        + '      "evidence_timestamps": [200, 1350]\n'
        + '    }\n'
        + '  ],\n'
        + '  "recommendation": "通过/待定/不通过",\n'
        + '  "conclusion": "综合评述",\n'
        + '  "need_more_frames": [\n'
        + '    { "time_range": [1520, 1580], "reason": "原因" }\n'
        + '  ]\n'
        + '}\n'
        + '```';

    var BUILTIN = {
        backend: {
            name: '后端开发',
            focus: '请重点评估：架构设计能力、设计模式运用、异常处理完备性、代码可维护性、单元测试通过率。',
            builtin: true
        },
        bigdata: {
            name: '大数据开发',
            focus: '请重点评估：Spark/Flink API 使用正确性、数据处理思路清晰度、性能意识、SQL 编写能力。',
            builtin: true
        },
        qa: {
            name: '测试开发',
            focus: '请重点评估：用例设计覆盖度、边界条件考虑、自动化脚本质量、测试框架使用熟练度。',
            builtin: true
        },
        devops: {
            name: '运维开发',
            focus: '请重点评估：脚本编写规范性、问题排查思路、工具链熟练度、自动化意识。',
            builtin: true
        }
    };

    function loadCustom() {
        return TPP.extBridge.storageGet(STORAGE_KEY).then(function(result) {
            return result[STORAGE_KEY] || {};
        });
    }

    function saveCustom(templates) {
        var data = {};
        data[STORAGE_KEY] = templates;
        return TPP.extBridge.storageSet({ data: data });
    }

    function getAll() {
        return loadCustom().then(function(custom) {
            var all = Object.assign({}, BUILTIN);
            var keys = Object.keys(custom);
            for (var i = 0; i < keys.length; i++) {
                all[keys[i]] = custom[keys[i]];
            }
            return all;
        });
    }

    function addCustom(id, name, focus) {
        return loadCustom().then(function(custom) {
            var updated = Object.assign({}, custom);
            updated[id] = { name: name, focus: focus, builtin: false };
            return saveCustom(updated).then(function() { return updated[id]; });
        });
    }

    function removeCustom(id) {
        return loadCustom().then(function(custom) {
            var updated = Object.assign({}, custom);
            delete updated[id];
            return saveCustom(updated);
        });
    }

    function buildPrompt(templateId, isRound2, round1Summary) {
        return getAll().then(function(all) {
            var tpl = all[templateId] || all['backend'];
            var prompt = '以下是候选人远程桌面操作录像的关键帧截图，按时间顺序排列。\n\n' + tpl.focus;
            if (isRound2 && round1Summary) {
                prompt += '\n\n以下是第一轮分析的结果摘要，请结合补充帧完善分析：\n' + round1Summary;
                prompt += '\n\n本轮不需要输出 need_more_frames 字段。';
            }
            prompt += OUTPUT_FORMAT;
            return prompt;
        });
    }

    return {
        getAll: getAll,
        addCustom: addCustom,
        removeCustom: removeCustom,
        buildPrompt: buildPrompt,
        SYSTEM_PROMPT: SYSTEM_PROMPT,
        BUILTIN: BUILTIN
    };
};
