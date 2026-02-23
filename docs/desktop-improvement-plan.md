# Kairo 桌面体验改进方案

> 原则：**原生工具做传统交互，KDP 专注 Agent 渲染，不妥协。**

## 1. 问题诊断

### 1.1 视觉粗糙

当前桌面所有元素（壁纸、任务栏、启动器、终端、浏览器）均通过 KDP JSON UI 树渲染。
KDP 仅支持 `rect`、`text`、`input`、`image`、`scroll`、`clip` 六种基础图元，导致：

- 无阴影、无渐变、无模糊效果
- 字体渲染依赖 FreeType 单字号位图，无 subpixel hinting
- 壁纸仅为纯色 + 3% 透明度微光矩形
- 窗口装饰为手工拼接的 rect + text，缺乏精致感

### 1.2 终端不可用

`TerminalWindowController`（`src/domains/ui/windows/terminal.ts`）是纯 KDP 实现：

- ANSI 转义序列解析不完整（仅 16 色，缺少 256 色/TrueColor）
- `stdin.write` IPC 原语未实现，键盘输入无法送达 PTY
- 无滚动回看、无选择复制、无标签页切换
- 每次输出都重建整棵 UI 树，性能瓶颈明显
- 缺少 Unicode 宽字符支持

### 1.3 浏览器不可用

`BrowserWindowController`（`src/domains/ui/windows/browser-window.ts`）是 KDP 模拟界面：

- 仅渲染了地址栏 + Google 风格首页的静态 UI
- 无 HTML/CSS/JS 引擎，无法加载任何网页
- VM 中已安装 Chromium，但桌面图标启动的是 KDP 模拟窗口
- `apps.ts` 中 Chrome 条目的 `type` 为 `'kdp'` 而非 `'native'`

### 1.4 根本原因

**KDP 被过度使用**。KDP 的设计初衷是让 Agent 通过 JSON 描述 UI，
适合生成式、动态的 Agent 界面。但将它用于终端模拟器、浏览器这类
需要复杂交互和成熟渲染能力的传统应用，是错误的方向。

---

## 2. 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Kairo Desktop (完成态)                     │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Chromium  │  │   foot   │  │  Thunar  │  │  Agent   │   │
│  │ (native)  │  │ (native) │  │ (native) │  │  (KDP)   │   │
│  │ xdg-shell │  │ xdg-shell│  │ xdg-shell│  │ KDP proto│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           waybar (wlr-layer-shell, bottom)           │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           swaybg (wlr-layer-shell, background)       │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           fuzzel (启动器, overlay)                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │     River 合成器 + kairo-wm (保留, KDP 已集成)        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 确定选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 合成器 | River (保留) | KDP 协议已原生集成，切换成本极高 |
| 窗口管理器 | kairo-wm (保留) | 已支持 xdg + KDP 窗口共存 |
| 终端 | foot | 完整 VT100/xterm，GPU 渲染，VM 已安装 |
| 浏览器 | Chromium | 真正的浏览器引擎，VM 已安装 |
| 文件管理器 | Thunar | GTK 轻量文件管理器，Alpine 可用 |
| 任务栏 | waybar | Wayland 生态最成熟的面板，原生支持 River |
| 壁纸 | swaybg | wlr-layer-shell 壁纸，支持图片/纯色 |
| 启动器 | fuzzel | 轻量 Wayland 原生启动器，dmenu 风格 |
| Agent 窗口 | KDP 协议 | Agent 生成式 UI 的唯一正确场景 |

---

## 3. 实施 TODO

### Phase 1：基础设施 — VM 环境准备

#### TODO 1.1：更新 Lima VM 软件包

**文件**: `lima-kairo-river.yaml`

在 provision 脚本中追加安装：

```yaml
# 桌面 Shell 组件
apk add --no-cache waybar swaybg fuzzel

# 文件管理器 (GTK3, 轻量)
apk add --no-cache thunar

# GTK 主题 (暗色)
apk add --no-cache adwaita-icon-theme

# 字体增强
apk add --no-cache font-noto font-noto-cjk
```

#### TODO 1.2：创建 Kairo 壁纸

**文件**: `assets/wallpaper.png`

设计一张 1920x1080 暗色壁纸，配色对齐 Kairo 设计系统：
- 主背景: `#0d0d12`
- 微光渐变: `#16161e` → `#0d0d12`
- 右下角 Kairo Logo 水印，`#1a1a2e` 低对比度

