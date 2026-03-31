# AI-Assisted Assessment Analysis — Design Spec

**Date:** 2026-03-31
**Status:** Approved
**Scope:** tp-player-extension Chrome 插件新增 AI 分析功能

---

## 1. 背景与目标

Teleport 的核心业务场景是技术机试：候选人通过 RDP 远程桌面在 Windows 上使用 IDEA / PyCharm / VSCode 完成编程题目并运行单元测试，全程录像。面试官（3-5 人，每人每天看 3-5 个录像）回放录像评估候选人。

**痛点**：人工看录像耗时、评价标准不统一。

**目标**：在 Chrome 插件播放器中集成 AI 分析能力，面试官点击一个按钮即可获得结构化评估报告，报告中的关键时刻可点击跳转到对应画面。

---

## 2. 整体架构

```
┌─────────────── Chrome Extension ───────────────────┐
│                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌───────────┐ │
│  │  Player   │    │  AI Analyzer  │    │ Background│ │
│  │ (现有播放) │    │  (新增模块)   │    │  Service  │ │
│  │          │    │              │    │  Worker   │ │
│  │ canvas   │    │ OffscreenCanvas   │    │  (新���)   │ │
│  │ 用户观看  │    │ 后台采帧+解码 │    │ API 代理  │ │
│  └──────────┘    └──────┬───────┘    └─────┬─────┘ │
│                         │                   │       │
│  ┌──────────────────────┴───────────────────┘       │
│  │                                                  │
│  │  ┌────────────┐  ┌──────────┐  ┌────────────┐   │
│  │  │ Report Panel│  │ Settings │  │ IndexedDB  │   │
│  │  │ 报告+跳转   │  │ API/自动  │  │ 报告缓存   │   │
│  │  └────────────┘  └──────────┘  └────────────┘   │
│  │                                                  │
└──┴──────────────────────────────────────────────────┘
         │ chrome.runtime.sendMessage
         ▼
    ┌─────────┐
    │ VL API  │  Claude / OpenAI Compatible
    └─────────┘
```

### 新增模块

| 模块 | 位置 | 职责 |
|------|------|------|
| AI Analyzer | `js/ai-analyzer.js` | 采帧引擎 + 分析流程编排，独立 OffscreenCanvas 解码帧 |
| Background Service Worker | `background.js` | 调用外部 VL API（绕过 CORS），纯代理无业务逻辑 |
| Report Panel | `js/report-panel.js` | 侧边栏"AI 报告" tab，展示结果，支持时间戳跳转 |
| Settings Manager | `js/ai-settings.js` | API 配置、岗位模板、自动触发等设置管理 |
| Prompt Templates | `js/prompt-templates.js` | 预设岗位评估 prompt + 自定义模板管理 |

### manifest.json 变更

```json
{
  "background": { "service_worker": "background.js" },
  "host_permissions": [
    "https://api.anthropic.com/*",
    "https://api.openai.com/*",
    "*://*/*"
  ],
  "permissions": ["storage"]
}
```

---

## 3. 三层采帧策略

采帧引擎拥有独立的 OffscreenCanvas + Decoder + Renderer 实例，与用户观看的播放器完全隔离。录像数据（ArrayBuffer）共享引用，不复制。

### 第一层：全程稀疏采帧

扫描全部包头（12 字节/包，不解码 payload），按 10 秒窗口统计 image tile 包数量和总字节数，计算活动密度曲线。

**标记规则**：
- "上升沿"：前一窗口密度 < 阈值，当前 >= 阈值 → 开始做事
- "下降沿"：前一窗口密度 >= 阈值，当前 < 阈值 → 做完了一件事

**采帧点**：
- 每个上升沿时刻
- 每个下降沿时刻 + 3 秒（等画面稳定）
- 每 2-3 分钟兜底采样（如果该区间无上升/下降沿）
- 录像第一帧（初始状态）

**帧解码**：对每个采帧点，在 `.tpk` 中找最近的前置关键帧，seek 到该关键帧，向前解码所有包至目标时间，从 OffscreenCanvas 导出为 PNG base64。

### 第三层（优先于第二层执行）：末段密采

录像最后 5 分钟（或总时长的 15%，取较大值）：每 10 秒固定采一帧，不受活动密度影响，无条件采集。与第一层采帧点去重（同一秒内不重复）。

**合并第一层 + 第三层 → 发送 VL 模型第一轮分析。**

### 第二层：VL 定向补帧

