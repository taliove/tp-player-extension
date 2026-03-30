# Teleport RDP Web Player

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853?logo=googlechrome&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-blue)
![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen)

> 在浏览器中直接播放 Teleport RDP 录屏，无需桌面应用，无需服务端部署。

## 功能特性

- 一键「浏览器播放」按钮，自动注入 Teleport 审计页面
- macOS 风格播放器 UI
- 倍速播放（0.5x - 8x）
- 时间轴拖拽 & 进度条控制
- 画面缩放 & 自适应窗口
- 纯客户端运行，零服务端依赖

## 安装

```bash
git clone https://github.com/taliove/tp-player-extension.git
```

1. 打开 Chrome，访问 `chrome://extensions`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本项目目录

## 工作原理

扩展在 Teleport 审计记录页面注入「浏览器播放」按钮。点击后：

1. 通过 Teleport API 下载录屏文件（同源请求，无 CORS 问题）
2. 解析二进制录屏格式（zlib 压缩 + RLE 编码帧）
3. 在 HTML5 Canvas 上逐帧渲染

## 技术栈

| 技术 | 用途 |
|------|------|
| Vanilla JS | 核心逻辑，零依赖 |
| Chrome Extension MV3 | 扩展框架 |
| HTML5 Canvas | 帧渲染 |
| pako.js | zlib 解压缩 |

## 项目结构

```
tp-player-extension/
├── manifest.json        # 扩展配置
├── content-list.js      # 审计列表页注入脚本
├── content-player.js    # 播放页接管脚本
├── js/
│   └── player-bundle.js # 播放器核心
├── css/
│   └── player.css       # macOS 风格样式
├── lib/
│   ├── pako.min.js      # zlib 解压
│   └── rle.js           # RLE 解码
└── icons/
    └── icon128.png      # 扩展图标
```

## License

MIT
