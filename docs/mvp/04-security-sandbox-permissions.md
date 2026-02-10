# Security（Permissions + Sandbox Enforcement）规格说明（MVP v0.1）

## 1. 目标

v0.1 的安全目标是“能强制执行”，而不是“权限体系设计完美”：
- 技能（skill）可声明 permissions（manifest）
- 运行时（Kernel/Skills）在启动进程前将 permissions 映射为沙箱配置（deny-by-default）
- Kernel 对 IPC 方法做最小鉴权（至少隔离进程控制范围）
- 事件化审计：权限不足/拒绝/违规必须可观测

## 2. 范围与非目标

进入 v0.1：
- manifest 权限声明结构（已有）
- 沙箱在平台可用时强制执行网络/文件策略
- 最小鉴权：caller 只能控制自己创建的进程
- 最小审计事件：permission denied / sandbox violation（若可探测）

不进入 v0.1：
- 用户交互式授权 UI（可先用静态策略）
- 细粒度设备 claim/release 权限联动（设备生命周期 v0.2+）
- 多租户/远程身份认证（当前为本机进程边界）

## 3. 现状对齐（代码基线）

- 权限声明（manifest v2）：[manifest.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/manifest.ts)
- 沙箱配置 schema（运行时校验）：[sandbox-config.ts](file:///Users/hjr/Desktop/Kairo/src/domains/sandbox/sandbox-config.ts)
- 沙箱执行器与跨平台实现：[sandbox-manager.ts](file:///Users/hjr/Desktop/Kairo/src/domains/sandbox/sandbox-manager.ts)
- Skills 执行路径（已使用 SandboxManager.wrapWithSandbox）：[skills.plugin.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/skills.plugin.ts)

## 4. 权限模型（MVP）

### 4.1 SkillPermission（声明层）

manifest 内 permissions 结构（现有）：
- `scope`: `device | network | kernel`
- `request`: 权限名（字符串，稳定命名空间）
- `criteria?`: 约束（例如域名白名单、路径白名单等）
- `port?`: 端口（网络/设备相关）
- `description?`: 人类可读说明

v0.1 推荐最小权限集合（建议约定，但允许扩展）：
- `network:egress`（出网）
- `filesystem:write`（写路径）
- `kernel:process`（允许调用 process 相关 IPC 方法）

### 4.2 Enforcement（执行层）必须满足的两个边界

1) **Sandbox 边界（资源访问）**
- 未声明出网权限：默认禁止出网（或只允许 localhost，取决于平台与实现）
- 未声明写权限：默认只允许 workspace/临时目录写（由系统配置决定）

2) **Kernel API 边界（系统调用能力）**
- IPC 方法必须按 caller 进行隔离：至少进程控制范围隔离（owner-only）

## 5. 权限 → 沙箱配置映射（MVP）

v0.1 只要求映射“网络 + 文件写”两类资源：

- 网络：
  - 未声明：`allowedDomains = []`（deny-by-default）
  - 声明了 `network:egress`：允许的域名/端口来自 `criteria`

- 文件系统：
  - 系统固定允许写入：workspace、deliverables（由 SandboxPluginConfig 传入）
  - skill 若额外声明可写路径，必须显式列在 allowWrite（并且仍受 denyWrite 覆盖）

约束：
- 映射必须在 spawn 前完成；不能靠“运行后补权限”
- 运行时必须能输出“实际生效的沙箱配置摘要”（用于审计与调试）

## 6. 审计事件（MVP）

为保证可观测与可回放，v0.1 要求发布至少以下事件（EventBus）：
- `kairo.security.permission.denied`：当 IPC/工具调用因权限不足被拒绝
- `kairo.security.sandbox.violation`：当沙箱检测到违规（若实现可提供）

字段最小建议：
- `data.subject`：`agentId/skillName/processId` 至少其一
- `data.request`：被拒绝的方法或权限请求
- `data.reason`：拒绝原因（字符串）
- `correlationId/causationId`：若存在必须贯通

## 7. 依赖关系

Security 依赖：
- Sandbox（强制执行）
- Eventing（审计事件）
- Kernel（IPC 方法鉴权）
- Skills（读取 manifest 并驱动 spawn）

## 8. 验收标准（v0.1）

- 未声明网络权限的技能在沙箱内无法访问公网（平台支持时）
- caller 无法通过 IPC 控制不属于自己的进程（至少 kill/write stdin/status/wait）
- 权限不足时会产生 `kairo.security.permission.denied` 事件且包含可定位信息

