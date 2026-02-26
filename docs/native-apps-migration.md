# 预制应用原生化迁移方案

> 原则：**品牌展示、Agent、终端三个预制应用统一使用原生 Wayland 窗口，不再使用 KDP 渲染。**

## 1. 背景

当前 Kairo 桌面中的品牌展示（brand）、Agent 窗口、终端仍使用 KDP 协议渲染。KDP 仅支持基础图元（rect/text/input/image/scroll/clip），无法提供原生级别的渲染质量和交互体验。

迁移目标：

| 应用 | 当前实现 | 目标实现 |
|------|---------|---------|
| 品牌展示 (kairo-brand) | KDP `BrandWindowController` | Zig 原生 Wayland 客户端（xdg-shell） |
| Agent (kairo-agent-ui) | KDP `AgentWindowController` | Zig 原生 Wayland 客户端，WebSocket/IPC 通信 |
| 终端 | KDP `TerminalWindowController` | foot（仅作为内核崩溃回退） |

---

## 2. 项目结构

在 `os/src/` 下新增 `apps/` 目录，与 `wm/` 平级：

```
os/src/apps/
  common/                  # 共享基础设施
    wayland_client.zig     # xdg-shell 客户端封装（连接、窗口创建、事件循环）
    shm_buffer.zig         # SHM 双缓冲管理
    text_render.zig        # FreeType 文字渲染（复用 KairoDisplay.zig 的字体加载逻辑）
    ipc_client.zig         # 内核 IPC 客户端（复用 wm/ipc.zig 的 MsgPack 编码 + 新增解码）
    colors.zig             # 设计系统颜色常量（从 tokens.ts 移植为 ARGB8888）
    draw.zig               # 基础绘图原语（fillRect, fillRoundRect, alphaBlend）
  brand/
    main.zig               # kairo-brand 入口
  agent/
    main.zig               # kairo-agent-ui 入口
    websocket.zig          # WebSocket 客户端（手动实现，~200 行）
    message_list.zig       # 消息列表渲染 + 滚动
```

---

## 3. 实施 TODO

### Phase 1：共享基础设施 ✅

#### ✅ TODO 1.1：修改 `os/build.zig`

- 添加 xdg-shell 协议生成（`vendor/wayland-protocols-core/stable/xdg-shell/xdg-shell.xml`）
- 添加 `wl_seat` 绑定（键盘/鼠标输入）
- 添加 `kairo-brand` 和 `kairo-agent-ui` 两个构建目标
- 两个目标都链接 `wayland-client`、`freetype2`，agent 额外链接 `xkbcommon`

```zig
// 新增协议生成
scanner.addCustomProtocol(b.path("vendor/wayland-protocols-core/stable/xdg-shell/xdg-shell.xml"));
scanner.generate("xdg_wm_base", 1);
scanner.generate("wl_seat", 1);

// kairo-brand
const kairo_brand_exe = b.addExecutable(.{
    .name = "kairo-brand",
    .root_module = b.createModule(.{
        .root_source_file = b.path("src/apps/brand/main.zig"),
        .target = target, .optimize = optimize,
    }),
});
kairo_brand_exe.linkLibC();
kairo_brand_exe.linkSystemLibrary("wayland-client");
kairo_brand_exe.linkSystemLibrary("freetype2");
kairo_brand_exe.root_module.addImport("wayland", wayland_module);
b.installArtifact(kairo_brand_exe);

// kairo-agent-ui（类似，额外链接 xkbcommon）
```

#### ✅ TODO 1.2：创建 `common/colors.zig`

从 `src/domains/ui/tokens.ts` 移植颜色常量为 ARGB8888 格式：

```zig
pub const BG_BASE: u32 = 0xFF0D0D12;
pub const BG_SURFACE: u32 = 0xF216161E;
pub const BG_ELEVATED: u32 = 0xEB1E1E2A;
pub const BRAND_BLUE: u32 = 0xFF4A7CFF;
pub const ACCENT_TEAL: u32 = 0xFF3DD6C8;
pub const TEXT_PRIMARY: u32 = 0xFFE8E8ED;
pub const TEXT_SECONDARY: u32 = 0xCC8E8E9A;
pub const TEXT_TERTIARY: u32 = 0x995A5A6E;
pub const SEMANTIC_SUCCESS: u32 = 0xFF34C759;
pub const SEMANTIC_WARNING: u32 = 0xFFFFB340;
pub const BORDER: u32 = 0x802A2A3C;
```

