# 终端窗口规范

## 概述

Kairo 终端是一个通过 KDP 协议渲染的原生终端模拟器，
为 Agent 和用户提供命令行交互界面。

---

## 窗口布局

```
┌─────────────────────────────────────────────────┐
│  ● kairo-terminal: ~              [─] [□] [×]   │  ← 标题栏
│  [Shell ▾]  [+]                                  │  ← 标签栏
├─────────────────────────────────────────────────┤
│                                                  │
│  kairo@agent:~$ ls -la                           │
│  total 32                                        │
│  drwxr-xr-x  5 kairo kairo 4096 Feb 20 10:00 .  │
│  drwxr-xr-x  3 root  root  4096 Feb 19 08:00 .. │
│  -rw-r--r--  1 kairo kairo  220 Feb 19 08:00 ... │
│  kairo@agent:~$ █                                │
│                                                  │
│                                                  │
├─────────────────────────────────────────────────┤
│  zsh  UTF-8  LF                    Ln 1, Col 1   │  ← 状态栏
└─────────────────────────────────────────────────┘
```

---

## 组件详解

### 标题栏（36px）

```
背景色:    Surface (#16161E, 0.95)
左侧:
  ● 连接指示灯    8×8px 圆形
                  绿色 = 活跃会话
                  灰色 = 无连接
  标题文字        "kairo-terminal: ~"
                  Body 字号，Primary 色
                  动态显示当前工作目录
右侧:
  窗口控制按钮组   见设计系统通用规范
```

### 标签栏（28px）

```
背景色:    Surface (#16161E) 与标题栏融合
左侧:
  Shell 选择器    下拉按钮 [Shell ▾]
                  可选: zsh / bash / fish / kairo-sh
  新建标签 [+]    点击创建新终端会话
标签项:
  活跃标签        底部 2px Kairo Blue 指示线
  非活跃标签      Secondary 文字色
  关闭标签        hover 时显示 × 按钮
```

### 终端内容区

```
背景色:    Base (#0D0D12, 1.0)
字体:      JetBrains Mono, 13px, 行高 18px
内边距:    12px（左右），8px（上下）
光标:      竖线型，Kairo Blue，闪烁周期 800ms
选区:      Kairo Blue 20% 透明度背景
```

#### 终端配色方案（Kairo Dark）

```
颜色索引:
  Black       #1A1A2E     BrightBlack    #3A3A52
  Red         #FF4D6A     BrightRed      #FF7A8F
  Green       #34C759     BrightGreen    #5FE07A
  Yellow      #FFB340     BrightYellow   #FFD06A
  Blue        #4A7CFF     BrightBlue     #6B9AFF
  Magenta     #C77DFF     BrightMagenta  #D9A3FF
  Cyan        #3DD6C8     BrightCyan     #6BE8DD
  White       #E8E8ED     BrightWhite    #FFFFFF

前景色:     #E8E8ED (Primary)
背景色:     #0D0D12 (Base)
```

#### 提示符样式

```
格式:  [用户名]@[主机名]:[路径]$
颜色:  用户名 → Cyan, @ → Secondary, 主机名 → Teal, 路径 → Blue, $ → Primary
示例:  kairo@agent:~/projects$
```

### 状态栏（28px）

```
背景色:    Surface (#16161E, 0.95)
左侧:     Shell 类型 | 编码 | 换行符
右侧:     行号, 列号
字号:      Caption (12px)
文字色:    Secondary
分隔符:    Divider 色竖线
```

---

## 功能特性

### 基础终端能力

- PTY 分配与管理（通过 Kairo Kernel 的 ProcessIO）
- ANSI 转义序列解析（颜色、光标移动、清屏）
- UTF-8 完整支持
- 滚动缓冲区（默认 10000 行）
- 文本选择与复制

### Agent 集成

```
Agent 输出区域:
  当 Agent 执行命令时，输出区域显示特殊标记：
  ┌─ agent ──────────────────────────┐
  │ 正在执行: npm install            │
  │ ████████████░░░░░░░░  60%        │
  └──────────────────────────────────┘
  标记颜色: 边框 Kairo Blue，背景 Elevated
```

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+Shift+T | 新建标签 |
| Ctrl+Shift+W | 关闭标签 |
| Ctrl+Shift+C | 复制选区 |
| Ctrl+Shift+V | 粘贴 |
| Ctrl+Shift+↑/↓ | 滚动 |
| Ctrl+Tab | 切换标签 |

---

## KDP 渲染策略

### 性能优化

终端是高频更新场景，需要特殊优化：

1. **脏行追踪** — 仅重绘变化的行，不全量提交 UI 树
2. **字符合并** — 相同样式的连续字符合并为单个 text 节点
3. **视口裁剪** — 仅渲染可见区域的行（可见行数 = 窗口高度 / 行高）
4. **双缓冲** — 构建新 UI 树后原子替换，避免闪烁

### 更新频率

```
正常输出:    合并 16ms 内的更新（~60fps 上限）
大量输出:    降级为 50ms 合并（~20fps），避免阻塞合成器
光标闪烁:    独立定时器，不触发全量重绘
空闲状态:    仅光标闪烁，无其他更新
```