初期用纯色过渡：`swaybg -c '#0d0d12'`

#### TODO 1.3：配置 foot 终端主题

**文件**: `configs/foot/foot.ini`（部署到 VM 的 `~/.config/foot/foot.ini`）

```ini
[main]
font=Noto Sans Mono:size=11
pad=8x8
dpi-aware=no

[scrollback]
lines=10000

[mouse]
hide-when-typing=yes

[key-bindings]
clipboard-copy=Control+Shift+c
clipboard-paste=Control+Shift+v

[colors]
background=0d0d12
foreground=e8e8ed

# Kairo Dark 16 色
regular0=0d0d12
regular1=ff4d6a
regular2=34c759
regular3=ffd60a
regular4=4a7cff
regular5=bf5af2
regular6=64d2ff
regular7=8e8e9a
bright0=2a2a3c
bright1=ff6b81
bright2=5cd97b
bright3=ffe066
bright4=7da2ff
bright5=d48dff
bright6=8be3ff
bright7=e8e8ed
```

#### TODO 1.4：配置 waybar

**文件**: `configs/waybar/config`

```json
{
  "layer": "bottom",
  "position": "bottom",
  "height": 36,
  "spacing": 0,
  "modules-left": ["custom/kairo-logo", "river/tags"],
  "modules-center": ["river/window"],
  "modules-right": ["custom/agent-status", "tray", "clock"],
  "river/tags": {
    "num-tags": 4
  },
  "river/window": {
    "max-length": 50
  },
  "clock": {
    "format": "{:%m-%d %H:%M}",
    "tooltip-format": "{:%Y-%m-%d %A}"
  },
  "tray": {
    "spacing": 8
  },
  "custom/kairo-logo": {
    "format": " ◇ Kairo ",
    "on-click": "fuzzel",
    "tooltip": false
  },
  "custom/agent-status": {
    "exec": "kairo-agent-status 2>/dev/null || echo 'idle'",
    "interval": 5,
    "format": "● {}",
    "tooltip": false
  }
}
```

**文件**: `configs/waybar/style.css`

```css
* {
  font-family: "Noto Sans Mono", "DejaVu Sans Mono", monospace;
  font-size: 13px;
  color: #8e8e9a;
  border: none;
  border-radius: 0;
  min-height: 0;
}

window#waybar {
  background: rgba(13, 13, 18, 0.95);
  border-top: 1px solid rgba(42, 42, 60, 0.4);
}

/* Kairo Logo */
#custom-kairo-logo {
  color: #4a7cff;
  font-weight: bold;
  padding: 0 12px;
  background: rgba(74, 124, 255, 0.08);
}

#custom-kairo-logo:hover {
  background: rgba(74, 124, 255, 0.15);
}

/* River Tags */
#tags button {
  padding: 0 8px;
  color: #5a5a6e;
}

#tags button.focused {
  color: #e8e8ed;
  border-bottom: 2px solid #4a7cff;
}

#tags button.occupied {
  color: #8e8e9a;
}

/* 窗口标题 */
#window {
  color: #c8c8d0;
  padding: 0 16px;
}

/* Agent 状态 */
#custom-agent-status {
  color: #34c759;
  padding: 0 8px;
}

/* 时钟 */
#clock {
  color: #8e8e9a;
  padding: 0 12px;
}

/* 系统托盘 */
#tray {
  padding: 0 8px;
}
```

#### TODO 1.5：配置 fuzzel 启动器

**文件**: `configs/fuzzel/fuzzel.ini`

```ini
[main]
font=Noto Sans Mono:size=12
prompt=>
icon-theme=Adwaita
terminal=foot
layer=overlay
width=40
lines=12

[colors]
background=16161eff
text=e8e8edff
selection=2a2a3cff
selection-text=e8e8edff
border=4a7cffff
match=4a7cffff

[border]
width=2
radius=8
```

#### TODO 1.6：配置 Thunar 暗色主题

**文件**: `configs/gtk-3.0/settings.ini`（部署到 `~/.config/gtk-3.0/settings.ini`）

```ini
[Settings]
gtk-theme-name=Adwaita-dark
gtk-icon-theme-name=Adwaita
gtk-font-name=Noto Sans 10
gtk-application-prefer-dark-theme=true
```

---

### Phase 2：代码改造 — 原生应用启动

#### TODO 2.1：修改应用注册表

**文件**: `src/domains/ui/apps.ts`

将终端、浏览器、文件管理器改为 native 类型，保留 Agent 为 KDP：