#### ✅ TODO 1.3：创建 `common/draw.zig`

在像素缓冲区上绘制基本图形：

- `fillRect(buf, stride, x, y, w, h, color)` — 填充矩形
- `fillRoundRect(buf, stride, x, y, w, h, r, color)` — 圆角矩形
- `drawLine(buf, stride, x0, y0, x1, y1, color)` — 线条
- `alphaBlend(dst, src) → u32` — ARGB8888 alpha 混合

#### ✅ TODO 1.4：创建 `common/shm_buffer.zig`

SHM 双缓冲管理：

```zig
pub const ShmBuffer = struct {
    wl_buffer: ?*wl.Buffer,
    data: []u32,  // ARGB8888 像素
    width: u32,
    height: u32,
    busy: bool,   // 合成器是否正在使用

    pub fn create(shm: *wl.Shm, w: u32, h: u32) !ShmBuffer;
    pub fn destroy(self: *ShmBuffer) void;
};
```

实现要点：
- `memfd_create` 创建匿名共享内存
- `mmap` 映射到进程地址空间
- `wl_shm_pool.create_buffer` 创建 `wl_buffer`
- 监听 `wl_buffer.release` 事件标记缓冲区可用

#### ✅ TODO 1.5：创建 `common/wayland_client.zig`

xdg-shell 客户端封装，提供统一的应用框架：

```zig
pub const App = struct {
    // Wayland 全局对象
    display, registry, compositor, shm, xdg_wm_base, seat: ...
    // 窗口
    surface, xdg_surface, xdg_toplevel: ...
    // 双缓冲
    buffers: [2]ShmBuffer,
    width, height: u32,
    // 回调
    on_draw, on_key, on_pointer: ...

    pub fn init(title, w, h) !*App;
    pub fn run() !void;           // 事件循环（poll 多路复用）
    pub fn requestRedraw() void;
    pub fn getPixelBuffer() []u32;
    pub fn commitFrame() void;
};
```

#### ✅ TODO 1.6：创建 `common/text_render.zig`

FreeType 文字渲染，复用 `os/src/shell/river/KairoDisplay.zig` 第 9-66 行的字体加载逻辑：

- 字体路径：`/usr/share/fonts/dejavu/DejaVuSansMono.ttf`，回退 Noto CJK
- `renderText(buf, stride, x, y, text, color, size)` — 渲染文字到像素缓冲区
- `measureText(text, size) → {w, h}` — 测量文字尺寸

#### ✅ TODO 1.7：创建 `common/ipc_client.zig`

复用 `os/src/wm/ipc.zig` 的 `Client` 结构体和 MsgPack 编码函数，新增 MsgPack 解码（支持 map/string/uint/float）。

---

### Phase 2：kairo-brand 品牌展示应用 ✅

#### ✅ TODO 2.1：创建 `brand/main.zig`

**功能**（对标 `src/domains/ui/windows/brand.ts`）：

- 480×560 窗口，标题 "Kairo"
- 静态元素：Logo `<>`、品牌名 `K A I R O`、副标题 `Agent-Native OS`、分隔线
- 交互元素：终端/文件快速入口卡片
- 动态元素：系统状态面板（Agent 状态、内存、运行时间、版本号）
- 关闭按钮

**事件循环**：

```zig
// poll fds: [0] = wayland_fd, [1] = ipc_fd
// timeout = 2000ms → 触发 system.get_metrics 请求 + 重绘
```

#### ✅ TODO 2.2：IPC 集成

通过 IPC 连接内核（`/tmp/kairo-kernel.sock`），每 2 秒调用 `system.get_metrics` 获取系统状态并刷新面板。

#### ✅ TODO 2.3：点击事件处理

鼠标点击通过 `wl_pointer` 事件获取坐标，命中测试快速入口卡片区域：
- 终端卡片 → `std.process.Child.spawn("foot")`
- 文件卡片 → `std.process.Child.spawn("thunar")`

