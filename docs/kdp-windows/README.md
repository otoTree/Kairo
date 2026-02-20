# KDP 窗口渲染规范

## 概述

本文档集定义了 Kairo OS 通过 KDP（Kairo Display Protocol）渲染的三个核心窗口：

| 窗口 | 用途 | 文档 |
|------|------|------|
| 终端 | 命令行交互界面 | [terminal.md](./terminal.md) |
| 文件管理器 | 文件浏览与操作 | [file-manager.md](./file-manager.md) |
| Kairo 品牌窗口 | 启动欢迎 / 系统状态 | [brand-window.md](./brand-window.md) |

## 设计语言

视觉风格参考现代极简设计趋势，强调：
- 大面积留白与呼吸感
- 半透明材质与层次感
- 柔和圆角与微妙阴影
- 高对比度的排版层级

详见 [design-system.md](./design-system.md)。

## 技术栈

所有窗口通过 KDP 协议渲染，数据流：

```
TypeScript Runtime → JSON UI 树 → Wayland/KDP → Zig 合成器 → wlroots SceneTree → GPU
```

UI 树实现参考见 [kdp-ui-trees.md](./kdp-ui-trees.md)。

## 设计原则

1. **Agent 原生** — 窗口为 Agent 服务，不是传统桌面的复刻
2. **安全隔离** — KDP 无 HTML/JS，杜绝注入风险
3. **性能优先** — UI diff 最小化重绘，位图字体零延迟
4. **品牌一致** — 三个窗口共享统一的设计系统