```typescript
export const PREINSTALLED_APPS: AppEntry[] = [
  {
    id: "terminal",
    name: "终端",
    icon: ">_",
    type: "native",
    command: "foot",
    category: "系统",
  },
  {
    id: "files",
    name: "文件",
    icon: "[]",
    type: "native",
    command: "thunar",
    category: "系统",
  },
  {
    id: "chromium",
    name: "Chromium",
    icon: "○",
    type: "native",
    command: "chromium-browser --no-sandbox --ozone-platform=wayland --enable-features=UseOzonePlatform",
    category: "应用",
  },
  {
    id: "agent",
    name: "Agent",
    icon: "*",
    type: "kdp",
    category: "系统",
  },
];
```

删除 `brand` 和 `chrome` 条目（brand 窗口不再需要，chrome 改名为 chromium）。

#### TODO 2.2：修改 Zig WM 的应用启动逻辑

**文件**: `os/src/wm/main.zig`

当前 `handleIpcCommand` 中 `desktop.launch_app:` 分支硬编码创建 KDP 窗口。
需要修改为：

```zig
// 原生应用映射表
const native_apps = .{
    .{ "terminal", "foot" },
    .{ "files", "thunar" },
    .{ "chromium", "chromium-browser --no-sandbox --ozone-platform=wayland --enable-features=UseOzonePlatform" },
};

fn handleLaunchApp(ctx: *Context, app_id: []const u8) void {
    // 检查是否为原生应用
    inline for (native_apps) |entry| {
        if (std.mem.eql(u8, app_id, entry[0])) {
            // 使用 std.process.Child 启动原生进程
            var child = std.process.Child.init(
                &.{ "/bin/sh", "-c", entry[1] },
                ctx.allocator,
            );
            child.spawn() catch |err| {
                std.log.err("启动 {s} 失败: {}", .{ entry[0], err });
                return;
            };
            std.log.info("已启动原生应用: {s} (pid={})", .{ entry[0], child.id });
            return;
        }
    }

    // KDP 应用走原有逻辑
    if (std.mem.eql(u8, app_id, "agent")) {
        createKdpWindow(ctx, "Agent", agent_json);
    }
}
```

#### TODO 2.3：移除 KDP Shell 组件

以下 KDP Shell 组件被 waybar/swaybg/fuzzel 替代，从内核启动流程中移除：

| 移除的 KDP 组件 | 替代方案 |
|-----------------|---------|
| `WallpaperController` + `DesktopIconsController` | swaybg + fuzzel |
| `PanelController` | waybar |
| `LauncherController` | fuzzel |
| `BrandWindowController` | 删除（不再需要品牌窗口） |

**不删除源文件**，仅从启动流程中移除。保留代码作为 KDP 渲染的参考实现。

**文件**: `os/src/wm/main.zig`

移除 Zig WM 中创建壁纸/面板/启动器 KDP surface 的代码。
这些 surface 原本在 WM 启动时自动创建，现在由 swaybg/waybar 接管。

**文件**: `os/src/shell/config/init`（River init 脚本）

修改为：

```sh
#!/bin/sh
export PATH="/usr/local/bin:$PATH"

# --- 壁纸 ---
swaybg -c '#0d0d12' &

# --- 任务栏 ---
waybar &

# --- 窗口管理器 ---
kairo-wm > /tmp/kairo-wm.log 2>&1 &
sleep 1

# --- Kairo 内核（仅管理 Agent 窗口和 KDP） ---
if command -v kairo-kernel >/dev/null 2>&1; then
  kairo-kernel > /tmp/kairo-kernel.log 2>&1 &
fi

# --- 回退终端 ---
if ! pgrep -f "kairo-kernel" >/dev/null 2>&1; then
  foot &
fi
```

#### TODO 2.4：更新 TypeScript 内核启动逻辑

**文件**: `src/domains/ui/compositor.plugin.ts` 及相关文件

内核启动时不再创建壁纸/面板/启动器的 KDP surface。
`CompositorPlugin` 仅处理 Agent 窗口的渲染提交和事件路由。

修改 `WindowManager` 的初始化逻辑：
- 移除 `WallpaperController` 创建
- 移除 `PanelController` 创建
- 移除 `LauncherController` 创建
- 保留 Agent 窗口创建能力

---

### Phase 3：部署流程更新

#### TODO 3.1：更新部署脚本

**文件**: `scripts/deploy-vm.sh`

追加配置文件部署：

