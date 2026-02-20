# KDP UI 树实现参考

## 概述

本文档提供三个窗口的 KDP JSON UI 树示例，
可直接用于 `kairo_surface_v1.commit_ui_tree()` 调用。

当前 KDP 原生层支持的节点类型：`rect`、`text`。
以下示例基于现有能力编写，并标注了未来扩展需求。

---

## 通用窗口框架

所有窗口共享的标题栏 UI 树片段：

```json
{
  "type": "root",
  "children": [
    {
      "id": "titlebar",
      "type": "rect",
      "x": 0, "y": 0,
      "width": "$WINDOW_WIDTH",
      "height": 36,
      "color": [0.086, 0.086, 0.118, 0.95],
      "children": [
        {
          "id": "title_text",
          "type": "text",
          "x": 12, "y": 10,
          "text": "$WINDOW_TITLE",
          "color": [0.91, 0.91, 0.93, 1.0],
          "scale": 2
        },
        {
          "id": "btn_close",
          "type": "rect",
          "x": "$WINDOW_WIDTH - 28",
          "y": 10,
          "width": 16, "height": 16,
          "color": [0.557, 0.557, 0.604, 0.3],
          "action": "close"
        },
        {
          "id": "btn_close_icon",
          "type": "text",
          "x": "$WINDOW_WIDTH - 24",
          "y": 12,
          "text": "x",
          "color": [0.557, 0.557, 0.604, 0.8],
          "scale": 1
        }
      ]
    }
  ]
}
```

> 注意：`$WINDOW_WIDTH` 等变量由 TypeScript Runtime 在提交前替换为实际值。

---

## 品牌窗口 UI 树

窗口尺寸：480×560px

```json
{
  "type": "root",
  "children": [
    {
      "id": "bg",
      "type": "rect",
      "x": 0, "y": 0,
      "width": 480, "height": 560,
      "color": [0.051, 0.051, 0.071, 1.0]
    },
    {
      "id": "titlebar",
      "type": "rect",
      "x": 0, "y": 0, "width": 480, "height": 36,
      "color": [0.0, 0.0, 0.0, 0.0]
    },
    {
      "id": "btn_close",
      "type": "rect",
      "x": 452, "y": 10, "width": 16, "height": 16,
      "color": [0.557, 0.557, 0.604, 0.3],
      "action": "close"
    },
    {
      "id": "logo",
      "type": "text",
      "x": 220, "y": 180,
      "text": "◇",
      "color": [0.29, 0.486, 1.0, 1.0],
      "scale": 4
    },
    {
      "id": "brand_name",
      "type": "text",
      "x": 184, "y": 228,
      "text": "K A I R O",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 4
    },
    {
      "id": "subtitle",
      "type": "text",
      "x": 176, "y": 268,
      "text": "Agent-Native OS",
      "color": [0.557, 0.557, 0.604, 0.8],
      "scale": 2
    },
    {
      "id": "divider",
      "type": "rect",
      "x": 180, "y": 300, "width": 120, "height": 1,
      "color": [0.165, 0.165, 0.235, 0.5]
    },
    {
      "id": "card_terminal",
      "type": "rect",
      "x": 88, "y": 324, "width": 140, "height": 72,
      "color": [0.118, 0.118, 0.165, 0.92],
      "action": "launch_terminal"
    },
    {
      "id": "card_terminal_icon",
      "type": "text",
      "x": 100, "y": 340,
      "text": ">_",
      "color": [0.29, 0.486, 1.0, 1.0],
      "scale": 2
    },
    {
      "id": "card_terminal_label",
      "type": "text",
      "x": 100, "y": 368,
      "text": "终端",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 2
    },
    {
      "id": "card_files",
      "type": "rect",
      "x": 252, "y": 324, "width": 140, "height": 72,
      "color": [0.118, 0.118, 0.165, 0.92],
      "action": "launch_files"
    },
    {
      "id": "card_files_icon",
      "type": "text",
      "x": 264, "y": 340,
      "text": "[]",
      "color": [0.29, 0.486, 1.0, 1.0],
      "scale": 2
    },
    {
      "id": "card_files_label",
      "type": "text",
      "x": 264, "y": 368,
      "text": "文件",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 2
    },
    {
      "id": "status_panel",
      "type": "rect",
      "x": 100, "y": 420, "width": 280, "height": 96,
      "color": [0.118, 0.118, 0.165, 0.92]
    },
    {
      "id": "status_title",
      "type": "text",
      "x": 112, "y": 432,
      "text": "系统状态",
      "color": [0.557, 0.557, 0.604, 0.8],
      "scale": 1
    },
    {
      "id": "status_agent",
      "type": "text",
      "x": 112, "y": 452,
      "text": "● Agent: 就绪",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 2
    },
    {
      "id": "status_memory",
      "type": "text",
      "x": 112, "y": 474,
      "text": "● 内存: 1.2 GB / 4 GB",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 2
    },
    {
      "id": "status_uptime",
      "type": "text",
      "x": 112, "y": 496,
      "text": "● 运行时间: 00:12:34",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 2
    },
    {
      "id": "version",
      "type": "text",
      "x": 196, "y": 536,
      "text": "v0.1.0-alpha",
      "color": [0.353, 0.353, 0.431, 0.6],
      "scale": 1
    }
  ]
}
```

