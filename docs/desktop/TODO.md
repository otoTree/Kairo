# Kairo 桌面环境 — 实现任务清单

> 基于 [桌面环境设计规范](./README.md) 拆解，按阶段排列，前置阶段完成后方可推进后续。

## Phase 1: KDP 层迁移（基础）

最关键的架构变更 — 不完成此阶段，后续所有桌面功能无从谈起。

| # | 任务 | 涉及文件 | 状态 |
|---|------|---------|------|
| 1.1 | 扩展 `kairo-display-v1.xml` 协议：新增 `set_layer`、`set_geometry`、`set_title`、`request_close` | `os/src/shell/protocol/kairo-display-v1.xml` | ✅ |
| 1.2 | 修改 `KairoDisplay.zig` 支持多层渲染（wm / overlay / background / bottom） | `os/src/shell/river/KairoDisplay.zig` | ✅ |
| 1.3 | 修改 kairo-wm 为 KDP 窗口创建 `river_shell_surface_v1` | `os/src/wm/main.zig`, `os/src/wm/ipc.zig` | ✅ |
| 1.4 | 验证现有 KDP 窗口在 wm 层正常工作 + 输入路由（焦点、键盘、鼠标） | — | ✅ |

---

## Phase 2: 面板 + 壁纸

桌面可见形态的建立。

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 2.1 | 创建壁纸 surface 控制器（纯色渐变） | `src/domains/ui/windows/wallpaper.ts` | ✅ |
| 2.2 | 创建任务栏 surface 控制器（36px 底栏） | `src/domains/ui/windows/panel.ts` | ✅ |
| 2.3 | 修改 WM 布局预留面板 36px 空间 | `os/src/wm/main.zig` | ✅ |
| 2.4 | 实现窗口列表数据流：WM IPC 事件 → 面板 UI 树重建 | `src/domains/ui/window-manager.ts`, `os/src/wm/ipc.zig` | ✅ |
| 2.5 | 实现系统时钟（HH:MM 格式，每分钟更新） | `src/domains/ui/windows/panel.ts` | ✅ |

---

## Phase 3: 窗口装饰 + 层叠管理

让多窗口真正可用。

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 3.1 | WM 对 xdg 窗口调用 `use_ssd` + `set_borders`（颜色对齐设计系统） | `os/src/wm/main.zig` | ✅ |
| 3.2 | 实现 raise-on-click（xdg + KDP 窗口） | `os/src/wm/main.zig` | ✅ |
| 3.3 | 实现 Alt+Tab 窗口循环（通过 IPC 命令） | `os/src/wm/main.zig` | ✅ |
| 3.4 | 面板窗口列表点击切换焦点 | `src/domains/ui/windows/panel.ts` | ✅ |

---

## Phase 4: 应用启动器 + 预装应用

完整的应用生命周期。依赖 Phase 2 面板完成。

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 4.1 | 创建应用启动器 overlay（480×520px，网格卡片布局） | `src/domains/ui/windows/launcher.ts` | ✅ |
| 4.2 | 实现 Super 键绑定切换启动器（通过 IPC 命令） | `os/src/wm/main.zig` | ✅ |
| 4.3 | 创建应用注册表 + 启动流程（KDP 应用 / Native 应用） | `src/domains/ui/apps.ts` | ✅ |
| 4.4 | Dockerfile + lima yaml 添加 Chromium | `os/Dockerfile`, `lima-kairo-river.yaml` | ✅ |
| 4.5 | 更新 init 脚本启动桌面环境 | `os/src/shell/config/init` | ✅ |

---

## Phase 5: 打磨

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 5.1 | 窗口最小化 / 最大化 | `os/src/wm/main.zig`, `src/domains/ui/window-manager.ts` | ✅ |
| 5.2 | KDP 窗口拖拽移动（`river_seat_v1.op_start_pointer`） | `os/src/wm/main.zig` | ✅ |
| 5.3 | KDP 窗口调整大小 | `os/src/wm/main.zig` | ✅ |
| 5.4 | 壁纸图片渲染（完善 KDP `image` 节点） | `os/src/shell/river/KairoDisplay.zig` | ✅ |
| 5.5 | Agent 侧边栏集成（agent_active 70% 模式） | `os/src/wm/main.zig`, `src/domains/ui/window-manager.ts` | ✅ |

---

## 依赖关系

```
Phase 1 ──→ Phase 2 ──→ Phase 4
               ↓
             Phase 3（部分可与 Phase 2 并行）
               ↓
             Phase 5
```

## 状态图例

- ⬜ 未开始
- 🔧 进行中
- ✅ 已完成
- ⛔ 阻塞