---

### Phase 3：kairo-agent-ui Agent 窗口应用 ✅

#### ✅ TODO 3.1：创建 `agent/websocket.zig`

手动实现 WebSocket 协议（不依赖外部库）：

1. TCP 连接 `localhost:3000`
2. HTTP Upgrade 握手（含 `Sec-WebSocket-Key`）
3. 帧收发（仅需 text frame + close frame）

连接 `ws://localhost:3000/ws`，接收事件：
- `kairo.agent.thought` — Agent 思考过程
- `kairo.agent.action` — Agent 执行动作
- `kairo.tool.result` — 工具调用结果

发送消息：`{ "type": "user_message", "text": "..." }`

#### ✅ TODO 3.2：创建 `agent/message_list.zig`

消息列表渲染 + 滚动：

- 维护 `messages: ArrayList(ChatMessage)` 列表
- 用户消息右对齐（蓝色背景），Agent 消息左对齐（深色背景）
- 鼠标滚轮通过 `wl_pointer.axis` 事件控制滚动偏移

#### ✅ TODO 3.3：创建 `agent/main.zig`

- 600×500 窗口，标题 "Kairo Agent"
- 消息列表区域（可滚动）
- 输入框 + 发送按钮
- 状态栏：Agent 状态指示
- 键盘输入：`wl_seat` → `wl_keyboard` + `xkbcommon`（初期仅 ASCII + 退格 + 回车）

**事件循环**：

```zig
// poll fds: [0] = wayland_fd, [1] = websocket_tcp_fd
```

---

### Phase 4：代码改造 ✅

#### ✅ TODO 4.1：修改 `src/domains/ui/apps.ts`

```typescript
export const PREINSTALLED_APPS: AppEntry[] = [
  {
    id: "brand",
    name: "Kairo",
    icon: "<>",
    type: "native",
    command: "kairo-brand",
    category: "系统",
  },
  {
    id: "agent",
    name: "Agent",
    icon: "*",
    type: "native",
    command: "kairo-agent-ui",
    category: "系统",
  },
  {
    id: "terminal",
    name: "终端",
    icon: ">_",
    type: "native",
    command: "foot",
    category: "系统",
  },
  // files, chromium 保持不变
];
```

#### ✅ TODO 4.2：修改 `os/src/wm/main.zig`

`handleIpcCommand` 的 `desktop.launch_app` 分支（第 840-907 行）：

```zig
// 原来 agent 走 KDP：createKdpWindow(ctx, "Agent", agent_json)
// 改为原生启动：
} else if (std.mem.eql(u8, app_id, "agent")) {
    spawnNativeApp(ctx.allocator, &.{ "kairo-agent-ui" });
} else if (std.mem.eql(u8, app_id, "brand")) {
    spawnNativeApp(ctx.allocator, &.{ "kairo-brand" });
}
```

删除第 864-903 行的 `agent_json` 硬编码 KDP UI 树。

#### ✅ TODO 4.3：修改构建和部署

**`os/Dockerfile`**：

```dockerfile
COPY --from=builder /build/zig-out/bin/kairo-brand /usr/bin/kairo-brand
COPY --from=builder /build/zig-out/bin/kairo-agent-ui /usr/bin/kairo-agent-ui
```

**`os/build_docker.sh`**：

```sh
docker cp $id:/usr/bin/kairo-brand ./dist/kairo-brand
docker cp $id:/usr/bin/kairo-agent-ui ./dist/kairo-agent-ui
```

**`scripts/deploy-vm.sh`**：

- 检查列表添加 `kairo-brand` 和 `kairo-agent-ui`
- 传输和安装新二进制

#### ✅ TODO 4.4：KDP 代码保留

以下文件保留作为 KDP 渲染参考实现，仅从启动流程中移除：
- `src/domains/ui/windows/brand.ts`
- `src/domains/ui/windows/agent-window.ts`
- `src/domains/ui/windows/terminal.ts`

---