---

## 终端窗口 UI 树（简化示例）

窗口尺寸：800×500px

```json
{
  "type": "root",
  "children": [
    {
      "id": "bg",
      "type": "rect",
      "x": 0, "y": 0, "width": 800, "height": 500,
      "color": [0.051, 0.051, 0.071, 1.0]
    },
    {
      "id": "titlebar",
      "type": "rect",
      "x": 0, "y": 0, "width": 800, "height": 36,
      "color": [0.086, 0.086, 0.118, 0.95]
    },
    {
      "id": "indicator",
      "type": "rect",
      "x": 12, "y": 14, "width": 8, "height": 8,
      "color": [0.204, 0.78, 0.349, 1.0]
    },
    {
      "id": "title",
      "type": "text",
      "x": 28, "y": 10,
      "text": "kairo-terminal: ~",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 2
    },
    {
      "id": "tab_bar",
      "type": "rect",
      "x": 0, "y": 36, "width": 800, "height": 28,
      "color": [0.086, 0.086, 0.118, 0.9]
    },
    {
      "id": "tab_active_indicator",
      "type": "rect",
      "x": 12, "y": 62, "width": 60, "height": 2,
      "color": [0.29, 0.486, 1.0, 1.0]
    },
    {
      "id": "tab_label",
      "type": "text",
      "x": 16, "y": 42,
      "text": "Shell",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 2
    },
    {
      "id": "content_area",
      "type": "rect",
      "x": 0, "y": 64, "width": 800, "height": 408,
      "color": [0.051, 0.051, 0.071, 1.0]
    },
    {
      "id": "prompt_line",
      "type": "text",
      "x": 12, "y": 76,
      "text": "kairo@agent:~$ ",
      "color": [0.239, 0.839, 0.784, 1.0],
      "scale": 2
    },
    {
      "id": "cursor",
      "type": "rect",
      "x": 132, "y": 76, "width": 2, "height": 16,
      "color": [0.29, 0.486, 1.0, 1.0]
    },
    {
      "id": "statusbar",
      "type": "rect",
      "x": 0, "y": 472, "width": 800, "height": 28,
      "color": [0.086, 0.086, 0.118, 0.95]
    },
    {
      "id": "status_shell",
      "type": "text",
      "x": 12, "y": 478,
      "text": "zsh  UTF-8  LF",
      "color": [0.557, 0.557, 0.604, 0.8],
      "scale": 1
    },
    {
      "id": "status_pos",
      "type": "text",
      "x": 720, "y": 478,
      "text": "Ln 1, Col 1",
      "color": [0.557, 0.557, 0.604, 0.8],
      "scale": 1
    }
  ]
}
```

---

## 文件管理器 UI 树（简化示例）

窗口尺寸：900×600px，双栏布局。

