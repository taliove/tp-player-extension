// Teleport RDP Web Player — Prompt Templates (Three-Layer Architecture)
TPP.createPromptTemplates = function() {

    var SYSTEM_PROMPT = '你是一个技术面试录像评审专家。'
        + '你将看到来自候选人远程桌面操作录像的关键帧截图。'
        + '请根据画面内容自动识别考试题目和技术栈。'
        + '仅基于可见证据进行评估——不要猜测未见内容。'
        + '请严格按照指定的 JSON 格式输出分析结果。';

    function formatTs(sec) {
        var m = Math.floor(sec / 60), s = sec % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function buildL1Prompt(frameCount, durationSec) {
        var durationStr = formatTs(durationSec);
        return '以下是一段 ' + durationStr + ' 录像中均匀采样的 ' + frameCount + ' 帧截图。\n'
            + '[截图按时间顺序排列，每张标注了 MM:SS 时间戳]\n\n'
            + '请识别并输出 JSON：\n'
            + '```json\n'
            + '{\n'
            + '  "topic": "候选人正在做什么任务/题目",\n'
            + '  "tech_stack": ["识别到的技术"],\n'
            + '  "phases": [\n'
            + '    {"name": "阶段名", "start_sec": 0, "end_sec": 330, "summary": "一句话描述"}\n'
            + '  ],\n'
            + '  "score": "A/B+/B/C+/C/D",\n'
            + '  "dimensions": ["维度名1", "维度名2", "维度名3"],\n'
            + '  "summary": "一句话总体印象"\n'
            + '}\n'
            + '```\n\n'
            + '要求：\n'
            + '- phases 数量 2-6 个，覆盖整段录像\n'
            + '- dimensions 根据观察到的内容自动生成 3-5 个评估维度（不要使用预设模板）\n'
            + '- score 是初步评分，后续分析可能调整';
    }

    function buildL2Prompt(l1Summary, phaseName, phaseStartSec, phaseEndSec, frameCount) {
        return '上下文：' + l1Summary + '\n\n'
            + '现在分析：阶段 "' + phaseName + '" [' + formatTs(phaseStartSec) + ' - ' + formatTs(phaseEndSec) + ']\n'
            + '以下是该阶段的 ' + frameCount + ' 帧截图。\n'
            + '[截图按时间顺序排列，每张标注了 MM:SS 时间戳]\n\n'
            + '请评估并输出 JSON：\n'
            + '```json\n'
            + '{\n'
            + '  "phase_name": "阶段名",\n'
            + '  "evaluation": "详细质量评估",\n'
            + '  "dimensions": [\n'
            + '    {"name": "维度名", "stars": 4, "comment": "评价", "evidence_timestamps": [200, 350]}\n'
            + '  ],\n'
            + '  "suspicious": null,\n'
            + '  "need_deep_check": null,\n'
            + '  "phase_score_adjustment": null\n'
            + '}\n'
            + '```\n\n'
            + '字段说明：\n'
            + '- dimensions: 对 L1 生成的每个维度评分 (1-5星)，附证据时间戳\n'
            + '- suspicious: 如发现可疑行为，填 {"description": "...", "evidence_timestamps": [...]}\n'
            + '  可疑行为包括：窗口切换、大段代码突然出现（疑似粘贴）、AI工具页面、全选高亮等\n'
            + '- need_deep_check: 如需深入检查某时间段，填 [{"time_range": [start_sec, end_sec], "reason": "..."}]\n'
            + '- phase_score_adjustment: 如需调整评分，填 {"new_score": "B", "reason": "..."}';
    }

    function buildL3Prompt(l1Summary, l2Evaluation, startSec, endSec, reason) {
        return '上下文：' + l1Summary + '\n'
            + '阶段 L2 评估：' + l2Evaluation + '\n\n'
            + '深度检查区域：[' + formatTs(startSec) + ' - ' + formatTs(endSec) + ']，原因：' + reason + '\n'
            + '以下是该区域的密集采帧截图。\n'
            + '[截图按时间顺序排列，每张标注了 MM:SS 时间戳]\n\n'
            + '请确认或排除并输出 JSON：\n'
            + '```json\n'
            + '{\n'
            + '  "confirmed": true,\n'
            + '  "description": "实际发生了什么",\n'
            + '  "evidence": "具体视觉证据",\n'
            + '  "score_impact": null\n'
            + '}\n'
            + '```\n\n'
            + '字段说明：\n'
            + '- confirmed: true=确认可疑行为, false=排除（正常行为）\n'
            + '- score_impact: 如需调分，填 {"adjustment": "维度X -1星", "reason": "..."}';
    }

    function buildL1Summary(l1Result) {
        var summary = '题目: ' + (l1Result.topic || '未知');
        summary += ', 技术栈: ' + (l1Result.tech_stack || []).join(', ');
        summary += ', 初步评分: ' + (l1Result.score || '-');
        summary += ', 阶段: ';
        var phases = l1Result.phases || [];
        for (var i = 0; i < phases.length; i++) {
            summary += phases[i].name + ' [' + formatTs(phases[i].start_sec) + '-' + formatTs(phases[i].end_sec) + ']';
            if (i < phases.length - 1) summary += ', ';
        }
        summary += ', 评估维度: ' + (l1Result.dimensions || []).join(', ');
        return summary;
    }

    return {
        SYSTEM_PROMPT: SYSTEM_PROMPT,
        buildL1Prompt: buildL1Prompt,
        buildL2Prompt: buildL2Prompt,
        buildL3Prompt: buildL3Prompt,
        buildL1Summary: buildL1Summary
    };
};
