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

    // --- Layer 1 + Layer 3 sample points ---
    function computeSamplePoints(density, edges, totalMs, maxFrames, endSegmentMinutes) {
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

        // First frame
        addPoint(0, '录像开始');

        // Layer 1: edge-based sampling
        for (var i = 0; i < edges.length; i++) {
            var e = edges[i];
            if (e.type === 'rising') {
                addPoint(e.timeMs, '活动开始');
            } else {
                addPoint(e.timeMs + TPP.AI_EDGE_SETTLE_MS, '活动结束');
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

        var offCanvas = new OffscreenCanvas(screenWidth, screenHeight);
        var offCtx = offCanvas.getContext('2d');
        offCtx.fillStyle = '#263f6f';
        offCtx.fillRect(0, 0, screenWidth, screenHeight);
        var captureCache = TPP.createImageCache();

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

            return offCanvas.convertToBlob({ type: 'image/png' }).then(function(blob) {
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
                    throw new Error('Failed to parse VL response JSON: ' + e2.message);
                }
            }
            throw new Error('Failed to parse VL response JSON: ' + e.message);
        }
    }

    function callVL(images, prompt, systemPrompt, settings) {
        return TPP.extBridge.sendMessage({
            type: 'vl-analyze',
            payload: {
                config: {
                    protocol: settings.protocol,
                    endpoint: settings.endpoint,
                    apiKey: settings.apiKey,
                    model: settings.model,
                    timeoutMs: settings.apiTimeoutSec * 1000
                },
                images: images,
                prompt: prompt,
                systemPrompt: systemPrompt
            }
        }).then(function(resp) {
            if (!resp.success) throw new Error(resp.error);
            return resp.data;
        });
    }

    function runAnalysis() {
        cancelled = false;
        var settings, tplId, l1l3Frames, round1Result;

        onProgress('loading', 0, 0);

        return aiSettings.load().then(function(s) {
            settings = s;
            tplId = s.currentTemplate;
            if (!s.apiKey) throw new Error('请先配置 API Key');

            onProgress('scanning', 0, 0);
            var density = computeActivityDensity(allPackets, header.timeMs);
            var edges = detectEdges(density);
            var maxL1L3 = Math.min(TPP.AI_MAX_L1L3_FRAMES, settings.maxFrames);
            var samplePoints = computeSamplePoints(density, edges, header.timeMs, maxL1L3, settings.endSegmentMinutes);

            onProgress('capturing', 0, samplePoints.length);
            return batchCapture(samplePoints, allPackets, keyframes);
        }).then(function(frames) {
            if (cancelled) throw new Error('已取消');
            l1l3Frames = frames;

            onProgress('round1', 0, 0);
            return templates.buildPrompt(tplId, false);
        }).then(function(prompt) {
            return callVL(l1l3Frames, prompt, templates.SYSTEM_PROMPT, settings);
        }).then(function(vlResult) {
            if (cancelled) throw new Error('已取消');
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
                return templates.buildPrompt(tplId, true, round1Summary).then(function(prompt) {
                    return callVL(l2Frames, prompt, templates.SYSTEM_PROMPT, settings);
                });
            }).then(function(vlResult2) {
                var round2Result = parseVLResponse(vlResult2.text);
                return mergeReports(round1Result, round2Result);
            });
        }).then(function(finalReport) {
            if (cancelled) throw new Error('已取消');

            onProgress('saving', 0, 0);
            return reportCache.put(rid, finalReport).then(function() {
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
        cancel: function() { cancelled = true; }
    };
};