## 4. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `os/build.zig` | 修改 | 添加 xdg-shell/wl_seat 协议生成 + 两个新构建目标 |
| `os/src/apps/common/colors.zig` | 新增 | 设计系统颜色常量 |
| `os/src/apps/common/draw.zig` | 新增 | 基础绘图原语 |
| `os/src/apps/common/shm_buffer.zig` | 新增 | SHM 双缓冲管理 |
| `os/src/apps/common/wayland_client.zig` | 新增 | xdg-shell 客户端封装 |
| `os/src/apps/common/text_render.zig` | 新增 | FreeType 文字渲染 |
| `os/src/apps/common/ipc_client.zig` | 新增 | 内核 IPC 客户端 |
| `os/src/apps/brand/main.zig` | 新增 | kairo-brand 入口 |
| `os/src/apps/agent/main.zig` | 新增 | kairo-agent-ui 入口 |
| `os/src/apps/agent/websocket.zig` | 新增 | WebSocket 客户端 |
| `os/src/apps/agent/message_list.zig` | 新增 | 消息列表渲染 |
| `src/domains/ui/apps.ts` | 修改 | agent 改为 native，新增 brand 条目 |
| `os/src/wm/main.zig` | 修改 | agent/brand 改为 spawnNativeApp，删除 KDP JSON |
| `os/Dockerfile` | 修改 | 添加新二进制复制 |
| `os/build_docker.sh` | 修改 | 添加新二进制提取 |
| `scripts/deploy-vm.sh` | 修改 | 添加新二进制部署 |

---

## 5. 可复用的现有代码

| 来源 | 复用内容 |
|------|---------|
| `os/src/shell/river/KairoDisplay.zig:9-66` | FreeType 字体加载和渲染逻辑 |
| `os/src/wm/ipc.zig` | MsgPack 编码、IPC Client 结构体 |
| `os/src/wm/main.zig:706-714` | `spawnNativeApp()` 函数模式 |
| `os/src/wm/main.zig:1084-1141` | `poll` 多路复用事件循环模式 |
| `src/domains/ui/tokens.ts` | 颜色常量值（移植为 ARGB8888） |
| `src/domains/ui/windows/brand.ts` | 品牌窗口 UI 布局参考 |
| `src/domains/ui/windows/agent-window.ts` | Agent 窗口 UI 布局参考 |
| `src/domains/server/server.plugin.ts` | WebSocket 协议和事件格式参考 |

---

## 6. 实施顺序

```
Phase 1: 共享基础设施
  TODO 1.1 build.zig 修改（协议生成 + 构建目标）
  TODO 1.2 colors.zig
  TODO 1.3 draw.zig
  TODO 1.4 shm_buffer.zig
  TODO 1.5 wayland_client.zig
  TODO 1.6 text_render.zig
  TODO 1.7 ipc_client.zig
      ↓
Phase 2: kairo-brand
  TODO 2.1 brand/main.zig（静态 UI 渲染）
  TODO 2.2 IPC 集成（系统状态轮询）
  TODO 2.3 点击事件处理
      ↓
Phase 3: kairo-agent-ui
  TODO 3.1 agent/websocket.zig
  TODO 3.2 agent/message_list.zig
  TODO 3.3 agent/main.zig（WebSocket + 消息渲染 + 输入）
      ↓
Phase 4: 代码改造
  TODO 4.1 apps.ts 修改
  TODO 4.2 main.zig 修改（launch_app 逻辑）
  TODO 4.3 Dockerfile / build_docker.sh / deploy-vm.sh 修改
```

Phase 1-3 完成后应用即可独立运行。Phase 4 将其集成到桌面启动流程中。

---

## 7. 验证方式

1. `cd os && zig build` — 确认三个二进制编译成功
2. `./build_docker.sh` — 确认 Docker 构建成功
3. `./scripts/deploy-vm.sh` — 部署到 VM
4. `limactl shell kairo-river -- start-river` — 启动桌面
5. 点击桌面图标启动 Brand → kairo-brand 窗口出现，系统状态每 2 秒刷新
6. 点击桌面图标启动 Agent → kairo-agent-ui 窗口出现
7. 在 Agent 窗口输入消息 → 通过 WebSocket 发送到内核 → 收到回复
8. 内核崩溃时 → foot 终端自动打开
9. `Super+Return` → foot 终端打开（快捷键不变）