```bash
# 部署桌面配置文件
echo "部署桌面配置..."
limactl copy "$KAIRO_DIR/configs/foot/foot.ini" "${VM_NAME}:/tmp/foot.ini"
limactl copy "$KAIRO_DIR/configs/waybar/config" "${VM_NAME}:/tmp/waybar-config"
limactl copy "$KAIRO_DIR/configs/waybar/style.css" "${VM_NAME}:/tmp/waybar-style.css"
limactl copy "$KAIRO_DIR/configs/fuzzel/fuzzel.ini" "${VM_NAME}:/tmp/fuzzel.ini"
limactl copy "$KAIRO_DIR/configs/gtk-3.0/settings.ini" "${VM_NAME}:/tmp/gtk-settings.ini"

limactl shell "$VM_NAME" -- sh -c '
  mkdir -p ~/.config/foot ~/.config/waybar ~/.config/fuzzel ~/.config/gtk-3.0
  cp /tmp/foot.ini ~/.config/foot/foot.ini
  cp /tmp/waybar-config ~/.config/waybar/config
  cp /tmp/waybar-style.css ~/.config/waybar/style.css
  cp /tmp/fuzzel.ini ~/.config/fuzzel/fuzzel.ini
  cp /tmp/gtk-settings.ini ~/.config/gtk-3.0/settings.ini
  rm -f /tmp/foot.ini /tmp/waybar-config /tmp/waybar-style.css /tmp/fuzzel.ini /tmp/gtk-settings.ini
'
```

#### TODO 3.2：创建 kairo-agent-status 脚本

**文件**: `scripts/kairo-agent-status.sh`（部署到 VM 的 `/usr/local/bin/kairo-agent-status`）

waybar 的 Agent 状态模块需要此脚本：

```bash
#!/bin/sh
# 查询 Kairo 内核的 Agent 状态
# 通过 Unix Socket 发送 system.get_metrics 请求
if pgrep -f "kairo-kernel" >/dev/null 2>&1; then
  echo "running"
else
  echo "offline"
fi
```

---

### Phase 4：KDP 增强 — Agent 专用渲染

#### TODO 4.1：增强 KDP 图元能力

**文件**: `os/src/shell/protocol/kairo-display-v1.xml`

扩展 KDP 协议，为 Agent 窗口添加高级渲染能力：

```xml
<!-- 新增图元类型 -->
<enum name="node_type">
  <!-- 现有 -->
  <entry name="rect" value="0"/>
  <entry name="text" value="1"/>
  <entry name="input" value="2"/>
  <entry name="image" value="3"/>
  <entry name="scroll" value="4"/>
  <entry name="clip" value="5"/>
  <!-- 新增 -->
  <entry name="gradient" value="6"/>    <!-- 线性/径向渐变 -->
  <entry name="shadow" value="7"/>      <!-- 投影/内阴影 -->
  <entry name="markdown" value="8"/>    <!-- Markdown 文本渲染 -->
  <entry name="code_block" value="9"/>  <!-- 代码块 (语法高亮) -->
</enum>
```

#### TODO 4.2：实现 KairoDisplay 渐变和阴影渲染

**文件**: `os/src/shell/river/KairoDisplay.zig`

为 `gradient` 和 `shadow` 节点类型添加渲染实现：

- `gradient`: 使用 Pixman 的 `pixman_image_create_linear_gradient` 实现线性渐变
- `shadow`: 使用高斯模糊 + 偏移矩形实现投影效果
- `markdown`: 解析 Markdown 子集（标题、粗体、列表、代码），映射为 text 节点组合

#### TODO 4.3：实现 Agent 侧边栏模式

**文件**: `os/src/wm/main.zig`

为 Agent 窗口添加侧边栏布局模式：

- Agent 窗口固定在屏幕右侧 30% 宽度
- 其他窗口自动占据左侧 70%
- 通过 `kairo_surface_v1.set_layer(.sidebar)` 触发
- 快捷键 `Super+A` 切换 Agent 侧边栏显示/隐藏

#### TODO 4.4：Agent 窗口视觉增强

Agent KDP 窗口的默认样式升级：

- 窗口背景: 半透明毛玻璃效果（`rgba(13, 13, 18, 0.85)` + 模糊）
- 圆角: 12px
- 阴影: `0 8px 32px rgba(0, 0, 0, 0.4)`
- 标题栏: 渐变 `#16161e` → `#1a1a2e`
- Agent 思考动画: 脉冲光点效果

