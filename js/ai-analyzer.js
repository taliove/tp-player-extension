// Teleport RDP Web Player — AI Analyzer (Frame Sampling + VL Analysis)
TPP.createAIAnalyzer = function(opts) {
    var header = opts.header;
    var keyframes = opts.keyframes;
    var allPackets = opts.allPackets;
    var player = opts.player;
    var aiSettings = opts.settings;
    var templates = opts.templates;
    var reportCache = opts.reportCache;
    var rid = opts.rid;
    var onProgress = opts.onProgress || function() {};
    var cancelled = false;
    var lastSamplePoints = null;

    // --- Activity density scanning ---
    function computeActivityDensity(packets, totalMs) {
        var windowMs = TPP.AI_WINDOW_MS;
        var windowCount = Math.ceil(totalMs / windowMs);
        var density = new Array(windowCount);
        for (var w = 0; w < windowCount; w++) density[w] = 0;

        for (var i = 0; i < packets.length; i++) {
            if (packets[i].type === TPP.TYPE_RDP_IMAGE) {
                var wi = Math.floor(packets[i].timeMs / windowMs);
                if (wi < windowCount) density[wi] += packets[i].size;
            }
        }

        var maxDensity = 0;
        for (var j = 0; j < density.length; j++) {
            if (density[j] > maxDensity) maxDensity = density[j];
        }
        if (maxDensity > 0) {
            for (var k = 0; k < density.length; k++) {
                density[k] = density[k] / maxDensity;
            }
        }
        return density;
    }

    // --- Edge detection ---
    function detectEdges(density) {
        var threshold = TPP.AI_DENSITY_THRESHOLD;
        var windowMs = TPP.AI_WINDOW_MS;
        var edges = [];

        for (var i = 1; i < density.length; i++) {
            var prev = density[i - 1];
            var curr = density[i];
            if (prev < threshold && curr >= threshold) {
                edges.push({ type: 'rising', windowIndex: i, timeMs: i * windowMs });
            } else if (prev >= threshold && curr < threshold) {
                edges.push({ type: 'falling', windowIndex: i, timeMs: i * windowMs });
            }
        }
        return edges;
    }

    // --- Suspicious spike detection (potential copy-paste cheating) ---
    function detectSuspiciousSpikes(density) {
        var windowMs = TPP.AI_WINDOW_MS;
        var spikes = [];
        for (var i = 2; i < density.length; i++) {
            var prevAvg = (density[i - 2] + density[i - 1]) / 2;
            var curr = density[i];
            // Sudden jump from low to very high activity
            if (prevAvg < 0.15 && curr > 0.7) {
                spikes.push({ windowIndex: i, timeMs: i * windowMs });
            }
        }
        return spikes;
    }

    // --- Layer 1 + Layer 3 sample points ---
    function computeSamplePoints(density, edges, totalMs, maxFrames, endSegmentMinutes, skipStartSec, suspiciousSpikes) {
        var points = [];
        var usedSec = {};

        // Smart skip strategy based on video duration
        var totalMin = totalMs / 60000;
        var effectiveSkipSec;
        if (totalMin < 10) {
            effectiveSkipSec = 0; // Short video: don't skip
        } else if (totalMin < 30) {
            effectiveSkipSec = Math.round(totalMs * 0.10 / 1000); // Skip first 10%
        } else {
            effectiveSkipSec = Math.min(skipStartSec || 300, Math.round(totalMs * 0.15 / 1000)); // Skip up to 15% or configured max
        }
        var skipStartMs = effectiveSkipSec * 1000;

        function addPoint(timeMs, label) {
            if (timeMs < skipStartMs && timeMs > 0) return;
            var sec = Math.round(timeMs / 1000);
            if (sec < 0) sec = 0;
            if (sec > Math.floor(totalMs / 1000)) sec = Math.floor(totalMs / 1000);
            if (usedSec[sec]) return;
            usedSec[sec] = true;
            points.push({ timestampSec: sec, label: label });
        }

        // First meaningful frame (after skip period)
        addPoint(skipStartMs, '录像开始');

        // Layer 1: edge-based sampling
        for (var i = 0; i < edges.length; i++) {
            var e = edges[i];
            if (e.type === 'rising') {
                addPoint(e.timeMs, '活动开始');
            } else {
                addPoint(e.timeMs + TPP.AI_EDGE_SETTLE_MS, '活动结束');
            }
        }

        // Suspicious spikes (potential copy-paste): sample before and after
        if (suspiciousSpikes) {
            for (var si = 0; si < suspiciousSpikes.length; si++) {
                var spike = suspiciousSpikes[si];
                addPoint(spike.timeMs - 3000, '可疑活动前');
                addPoint(spike.timeMs, '可疑活动');
                addPoint(spike.timeMs + 5000, '可疑活动后');
            }
        }

        // Layer 1: fallback sampling (every 2.5 min if no edges nearby)
        var fallbackInterval = TPP.AI_FALLBACK_INTERVAL_MS;
        for (var t = fallbackInterval; t < totalMs; t += fallbackInterval) {
            var sec = Math.round(t / 1000);
            if (!usedSec[sec]) {
                addPoint(t, '定期采样');
            }
        }

        // Layer 3: end segment dense sampling
        var endMinMs = (endSegmentMinutes || 5) * 60 * 1000;
        var endDurationMs = Math.max(
            endMinMs,
            totalMs * TPP.AI_END_SEGMENT_RATIO
        );
        var endStartMs = Math.max(0, totalMs - endDurationMs);
        var endInterval = TPP.AI_END_SAMPLE_INTERVAL_MS;
        for (var et = endStartMs; et < totalMs; et += endInterval) {
            addPoint(et, '末段采帧');
        }
        addPoint(totalMs - 1000, '录像结束');

        // Budget control
        if (points.length > maxFrames) {
            points.sort(function(a, b) { return a.timestampSec - b.timestampSec; });
            var step = points.length / maxFrames;
            var sampled = [];
            for (var s = 0; s < maxFrames; s++) {
                sampled.push(points[Math.floor(s * step)]);
            }
            points = sampled;
        }

        points.sort(function(a, b) { return a.timestampSec - b.timestampSec; });
        return points;
    }

    // --- Layer 2: VL-directed supplementary sampling ---
    function computeLayer2Points(needMoreFrames, totalMs, maxFrames) {
        var points = [];
        var usedSec = {};

        function addPoint(timeMs, label) {
            var sec = Math.round(timeMs / 1000);
            if (sec < 0) sec = 0;
            if (sec > Math.floor(totalMs / 1000)) sec = Math.floor(totalMs / 1000);
            if (usedSec[sec]) return;
            usedSec[sec] = true;
            points.push({ timestampSec: sec, label: label });
        }

        for (var i = 0; i < needMoreFrames.length; i++) {
            var range = needMoreFrames[i];
            var startSec = range.time_range[0] - (TPP.AI_L2_EXPAND_MS / 1000);
            var endSec = range.time_range[1] + (TPP.AI_L2_EXPAND_MS / 1000);
            var intervalMs = TPP.AI_L2_SAMPLE_INTERVAL_MS;

            for (var t = startSec * 1000; t <= endSec * 1000; t += intervalMs) {
                addPoint(t, '补帧: ' + range.reason);
            }
        }

        if (points.length > maxFrames) {
            var step = points.length / maxFrames;
            var sampled = [];
            for (var s = 0; s < maxFrames; s++) {
                sampled.push(points[Math.floor(s * step)]);
            }
            points = sampled;
        }

        points.sort(function(a, b) { return a.timestampSec - b.timestampSec; });
        return points;
    }

    // --- Independent OffscreenCanvas frame decoder ---
    var screenWidth = header.width;
    var screenHeight = header.height;

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
            console.warn('[AI Analyzer] Packet decode error at', pkt.timeMs + 'ms:', err);
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

    function batchCapture(samplePoints, packets, kfs) {
        if (samplePoints.length === 0) return Promise.resolve([]);

        var sorted = samplePoints.slice().sort(function(a, b) {
            return a.timestampSec - b.timestampSec;
        });

        // Full-resolution decode canvas
        var offCanvas = new OffscreenCanvas(screenWidth, screenHeight);
        var offCtx = offCanvas.getContext('2d');
        offCtx.fillStyle = '#263f6f';
        offCtx.fillRect(0, 0, screenWidth, screenHeight);
        var captureCache = TPP.createImageCache();

        // Scaled export canvas — shrink to max width for smaller base64
        var maxExportW = TPP.AI_EXPORT_MAX_WIDTH || 1024;
        var scale = Math.min(1, maxExportW / screenWidth);
        var exportW = Math.round(screenWidth * scale);
        var exportH = Math.round(screenHeight * scale);
        var exportCanvas = (scale < 1) ? new OffscreenCanvas(exportW, exportH) : null;
        var exportCtx = exportCanvas ? exportCanvas.getContext('2d') : null;

        var results = [];
        var packetIdx = 0;

        // Seek to keyframe nearest to first sample point
        var firstTargetMs = sorted[0].timestampSec * 1000;
        for (var k = kfs.length - 1; k >= 0; k--) {
            if (kfs[k].timeMs <= firstTargetMs) {
                var kfTimeMs = kfs[k].timeMs;
                var lo = 0, hi = packets.length;
                while (lo < hi) {
                    var mid = (lo + hi) >>> 1;
                    if (packets[mid].timeMs < kfTimeMs) lo = mid + 1; else hi = mid;
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

            while (packetIdx < packets.length && packets[packetIdx].timeMs <= targetMs) {
                processPacketToCanvas(packets[packetIdx], offCtx, captureCache);
                packetIdx++;
            }

            onProgress('capturing', frameIdx + 1, total);

            // Scale down if needed, then export as JPEG (much smaller than PNG)
            var blobCanvas;
            if (exportCanvas) {
                exportCtx.drawImage(offCanvas, 0, 0, exportW, exportH);
                blobCanvas = exportCanvas;
            } else {
                blobCanvas = offCanvas;
            }

            return blobCanvas.convertToBlob({ type: 'image/jpeg', quality: TPP.AI_JPEG_QUALITY || 0.6 }).then(function(blob) {
                if (frameIdx === 0) {
                    console.log('[AI] Frame size: ' + (blob.size / 1024).toFixed(0) + 'KB, export: ' + exportW + 'x' + exportH);
                }
                return blobToBase64(blob);
            }).then(function(base64) {
                results.push({
                    base64: base64,
                    timestamp_sec: point.timestampSec,
                    label: point.label
                });
                frameIdx++;
                return new Promise(function(resolve) {
                    setTimeout(function() { resolve(captureNext()); }, 0);
                });
            });
        }

        return captureNext();
    }

    // --- Two-round VL analysis orchestration ---
    function parseVLResponse(text) {
        // Try ```json code block first
        var jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
        var jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            // Try to find any JSON object in the text
            var braceMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (braceMatch) {
                try {
                    return JSON.parse(braceMatch[0]);
                } catch (e2) {
                console.error('[AI] parseVLResponse failed. Response length:', text.length);
                    throw new Error('AI 返回的 JSON 解析失败: ' + e2.message);
                }
            }
            console.error('[AI] parseVLResponse: no JSON found. Response length:', text.length);
            throw new Error('AI 返回内容不包含有效 JSON');
        }
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
        // Claude protocol
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

    function formatTs(sec) {
        var m = Math.floor(sec / 60), s = sec % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
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

    function callVL(images, prompt, systemPrompt, settings) {
        var apiTimeoutMs = (settings.apiTimeoutSec || 120) * 1000;
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

    function runAnalysis() {
        cancelled = false;
        lastSamplePoints = null;
        var settings, tplId, l1l3Frames, round1Result, examContext;
        var totalTokens = { input: 0, output: 0 };
        var analysisStartTime = Date.now();

        onProgress('loading', 0, 0);

        return aiSettings.load().then(function(s) {
            settings = s;
            tplId = s.currentTemplate;
            if (!s.apiKey) throw new Error('请先配置 API Key');
        }).catch(function(err) {
            if (err.message && err.message.indexOf('invalidated') >= 0) {
                throw new Error('扩展已重新加载，请刷新页面');
            }
            throw err;
        }).then(function() {
            onProgress('scanning', 0, 0);
            var density = computeActivityDensity(allPackets, header.timeMs);
            var edges = detectEdges(density);
            var spikes = detectSuspiciousSpikes(density);
            if (spikes.length > 0) {
                console.log('[AI] Detected ' + spikes.length + ' suspicious activity spikes');
            }
            var maxL1L3 = Math.min(TPP.AI_MAX_L1L3_FRAMES, settings.maxFrames);
            var samplePoints = computeSamplePoints(density, edges, header.timeMs, maxL1L3, settings.endSegmentMinutes, settings.skipStartSec, spikes);
            lastSamplePoints = samplePoints;

            onProgress('capturing', 0, samplePoints.length);
            return batchCapture(samplePoints, allPackets, keyframes);
        }).then(function(frames) {
            if (cancelled) throw new Error('已取消');
            l1l3Frames = frames;

            onProgress('round1', 0, 0);
            examContext = null;
            if (window.__TP_HOST_INFO && window.__TP_HOST_INFO.parsed) {
                examContext = {
                    topic: window.__TP_HOST_INFO.parsed.topic,
                    role: window.__TP_HOST_INFO.parsed.role,
                    username: header.userUsername
                };
            }
            return templates.buildPrompt(tplId, false, null, examContext);
        }).then(function(prompt) {
            return callVL(l1l3Frames, prompt, templates.SYSTEM_PROMPT, settings);
        }).then(function(vlResult) {
            if (cancelled) throw new Error('已取消');
            // Accumulate token usage
            if (vlResult.usage) {
                totalTokens.input += vlResult.usage.input_tokens || vlResult.usage.prompt_tokens || 0;
                totalTokens.output += vlResult.usage.output_tokens || vlResult.usage.completion_tokens || 0;
            }
            round1Result = parseVLResponse(vlResult.text);

            var needMore = round1Result.need_more_frames;
            if (!needMore || needMore.length === 0) {
                return round1Result;
            }

            onProgress('layer2', 0, 0);
            var l2Points = computeLayer2Points(needMore, header.timeMs, TPP.AI_MAX_L2_FRAMES);
            if (l2Points.length === 0) return round1Result;

            return batchCapture(l2Points, allPackets, keyframes).then(function(l2Frames) {
                if (cancelled) throw new Error('已取消');

                onProgress('round2', 0, 0);
                var round1Summary = round1Result.summary + '\n评分: ' + round1Result.score
                    + '\n建议: ' + round1Result.recommendation;
                return templates.buildPrompt(tplId, true, round1Summary, examContext).then(function(prompt) {
                    return callVL(l2Frames, prompt, templates.SYSTEM_PROMPT, settings);
                });
            }).then(function(vlResult2) {
                // Accumulate round 2 tokens
                if (vlResult2.usage) {
                    totalTokens.input += vlResult2.usage.input_tokens || vlResult2.usage.prompt_tokens || 0;
                    totalTokens.output += vlResult2.usage.output_tokens || vlResult2.usage.completion_tokens || 0;
                }
                var round2Result = parseVLResponse(vlResult2.text);
                return mergeReports(round1Result, round2Result);
            });
        }).then(function(finalReport) {
            if (cancelled) throw new Error('已取消');

            // Attach analysis metadata
            finalReport._meta = {
                model: settings.model,
                tokens: totalTokens,
                durationMs: Date.now() - analysisStartTime,
                frames: (l1l3Frames ? l1l3Frames.length : 0),
                timestamp: new Date().toISOString()
            };

            onProgress('saving', 0, 0);
            return reportCache.put(rid, finalReport).then(function() {
                onProgress('done', 0, 0);
                return finalReport;
            }).catch(function(err) {
                // Cache save failure is non-critical, still return the report
                console.warn('[AI] Failed to cache report:', err.message);
                onProgress('done', 0, 0);
                return finalReport;
            });
        });
    }

    function mergeReports(round1, round2) {
        var merged = Object.assign({}, round1);

        if (round2.score) merged.score = round2.score;
        if (round2.summary) merged.summary = round2.summary;
        if (round2.recommendation) merged.recommendation = round2.recommendation;
        if (round2.conclusion) merged.conclusion = round2.conclusion;
        if (round2.test_result) merged.test_result = round2.test_result;

        if (round2.timeline && round2.timeline.length > 0) {
            var existingTimes = {};
            for (var i = 0; i < merged.timeline.length; i++) {
                existingTimes[merged.timeline[i].timestamp_sec] = true;
            }
            for (var j = 0; j < round2.timeline.length; j++) {
                if (!existingTimes[round2.timeline[j].timestamp_sec]) {
                    merged.timeline.push(round2.timeline[j]);
                }
            }
            merged.timeline.sort(function(a, b) { return a.timestamp_sec - b.timestamp_sec; });
        }

        if (round2.dimensions && round2.dimensions.length > 0) {
            var dimMap = {};
            for (var d = 0; d < merged.dimensions.length; d++) {
                dimMap[merged.dimensions[d].name] = d;
            }
            for (var e = 0; e < round2.dimensions.length; e++) {
                var dim = round2.dimensions[e];
                if (dimMap[dim.name] !== undefined) {
                    merged.dimensions[dimMap[dim.name]] = dim;
                } else {
                    merged.dimensions.push(dim);
                }
            }
        }

        delete merged.need_more_frames;
        return merged;
    }

    return {
        computeActivityDensity: computeActivityDensity,
        detectEdges: detectEdges,
        computeSamplePoints: computeSamplePoints,
        computeLayer2Points: computeLayer2Points,
        batchCapture: batchCapture,
        runAnalysis: runAnalysis,
        cancel: function() { cancelled = true; },
        getSamplePoints: function() { return lastSamplePoints; }
    };
};