VL 模型第一轮返回结构化 JSON，其中 `need_more_frames` 字段标注需要细看的时间段。对所有 `need_more_frames == true` 的段：在 `time_range` 前后各扩 5 秒，每 2 秒采一帧。补帧发给 VL 模型第二轮，附带第一轮的 summary 做上下文。第二轮结果合并进最终报告。

### 采帧预算控制

| 层级 | 上限 |
|------|------|
| 第一层 + 第三层 | 50 帧 |
| 第二层补帧 | 30 帧 |
| 单次分析总上限 | 80 帧 |

超出上限时自动降低采样密度。预估 token：80 帧 × ~1500 token ≈ 12 万 input token。

---

## 4. Background Service Worker

### 通信协议

```javascript
// content script → service worker
chrome.runtime.sendMessage({
  type: 'vl-analyze',
  payload: {
    images: [{ base64, timestamp_sec, label }],
    prompt: "...",
    config: { endpoint, apiKey, model }
  }
})

// service worker → content script
// 返回: { success, data: { ... }, error }
```

### 行为

- 根据 endpoint 判断协议（Anthropic 原生 vs OpenAI 兼容）
- 构造对应的请求格式（Claude Messages API vs OpenAI Chat Completions）
- 第一期不做流式返回，等完整响应
- 超时 120 秒，重试 1 次

---

## 5. API 配置

### 读取优先级

1. 插件自身设置（`chrome.storage.local`）— 用户在插件 UI 中手动配置
2. `~/.claude/settings.json` — 通过"从文件导入"按钮导入

Chrome 扩展无法直接读本地文件系统，因此 `settings.json` 通过文件选择器一次性导入，解析后存入 `chrome.storage.local`。

### 设置面板

```
┌─ AI 分析设置 ──────────────────────────────────┐
│                                                 │
│  ─── API 配置 ───────────────────────────       │
│  协议:  ○ Claude API  ○ OpenAI 兼容             │
│  Endpoint: [________________________]           │
│  API Key:  [••••••••••••••••••••••••]  👁       │
│  Model:    [claude-sonnet-4-6______▼]           │
│  [ 从文件导入 settings.json ]                    │
│  [ 测试连接 ]                                    │
│                                                 │
│  ─── 分析行为 ───────────────────────────       │
│  ☐ 打开录像时自动开始分析                        │
│                                                 │
│  ─── 岗位模板 ───────────────────────────       │
│  当前: [后端开发________▼]                       │
│  [ 编辑模板 ]  [ 新增模板 ]                      │
│                                                 │
│  ─── 高级 ───────────────────────────────       │
│  末段密采时长: [ 5 ] 分钟                        │
│  最大采帧数:   [ 80 ]                            │
│  API 超时:     [ 120 ] 秒                       │
│                                                 │
│          [ 保存 ]  [ 取消 ]                      │
└─────────────────────────────────────────────────┘
```

---

## 6. Report Panel（报告面板）

### 位置

侧边栏新增第三个 tab "AI 报告"，与现有的"笔记"和"信息"并列。

### 三种状态

**未分析**：显示"开始分析"按钮 + 自动分析勾选框 + token 预估。如数据尚未全部下载完，按钮显示为"数据下载中... (3/5)"。

**分析中**：进度条 + 阶段提示（采帧中 / 第一轮分析中 / 补帧中 / 第二轮分析中）。用户可继续正常观看录像。

**报告完成**：

```
┌──────────────────────────────┐
│  综合评分: B+                 │
│  测试通过: 4/5 (80%)          │
│                              │
│  ─── 时间线 ──────────────    │
│  00:00 ➜ 读题/环境熟悉        │
│  03:20 ➜ 开始编码             │
│  15:40 ➜ 首次运行测试 ⚠️      │
│         3/5 通过              │
│  18:10 ➜ 调试修复             │
│  22:30 ➜ 再次运行测试 ✅      │
│         4/5 通过              │
│  25:00 ➜ 代码优化整理         │
│  28:50 ➜ 最终提交             │
│                              │
│  ─── 详细评估 ────────────    │
│  解题思路: ★★★★☆              │
│  > 先理解需求再动手...        │
│  > [22:30] [点击跳转]         │
│                              │
│  代码质量: ★★★☆☆              │
│  > 命名规范但缺少异常处理     │
│  > [15:40] [点击跳转]         │
│                              │
│  调试能力: ★★★★★              │
│  > 快速定位失败用例根因        │
│  > [18:10] [点击跳转]         │
│                              │
│  时间管理: ★★★★☆              │
│  > 29分钟完成，节奏合理        │
│                              │
│  ─── 结论 ────────────────    │
│  建议: 通过                   │
│  综述: 候选人展现了...         │
│                              │
│  [ 📋 复制报告 ]  [ 导出 ]    │
└──────────────────────────────┘
```

