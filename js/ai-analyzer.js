// Teleport RDP Web Player — AI Analyzer (One-Shot Analysis)
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
                if (!base64 || base64.length < 100) {
                    console.warn('[AI] Frame at', point.timestampSec, 's produced empty/tiny base64:', base64 ? base64.length : 0, 'bytes');
                }
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
                content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + images[i].base64 } });
                content.push({ type: 'text', text: '[' + formatTs(images[i].timestamp_sec) + '] ' + (images[i].label || '') });
            }
            content.push({ type: 'text', text: prompt });
            var msgs = [];
            if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
            msgs.push({ role: 'user', content: content });
            return { body: JSON.stringify({ model: settings.model, max_tokens: 8192, messages: msgs }),
                     headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey } };
        }
        content = [];
        for (i = 0; i < images.length; i++) {
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
        var content;
        if (protocol === 'openai') {
            content = data.choices[0].message.content;
        } else {
            content = '';
            for (var i = 0; i < data.content.length; i++) {
                if (data.content[i].type === 'text') content += data.content[i].text;
            }
        }
        // Detect vision model issues — model claims it can't see images
        if (/未提供.*截图|无法.*查看.*图|I (?:can't|cannot) (?:see|view|access) (?:the |any )?image/i.test(content)) {
            console.error('[AI] Model claims it cannot see images. Check: 1) model supports vision 2) base64 data is valid');
            throw new Error('模型无法识别截图，请检查模型是否支持视觉功能');
        }
        return { text: content, usage: data.usage };
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
        // Strip trailing /v1 to avoid double-path (e.g. user enters https://api.minimax.io/v1)
        if (settings.protocol === 'claude') {
            if (endpoint.indexOf('/v1/messages') === -1) {
                endpoint = endpoint.replace(/\/v1$/, '') + '/v1/messages';
            }
        } else if (settings.protocol === 'openai') {
            if (endpoint.indexOf('/v1/chat/completions') === -1) {
                endpoint = endpoint.replace(/\/v1$/, '') + '/v1/chat/completions';
            }
        }

        var req = buildRequestBody(images, prompt, systemPrompt, settings);
        console.log('[AI] callVL → ' + endpoint);
        console.log('[AI] callVL: images:', images.length, 'model:', settings.model,
            'body:', (req.body.length / 1024 / 1024).toFixed(1) + 'MB');

        return TPP.extBridge.fetchProxy(endpoint, {
            method: 'POST',
            headers: req.headers,
            body: req.body
        }, apiTimeoutMs).then(function(resp) {
            if (resp && resp.error) throw new Error(resp.error);
            if (!resp || !resp.ok) {
                console.error('[AI] API error:', resp ? resp.status : '?', resp ? resp.text.substring(0, 500) : 'no response');
                throw new Error('API ' + (resp ? resp.status : '?') + ': ' + (resp ? resp.text : 'no response'));
            }
            console.log('[AI] API response OK, length:', resp.text.length);
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
            lastCapturedFrames = frames;
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

    // --- Assemble final report ---

    // Store captured frames for PDF report reuse
    var lastCapturedFrames = null;

    function assembleReport(l1Result, totalTokens, durationMs) {
        var score = l1Result.score || '-';
        var verdict = l1Result.verdict || null;
        if (!verdict) {
            if (score === 'D' || score === 'C') verdict = '不通过';
            else if (score === 'C+') verdict = '待定';
            else verdict = '通过';
        }

        var markers = l1Result.markers || [];
        markers.sort(function(a, b) { return a.time_sec - b.time_sec; });

        return {
            topic: l1Result.topic || '',
            tech_stack: l1Result.tech_stack || [],
            score: score,
            verdict: verdict,
            one_liner: l1Result.one_liner || l1Result.summary || '',
            recommendation: verdict,
            dimensions: l1Result.dimensions || [],
            phases: (l1Result.phases || []).map(function(p) {
                return { name: p.name, start_sec: p.start_sec, end_sec: p.end_sec, summary: p.summary || '', status: 'done' };
            }),
            markers: markers,
            _meta: {
                model: null,
                tokens: totalTokens,
                durationMs: durationMs,
                frames: l1Result._frames || 0,
                timestamp: new Date().toISOString()
            },
            _capturedFrames: lastCapturedFrames || []
        };
    }

    // --- Main orchestration ---

    function runAnalysis() {
        cancelled = false;
        var settings;
        var totalTokens = { input: 0, output: 0 };
        var analysisStartTime = Date.now();

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
            addTokens(result._usage);

            var durationMs = Date.now() - analysisStartTime;
            var report = assembleReport(result, totalTokens, durationMs);
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

    return {
        runAnalysis: runAnalysis,
        cancel: function() { cancelled = true; },
        captureFrames: function(samplePoints) {
            return batchCapture(samplePoints, null);
        }
    };
};