```json
{
  "type": "root",
  "children": [
    {
      "id": "bg",
      "type": "rect",
      "x": 0, "y": 0, "width": 900, "height": 600,
      "color": [0.051, 0.051, 0.071, 1.0]
    },
    {
      "id": "titlebar",
      "type": "rect",
      "x": 0, "y": 0, "width": 900, "height": 36,
      "color": [0.086, 0.086, 0.118, 0.95]
    },
    {
      "id": "title",
      "type": "text",
      "x": 12, "y": 10,
      "text": "kairo-files: ~/Documents",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 2
    },
    {
      "id": "navbar",
      "type": "rect",
      "x": 220, "y": 36, "width": 680, "height": 32,
      "color": [0.086, 0.086, 0.118, 0.85]
    },
    {
      "id": "nav_path",
      "type": "text",
      "x": 268, "y": 44,
      "text": "~ / Documents",
      "color": [0.557, 0.557, 0.604, 0.8],
      "scale": 2
    },
    {
      "id": "sidebar",
      "type": "rect",
      "x": 0, "y": 36, "width": 220, "height": 536,
      "color": [0.118, 0.118, 0.165, 0.92]
    },
    {
      "id": "sidebar_border",
      "type": "rect",
      "x": 219, "y": 36, "width": 1, "height": 536,
      "color": [0.165, 0.165, 0.235, 0.5]
    },
    {
      "id": "sidebar_label",
      "type": "text",
      "x": 12, "y": 48,
      "text": "收藏夹",
      "color": [0.557, 0.557, 0.604, 0.6],
      "scale": 1
    },
    {
      "id": "sidebar_item_home",
      "type": "text",
      "x": 16, "y": 68,
      "text": "主目录",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 2
    },
    {
      "id": "sidebar_item_docs_bg",
      "type": "rect",
      "x": 4, "y": 88, "width": 212, "height": 28,
      "color": [0.29, 0.486, 1.0, 0.15]
    },
    {
      "id": "sidebar_item_docs",
      "type": "text",
      "x": 16, "y": 94,
      "text": "文档",
      "color": [0.29, 0.486, 1.0, 1.0],
      "scale": 2
    },
    {
      "id": "sidebar_item_downloads",
      "type": "text",
      "x": 16, "y": 120,
      "text": "下载",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 2
    },
    {
      "id": "content_area",
      "type": "rect",
      "x": 220, "y": 68, "width": 680, "height": 504,
      "color": [0.051, 0.051, 0.071, 1.0]
    },
    {
      "id": "file_icon_1",
      "type": "text",
      "x": 256, "y": 92,
      "text": "[D]",
      "color": [0.29, 0.486, 1.0, 1.0],
      "scale": 3
    },
    {
      "id": "file_name_1",
      "type": "text",
      "x": 248, "y": 140,
      "text": "projects",
      "color": [0.91, 0.91, 0.93, 1.0],
      "scale": 1
    },
    {
      "id": "statusbar",
      "type": "rect",
      "x": 0, "y": 572, "width": 900, "height": 28,
      "color": [0.086, 0.086, 0.118, 0.95]
    },
    {
      "id": "status_count",
      "type": "text",
      "x": 12, "y": 578,
      "text": "6 个项目",
      "color": [0.557, 0.557, 0.604, 0.8],
      "scale": 1
    },
    {
      "id": "status_space",
      "type": "text",
      "x": 780, "y": 578,
      "text": "可用: 12.4 GB",
      "color": [0.557, 0.557, 0.604, 0.8],
      "scale": 1
    }
  ]
}
```

---

## KDP 协议扩展需求

当前 KDP 原生层仅支持 `rect` 和 `text`，要完整实现上述窗口，需要扩展：

| 优先级 | 节点类型 | 用途 | 说明 |
|--------|---------|------|------|
| P0 | `rect` 圆角支持 | 窗口/卡片/按钮 | 添加 `radius` 属性 |
| P0 | `text` 字体大小 | 排版层级 | 当前仅 `scale` 整数倍，需更细粒度 |
| P1 | `border` | 边框渲染 | 独立于 rect 填充的描边 |
| P1 | `image` | 文件缩略图/图标 | 支持 PNG/SVG 渲染 |
| P2 | `input` | 搜索框/重命名 | 文本输入节点 |
| P2 | `scroll` | 终端滚动/文件列表 | 可滚动容器 |
| P3 | `clip` | 侧边栏裁剪 | 内容溢出裁剪 |

### 渐进实现策略

```
Phase 1（当前）:  rect + text 实现基本骨架
Phase 2:         添加 radius + border，窗口有完整视觉
Phase 3:         添加 image + scroll，文件管理器可用
Phase 4:         添加 input + clip，终端完整交互
```