### 交互

- 时间线中每个时间戳可点击 → `player.seek(timeMs)`
- 详细评估中的 `[点击跳转]` 同理
- "复制报告" 输出纯文本 Markdown
- "导出" 输出完整 JSON
- 低置信度的结论标灰提示

### 报告缓存

按 `recordingId` 存入 IndexedDB（复用现有 `tp-player-cache` 数据库，新增 `reports` store）。下次打开同一录像，直接加载已有报告。"重新分析" 按钮覆盖缓存。

---

## 7. 评估 Prompt 模板

### System Prompt（固定部分）

```
你是一个技术面试评审专家。你将看到一组来自候选人远程桌面操作录像的关键帧截图，
每张标注了时间戳。候选人在 Windows 桌面上使用 IDE 完成编程题目。
请严格按照指定的 JSON 格式输出分析结果。
```

### 岗位模板（预设 + 可自定义）

| 岗位 | 评估重点 |
|------|---------|
| 后端开发 | 架构设计、设计模式、异常处理、代码可维护性、测试通过率 |
| 大数据开发 | Spark/Flink API 使用、数据处理思路、性能意识、SQL 能力 |
| 测试开发 | 用例设计覆盖度、边界条件、自动化脚本质量、测试框架使用 |
| 运维开发 | 脚本编写、问题排查思路、工具链熟练度、自动化意识 |

用户可编辑预设模板或新增自定义岗位模板，存 `chrome.storage.local`。

### 输出 JSON 格式

```json
{
  "summary": "一句话总结",
  "score": "A/B+/B/C+/C/D",
  "test_result": {
    "passed": 4,
    "total": 5,
    "timestamp_sec": 1350,
    "confidence": "high"
  },
  "timeline": [
    {
      "timestamp_sec": 0,
      "activity": "读题与环境熟悉",
      "detail": "浏览项目结构，阅读 README..."
    }
  ],
  "dimensions": [
    {
      "name": "解题思路",
      "stars": 4,
      "comment": "先理解需求再动手，采用了工厂模式...",
      "evidence_timestamps": [200, 1350]
    }
  ],
  "recommendation": "通过/待定/不通过",
  "conclusion": "综合评述...",
  "need_more_frames": [
    {
      "time_range": [1520, 1580],
      "reason": "测试结果面板看不清"
    }
  ]
}
```

- `need_more_frames` 仅在第一轮出现，触发第二轮补帧；第二轮返回同结构但不含此字段
- `evidence_timestamps` 是报告中"点击跳转"的数据来源
- `confidence` 为 low 时，报告 UI 中该条目标灰提示

---

## 8. 自动触发与数据就绪

### 流程

```
页面加载
  ├─ 读取设置，检查"自动分析"是否开启
  ├─ 检查 IndexedDB 是否有缓存报告
  │   ├─ 有 → 直接渲染报告
  │   └─ 无 → 等待数据就绪
  └─ 数据就绪策略（边下边扫）：
      ① .tpr + .tpk 下完后开始扫描已有 .tpd 的包头
      ② 每个新 .tpd 下载完成时追加扫描
      ③ 最后一个 .tpd 下完后：
         - 完成活动密度计算
         - 确定所有采帧点
         - 开始解码采帧 → 发送 VL API
      全程不阻塞播放
```

### 手动触发

点击"开始分析"按钮走同样流程。数据未就绪时按钮显示"数据下载中... (3/5)"，就绪后变为可点击。

---

## 9. 新增文件清单

| 文件 | 职责 |
|------|------|
| `background.js` | Service Worker，VL API 代理 |
| `js/ai-analyzer.js` | 采帧引擎 + 分析流程编排 |
| `js/ai-settings.js` | 设置管理（API、模板、行为） |
| `js/prompt-templates.js` | 预设/自定义 prompt 模板 |
| `js/report-panel.js` | 报告面板 UI + 交互 |

现有文件变更：
- `manifest.json` — 新增 background、host_permissions、permissions
- `content-player.js` — 侧边栏新增"AI 报告" tab 入口
- `js/app.js` — 接入自动触发流程、数据就绪事件
- `css/player.css` — 报告面板样式