---

### Phase 5：River 合成器增强

#### TODO 5.1：wlr-layer-shell 支持验证

确保 River 合成器正确支持 `wlr-layer-shell-unstable-v1` 协议，
这是 waybar、swaybg、fuzzel 正常工作的前提。

River 基于 wlroots，理论上已支持。需要验证：
- `ZWLR_LAYER_SHELL_V1_LAYER_BACKGROUND` (swaybg)
- `ZWLR_LAYER_SHELL_V1_LAYER_BOTTOM` (waybar)
- `ZWLR_LAYER_SHELL_V1_LAYER_OVERLAY` (fuzzel)

#### TODO 5.2：River 键盘快捷键配置

**文件**: `os/src/shell/config/init`

追加 River 快捷键绑定（通过 `riverctl`）：

```sh
# 应用快捷键
riverctl map normal Super Return spawn foot
riverctl map normal Super+Shift Return spawn "chromium-browser --no-sandbox --ozone-platform=wayland"
riverctl map normal Super D spawn fuzzel
riverctl map normal Super E spawn thunar
riverctl map normal Super A spawn "kairo-agent-toggle"  # Agent 侧边栏

# 窗口管理
riverctl map normal Super Q close
riverctl map normal Super F toggle-fullscreen
riverctl map normal Alt Tab focus-view next
riverctl map normal Alt+Shift Tab focus-view previous

# 布局
riverctl default-layout rivertile
rivertile -view-padding 4 -outer-padding 4 &
```

#### TODO 5.3：窗口装饰统一

kairo-wm 的 SSD（服务端装饰）样式对齐设计系统：

- 活跃窗口边框: `#4a7cff` (2px)
- 非活跃窗口边框: `#2a2a3c` (1px)
- 标题栏高度: 0px（隐藏标题栏，使用 waybar 显示窗口标题）

---

## 4. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `lima-kairo-river.yaml` | 修改 | 追加 waybar/swaybg/fuzzel/thunar/字体 |
| `src/domains/ui/apps.ts` | 修改 | terminal/files/chromium 改为 native |
| `os/src/wm/main.zig` | 修改 | 原生应用启动 + 移除 KDP Shell 创建 |
| `os/src/shell/config/init` | 修改 | 启动 swaybg/waybar + riverctl 快捷键 |
| `scripts/deploy-vm.sh` | 修改 | 追加配置文件部署 |
| `configs/foot/foot.ini` | 新增 | foot 终端配色 |
| `configs/waybar/config` | 新增 | waybar 模块配置 |
| `configs/waybar/style.css` | 新增 | waybar 样式 |
| `configs/fuzzel/fuzzel.ini` | 新增 | fuzzel 启动器配置 |
| `configs/gtk-3.0/settings.ini` | 新增 | GTK 暗色主题 |
| `scripts/kairo-agent-status.sh` | 新增 | waybar Agent 状态脚本 |
| `assets/wallpaper.png` | 新增 | Kairo 品牌壁纸 |
| `os/src/shell/protocol/kairo-display-v1.xml` | 修改 | KDP 协议扩展 |
| `os/src/shell/river/KairoDisplay.zig` | 修改 | 渐变/阴影渲染 |

---

## 5. 执行顺序

```
Phase 1 (基础设施)          Phase 2 (代码改造)
  TODO 1.1 VM 软件包    ──→   TODO 2.1 apps.ts
  TODO 1.2 壁纸         ──→   TODO 2.2 Zig WM 启动逻辑
  TODO 1.3 foot 配置    ──→   TODO 2.3 移除 KDP Shell
  TODO 1.4 waybar 配置  ──→   TODO 2.4 内核启动逻辑
  TODO 1.5 fuzzel 配置       │
  TODO 1.6 GTK 暗色主题      │
                              ↓
Phase 3 (部署)              Phase 4 (KDP 增强)
  TODO 3.1 部署脚本     ──→   TODO 4.1 KDP 协议扩展
  TODO 3.2 Agent 状态脚本──→  TODO 4.2 渐变/阴影渲染
                              TODO 4.3 Agent 侧边栏
                              TODO 4.4 视觉增强
                              ↓
                            Phase 5 (合成器增强)
                              TODO 5.1 layer-shell 验证
                              TODO 5.2 快捷键配置
                              TODO 5.3 窗口装饰
```

Phase 1-3 完成后桌面即可正常使用。Phase 4-5 是 Agent 体验的精打细磨。
