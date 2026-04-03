// Teleport RDP Web Player — AI Analyzer (Three-Layer Progressive Analysis)
TPP.createAIAnalyzer = function(opts) {
    var header = opts.header;
    var keyframes = opts.keyframes;
    var allPackets = opts.allPackets;
    var aiSettings = opts.settings;
    var templates = opts.templates;
    var reportCache = opts.reportCache;
    var rid = opts.rid;
    var onProgress = opts.onProgress || function() {};
    var onPhaseReady = opts.onPhaseReady || function() {};
    var cancelled = false;

    var screenWidth = header.width;
    var screenHeight = header.height;

    // --- Frame capture infrastructure ---

    function processPacketToCanvas(pkt, ctx, cache) {
        var dv = new DataView(pkt.buffer);
        try {
            if (pkt.type === TPP.TYPE_RDP_IMAGE) {
                var images = TPP.parseImagePayload(dv, pkt.payloadOffset, pkt.size);
                for (var i = 0; i < images.length; i++) {
                    var img = images[i];
                    if (img.format === TPP.RDP_IMG_ALT) {
                        var cached = cache.get(img.cacheIndex);
                        if (cached) {
                            ctx.putImageData(
                                new ImageData(cached.rgba, cached.width, cached.height),
                                img.destLeft, img.destTop
                            );
                        }
                    } else {
                        var decoded = TPP.decodeImageTile(img);
                        if (decoded) {
                            var destW = img.destRight - img.destLeft + 1;
                            var destH = img.destBottom - img.destTop + 1;
                            cache.push({ rgba: decoded.rgba, width: destW, height: destH });
                            ctx.putImageData(
                                new ImageData(decoded.rgba, destW, destH),
                                img.destLeft, img.destTop
                            );
                        }
                    }
                }
            } else if (pkt.type === TPP.TYPE_RDP_KEYFRAME) {
                cache.clear();
                var kf = TPP.parseKeyframePayload(dv, pkt.payloadOffset, pkt.size);
                var rgba = TPP.decodeKeyframe(kf.data, screenWidth, screenHeight);
                ctx.putImageData(new ImageData(rgba, screenWidth, screenHeight), 0, 0);
            }
        } catch (err) {
            console.warn('[AI] Packet decode error at', pkt.timeMs + 'ms:', err);
        }
    }

    function blobToBase64(blob) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function() { resolve(reader.result.split(',')[1]); };
            reader.onerror = function() { reject(reader.error || new Error('FileReader failed')); };
            reader.readAsDataURL(blob);
        });
    }

    function batchCapture(samplePoints, progressLabel) {
        if (samplePoints.length === 0) return Promise.resolve([]);

        var sorted = samplePoints.slice().sort(function(a, b) {
            return a.timestampSec - b.timestampSec;
        });

        var offCanvas = new OffscreenCanvas(screenWidth, screenHeight);
        var offCtx = offCanvas.getContext('2d');
        offCtx.fillStyle = '#263f6f';
        offCtx.fillRect(0, 0, screenWidth, screenHeight);
        var captureCache = TPP.createImageCache();

        var maxExportW = TPP.AI_EXPORT_MAX_WIDTH || 1024;
        var scale = Math.min(1, maxExportW / screenWidth);
        var exportW = Math.round(screenWidth * scale);
        var exportH = Math.round(screenHeight * scale);
        var exportCanvas = (scale < 1) ? new OffscreenCanvas(exportW, exportH) : null;
        var exportCtx = exportCanvas ? exportCanvas.getContext('2d') : null;

        var results = [];
        var packetIdx = 0;

        var firstTargetMs = sorted[0].timestampSec * 1000;
        for (var k = keyframes.length - 1; k >= 0; k--) {
            if (keyframes[k].timeMs <= firstTargetMs) {
                var kfTimeMs = keyframes[k].timeMs;
                var lo = 0, hi = allPackets.length;
                while (lo < hi) {
                    var mid = (lo + hi) >>> 1;
                    if (allPackets[mid].timeMs < kfTimeMs) lo = mid + 1; else hi = mid;
                }
                packetIdx = lo;
                break;
            }
        }

        var frameIdx = 0;
        var total = sorted.length;

        function captureNext() {
            if (cancelled) return Promise.reject(new Error('已取消'));
            if (frameIdx >= total) return Promise.resolve(results);

            var point = sorted[frameIdx];
            var targetMs = point.timestampSec * 1000;

            while (packetIdx < allPackets.length && allPackets[packetIdx].timeMs <= targetMs) {
                processPacketToCanvas(allPackets[packetIdx], offCtx, captureCache);
                packetIdx++;
            }

            if (progressLabel) {
                onProgress(progressLabel, frameIdx + 1, total);
            }

            var blobCanvas;
            if (exportCanvas) {
                exportCtx.drawImage(offCanvas, 0, 0, exportW, exportH);
                blobCanvas = exportCanvas;
            } else {
                blobCanvas = offCanvas;
            }

            return blobCanvas.convertToBlob({ type: 'image/jpeg', quality: TPP.AI_JPEG_QUALITY || 0.6 }).then(function(blob) {
                return blobToBase64(blob);
            }).then(function(base64) {
                results.push({
                    base64: base64,
                    timestamp_sec: point.timestampSec,
                    label: point.label || ''
                });
                frameIdx++;
                return new Promise(function(resolve) {
                    setTimeout(function() { resolve(captureNext()); }, 0);
                });
            });
        }

        return captureNext();
    }

    // --- API call infrastructure ---

    function formatTs(sec) {
        var m = Math.floor(sec / 60), s = sec % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function buildRequestBody(images, prompt, systemPrompt, settings) {
        if (settings.protocol === 'openai') {
            var content = [];
            for (var i = 0; i < images.length; i++) {
                content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + images[i].base64, detail: 'high' } });
                content.push({ type: 'text', text: '[' + formatTs(images[i].timestamp_sec) + '] ' + (images[i].label || '') });
            }
            content.push({ type: 'text', text: prompt });
            var msgs = [];
            if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
            msgs.push({ role: 'user', content: content });
            return { body: JSON.stringify({ model: settings.model, max_tokens: 8192, messages: msgs }),
                     headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey } };
        }
        var content = [];
        for (var i = 0; i < images.length; i++) {
            content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: images[i].base64 } });
            content.push({ type: 'text', text: '[' + formatTs(images[i].timestamp_sec) + '] ' + (images[i].label || '') });
        }
        content.push({ type: 'text', text: prompt });
        var body = { model: settings.model || 'claude-sonnet-4-6', max_tokens: 8192, messages: [{ role: 'user', content: content }] };
        if (systemPrompt) body.system = systemPrompt;
        return { body: JSON.stringify(body),
                 headers: { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' } };
    }

    function parseAPIResponse(text, protocol) {
        var data = JSON.parse(text);
        if (protocol === 'openai') {
            return { text: data.choices[0].message.content, usage: data.usage };
        }
        var t = '';
        for (var i = 0; i < data.content.length; i++) {
            if (data.content[i].type === 'text') t += data.content[i].text;
        }
        return { text: t, usage: data.usage };
    }

    function parseVLResponse(text) {
        var jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
        var jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            var braceMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (braceMatch) {
                try {
                    return JSON.parse(braceMatch[0]);
                } catch (e2) {
                    throw new Error('AI 返回的 JSON 解析失败: ' + e2.message);
                }
            }
            throw new Error('AI 返回内容不包含有效 JSON');
        }
    }

    function callVL(images, prompt, systemPrompt, settings) {
        var apiTimeoutMs = (settings.apiTimeoutSec || 60) * 1000;
        var endpoint = (settings.endpoint || '').replace(/\/+$/, '');
        if (settings.protocol === 'claude' && endpoint.indexOf('/v1/messages') === -1) {
            endpoint += '/v1/messages';
        } else if (settings.protocol === 'openai' && endpoint.indexOf('/v1/chat/completions') === -1) {
            endpoint += '/v1/chat/completions';
        }

        var req = buildRequestBody(images, prompt, systemPrompt, settings);
        console.log('[AI] callVL: images:', images.length, 'body:', (req.body.length / 1024 / 1024).toFixed(1) + 'MB');

        return TPP.extBridge.fetchProxy(endpoint, {
            method: 'POST',
            headers: req.headers,
            body: req.body
        }, apiTimeoutMs).then(function(resp) {
            if (resp && resp.error) throw new Error(resp.error);
            if (!resp || !resp.ok) {
                throw new Error('API ' + (resp ? resp.status : '?') + ': ' + (resp ? resp.text : 'no response'));
            }
            return parseAPIResponse(resp.text, settings.protocol);
        });
    }

    // --- L1: Coarse Scan ---

    function computeL1SamplePoints(totalMs) {
        var frameCount = TPP.AI_L1_FRAMES;
        var skipMs = totalMs * TPP.AI_SKIP_RATIO;
        var effectiveMs = totalMs - skipMs;
        var interval = effectiveMs / (frameCount + 1);
        var points = [];

        for (var i = 1; i <= frameCount; i++) {
            var timeMs = skipMs + interval * i;
            var sec = Math.round(timeMs / 1000);
            points.push({ timestampSec: sec, label: 'L1采样' });
        }
        return points;
    }

    function runL1(settings) {
        var totalMs = header.timeMs;
        var samplePoints = computeL1SamplePoints(totalMs);

        onProgress('l1_capture', 0, samplePoints.length);
        return batchCapture(samplePoints, 'l1_capture').then(function(frames) {
            if (cancelled) throw new Error('已取消');
            onProgress('l1_analyze', 0, 0);

            var prompt = templates.buildL1Prompt(frames.length, Math.round(totalMs / 1000));
            return callVL(frames, prompt, templates.SYSTEM_PROMPT, settings).then(function(vlResult) {
                var result = parseVLResponse(vlResult.text);
                result._usage = vlResult.usage;
                result._frames = frames.length;
                return result;
            });
        });
    }

    // --- L2: Focused Analysis (per phase, concurrent) ---

    function computeL2SamplePoints(phase) {
        var maxFrames = TPP.AI_L2_FRAMES_PER_PHASE;
        var startSec = phase.start_sec;
        var endSec = phase.end_sec;
        var durationSec = endSec - startSec;
        var points = [];

        if (durationSec <= 0) return points;

        points.push({ timestampSec: startSec, label: '阶段开始' });
        points.push({ timestampSec: endSec, label: '阶段结束' });

        var middleCount = Math.min(maxFrames - 2, 3);
        if (middleCount > 0 && durationSec > 10) {
            var interval = durationSec / (middleCount + 1);
            for (var i = 1; i <= middleCount; i++) {
                var sec = Math.round(startSec + interval * i);
                points.push({ timestampSec: sec, label: '阶段中间' });
            }
        }

        points.sort(function(a, b) { return a.timestampSec - b.timestampSec; });
        return points;
    }

    function runL2Phase(phaseIndex, phase, l1Result, l1Summary, settings) {
        var samplePoints = computeL2SamplePoints(phase);
        if (samplePoints.length === 0) {
            return Promise.resolve({ phase_name: phase.name, evaluation: '阶段时长过短，无法分析', dimensions: [] });
        }

        onPhaseReady(phaseIndex, 'analyzing');

        return batchCapture(samplePoints, null).then(function(frames) {
            if (cancelled) throw new Error('已取消');

            var prompt = templates.buildL2Prompt(
                l1Summary,
                phase.name,
                phase.start_sec,
                phase.end_sec,
                frames.length
            );
            return callVL(frames, prompt, templates.SYSTEM_PROMPT, settings);
        }).then(function(vlResult) {
            var result = parseVLResponse(vlResult.text);
            result._usage = vlResult.usage;
            return result;
        });
    }

    function runL2(l1Result, settings) {
        var phases = l1Result.phases || [];
        if (phases.length === 0) return Promise.resolve([]);

        var l1Summary = templates.buildL1Summary(l1Result);
        var maxConcurrent = TPP.AI_MAX_CONCURRENT;
        var results = new Array(phases.length);
        var nextIndex = 0;
        var activeCount = 0;
        var resolveAll, rejectAll;
        var settled = false;

        return new Promise(function(resolve, reject) {
            resolveAll = resolve;
            rejectAll = reject;

            function onPhaseComplete(index, result) {
                if (settled) return;
                results[index] = result;
                activeCount--;
                onPhaseReady(index, 'done', result);
                startNext();
            }

            function onPhaseError(index, err) {
                if (settled) return;
                if (err.message === '已取消') {
                    settled = true;
                    rejectAll(err);
                    return;
                }
                results[index] = { phase_name: (phases[index] || {}).name, _error: err.message, evaluation: '', dimensions: [] };
                activeCount--;
                onPhaseReady(index, 'error', null, err.message);
                startNext();
            }

            function startNext() {
                while (activeCount < maxConcurrent && nextIndex < phases.length) {
                    (function(idx) {
                        activeCount++;
                        onProgress('l2_phase', idx + 1, phases.length);
                        runL2Phase(idx, phases[idx], l1Result, l1Summary, settings)
                            .then(function(result) { onPhaseComplete(idx, result); })
                            .catch(function(err) { onPhaseError(idx, err); });
                    })(nextIndex);
                    nextIndex++;
                }

                if (activeCount === 0 && nextIndex >= phases.length) {
                    settled = true;
                    resolveAll(results);
                }
            }

            startNext();
        });
    }

    // --- L3: Targeted Deep Check ---

    function computeL3SamplePoints(startSec, endSec) {
        var maxFrames = TPP.AI_L3_FRAMES_PER_CHECK;
        var durationSec = endSec - startSec;
        var points = [];

        if (durationSec <= 0) return points;

        var interval = durationSec / (maxFrames + 1);
        for (var i = 1; i <= maxFrames; i++) {
            var sec = Math.round(startSec + interval * i);
            points.push({ timestampSec: sec, label: '深度检查' });
        }
        return points;
    }

    function runL3Check(check, phaseIndex, l1Summary, l2Evaluation, settings) {
        var startSec = check.time_range[0];
        var endSec = check.time_range[1];
        var samplePoints = computeL3SamplePoints(startSec, endSec);
        if (samplePoints.length === 0) return Promise.resolve(null);

        return batchCapture(samplePoints, null).then(function(frames) {
            if (cancelled) throw new Error('已取消');

            var prompt = templates.buildL3Prompt(
                l1Summary,
                l2Evaluation,
                startSec,
                endSec,
                check.reason
            );
            return callVL(frames, prompt, templates.SYSTEM_PROMPT, settings);
        }).then(function(vlResult) {
            var result = parseVLResponse(vlResult.text);
            result._usage = vlResult.usage;
            result._phaseIndex = phaseIndex;
            return result;
        });
    }

    function runL3(l1Result, l2Results, settings) {
        var l1Summary = templates.buildL1Summary(l1Result);
        var checks = [];

        for (var i = 0; i < l2Results.length; i++) {
            var l2 = l2Results[i];
            if (l2 && l2.need_deep_check && l2.need_deep_check.length > 0) {
                for (var j = 0; j < l2.need_deep_check.length; j++) {
                    checks.push({
                        check: l2.need_deep_check[j],
                        phaseIndex: i,
                        l2Evaluation: l2.evaluation || ''
                    });
                }
            }
        }

        if (checks.length === 0) return Promise.resolve([]);

        onProgress('l3_check', 0, checks.length);

        var results = [];
        var chain = Promise.resolve();
        for (var c = 0; c < checks.length; c++) {
            (function(idx) {
                chain = chain.then(function() {
                    if (cancelled) throw new Error('已取消');
                    onProgress('l3_check', idx + 1, checks.length);
                    return runL3Check(
                        checks[idx].check,
                        checks[idx].phaseIndex,
                        l1Summary,
                        checks[idx].l2Evaluation,
                        settings
                    ).then(function(result) {
                        if (result) results.push(result);
                    });
                });
            })(c);
        }

        return chain.then(function() { return results; });
    }

    // --- Assemble final report ---

    function assembleReport(l1Result, l2Results, l3Results, totalTokens, durationMs) {
        var phases = l1Result.phases || [];
        var phaseCards = [];

        for (var i = 0; i < phases.length; i++) {
            var phase = phases[i];
            var l2 = l2Results[i] || {};
            var card = {
                name: phase.name,
                start_sec: phase.start_sec,
                end_sec: phase.end_sec,
                summary: phase.summary || '',
                evaluation: l2.evaluation || '',
                dimensions: l2.dimensions || [],
                suspicious: l2.suspicious || null,
                status: l2._error ? 'error' : 'done',
                error: l2._error || null
            };

            if (l3Results) {
                for (var j = 0; j < l3Results.length; j++) {
                    if (l3Results[j]._phaseIndex === i) {
                        card.deep_check = l3Results[j];
                        if (l3Results[j].confirmed) {
                            card.status = 'warning';
                        }
                    }
                }
            }

            if (l2.phase_score_adjustment) {
                card.score_adjustment = l2.phase_score_adjustment;
            }

            phaseCards.push(card);
        }

        // Aggregate dimensions across phases
        var dimMap = {};
        for (var p = 0; p < phaseCards.length; p++) {
            var dims = phaseCards[p].dimensions || [];
            for (var d = 0; d < dims.length; d++) {
                var dim = dims[d];
                if (!dimMap[dim.name]) {
                    dimMap[dim.name] = { totalStars: 0, count: 0, comments: [], evidence: [] };
                }
                dimMap[dim.name].totalStars += dim.stars || 0;
                dimMap[dim.name].count++;
                if (dim.comment) dimMap[dim.name].comments.push(dim.comment);
                if (dim.evidence_timestamps) {
                    for (var e = 0; e < dim.evidence_timestamps.length; e++) {
                        dimMap[dim.name].evidence.push(dim.evidence_timestamps[e]);
                    }
                }
            }
        }

        var aggregatedDimensions = [];
        var dimNames = Object.keys(dimMap);
        for (var dn = 0; dn < dimNames.length; dn++) {
            var name = dimNames[dn];
            var dd = dimMap[name];
            aggregatedDimensions.push({
                name: name,
                stars: Math.round(dd.totalStars / dd.count),
                comment: dd.comments.join('; '),
                evidence_timestamps: dd.evidence
            });
        }

        var finalScore = l1Result.score || '-';
        for (var s = 0; s < phaseCards.length; s++) {
            if (phaseCards[s].score_adjustment && phaseCards[s].score_adjustment.new_score) {
                finalScore = phaseCards[s].score_adjustment.new_score;
            }
        }

        var hasWarnings = false;
        for (var w = 0; w < phaseCards.length; w++) {
            if (phaseCards[w].status === 'warning') { hasWarnings = true; break; }
        }
        var recommendation = '通过';
        if (finalScore === 'D' || finalScore === 'C') recommendation = '不通过';
        else if (finalScore === 'C+' || hasWarnings) recommendation = '待定';

        var totalFrames = (l1Result._frames || 0);
        for (var tf = 0; tf < l2Results.length; tf++) {
            totalFrames += (l2Results[tf] && !l2Results[tf]._error) ? TPP.AI_L2_FRAMES_PER_PHASE : 0;
        }

        return {
            topic: l1Result.topic || '',
            tech_stack: l1Result.tech_stack || [],
            score: finalScore,
            summary: l1Result.summary || '',
            recommendation: recommendation,
            dimensions: aggregatedDimensions,
            phases: phaseCards,
            _meta: {
                model: null,
                tokens: totalTokens,
                durationMs: durationMs,
                frames: totalFrames,
                timestamp: new Date().toISOString()
            }
        };
    }

    // --- Main orchestration ---

    function runAnalysis() {
        cancelled = false;
        var settings;
        var totalTokens = { input: 0, output: 0 };
        var analysisStartTime = Date.now();
        var l1Result, l2Results, l3Results;

        function addTokens(usage) {
            if (!usage) return;
            totalTokens.input += usage.input_tokens || usage.prompt_tokens || 0;
            totalTokens.output += usage.output_tokens || usage.completion_tokens || 0;
        }

        onProgress('loading', 0, 0);

        return aiSettings.load().then(function(s) {
            settings = s;
            if (!s.apiKey) throw new Error('请先配置 API Key');
        }).catch(function(err) {
            if (err.message && err.message.indexOf('invalidated') >= 0) {
                throw new Error('扩展已重新加载，请刷新页面');
            }
            throw err;
        }).then(function() {
            return runL1(settings);
        }).then(function(result) {
            if (cancelled) throw new Error('已取消');
            l1Result = result;
            addTokens(result._usage);

            onProgress('l1_done', 0, 0);
            onPhaseReady(-1, 'skeleton', l1Result);

            return runL2(l1Result, settings);
        }).then(function(results) {
            if (cancelled) throw new Error('已取消');
            l2Results = results;
            for (var i = 0; i < results.length; i++) {
                if (results[i] && results[i]._usage) addTokens(results[i]._usage);
            }

            return runL3(l1Result, l2Results, settings);
        }).then(function(results) {
            if (cancelled) throw new Error('已取消');
            l3Results = results;
            for (var i = 0; i < results.length; i++) {
                if (results[i] && results[i]._usage) addTokens(results[i]._usage);
            }

            if (l3Results.length > 0) {
                for (var j = 0; j < l3Results.length; j++) {
                    var l3 = l3Results[j];
                    if (l3._phaseIndex !== undefined) {
                        onPhaseReady(l3._phaseIndex, l3.confirmed ? 'warning' : 'done');
                    }
                }
            }

            var durationMs = Date.now() - analysisStartTime;
            var report = assembleReport(l1Result, l2Results, l3Results, totalTokens, durationMs);
            report._meta.model = settings.model;

            onProgress('saving', 0, 0);
            return reportCache.put(rid, report).then(function() {
                onProgress('done', 0, 0);
                return report;
            }).catch(function(err) {
                console.warn('[AI] Failed to cache report:', err.message);
                onProgress('done', 0, 0);
                return report;
            });
        });
    }

    function retryPhase(phaseIndex, l1Result, settings) {
        var phases = l1Result.phases || [];
        var phase = phases[phaseIndex];
        if (!phase) return Promise.reject(new Error('Invalid phase index'));

        var l1Summary = templates.buildL1Summary(l1Result);
        return runL2Phase(phaseIndex, phase, l1Result, l1Summary, settings);
    }

    return {
        runAnalysis: runAnalysis,
        retryPhase: retryPhase,
        cancel: function() { cancelled = true; }
    };
};
