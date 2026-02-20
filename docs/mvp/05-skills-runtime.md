# Skills Runtime（Registry + Runners + Tool Surface）规格说明（MVP）

## 1. 目标

为 Agent 提供“可装配、可执行、可受控”的技能层（tools/skills），并与 Kernel/Sandbox/事件系统形成闭环：
- 技能发现与注册（目录扫描 + manifest）
- 执行形态（至少支持 script 与 binary 的最小闭环）
- 权限声明与执行路径联动（deny-by-default）
- 对 Agent 暴露稳定的工具面（system tools），并事件化结果

## 2. 范围与非目标

进入 v0.1：
- SkillRegistry：扫描 `skillsDir`，加载 `manifest.*` 与 `SKILL.md`
- Script runner：在沙箱内执行脚本（当前为 Python）
- Binary runner：以后台进程启动二进制，并注入 `KAIRO_IPC_SOCKET`
- 工具注册：向 AgentRuntime 注册 system tool（如 equip/search/run_script）

不进入 v0.1：
- artifacts 分发/校验/升级/回滚
- wasm/container 运行形态的完整实现
- skill 运行时的多进程共享与分布式调度

## 3. 现状对齐（代码基线）

- Skills 插件：[skills.plugin.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/skills.plugin.ts)
- Registry：[registry.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/registry.ts)
- Manifest v2 types：[manifest.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/manifest.ts)
- BinaryRunner（注入 IPC socket）：[binary-runner.ts](file:///Users/hjr/Desktop/Kairo/src/domains/skills/binary-runner.ts)

参考背景：
- [agentos-mvp.md](file:///Users/hjr/Desktop/Kairo/docs/architecture/agentos-mvp.md)

## 4. 技能打包与发现（稳定约定）

### 4.1 目录结构（推荐）

一个 skill 目录至少满足其一：
- 提供 `manifest.yaml|kairo.yaml|manifest.json`（v2）
- 或提供 `SKILL.md` 且带 legacy front-matter（兼容）

可选：
- `scripts/`：脚本入口集合（v0.1 以 Python 为主）
- `bin/`：平台相关二进制

### 4.2 Manifest v2（最小要求）

必须字段：
- `name` / `version` / `type` / `description`

可选字段（v0.1 会消费）：
- `artifacts.binaries[platform] = path`
- `permissions[]`
- `interfaces`（目前仅作为声明）

## 5. 执行形态（v0.1）

### 5.1 Script Runner（沙箱执行）

约束：
- 必须使用 SandboxManager 包装命令后再执行
- 执行必须在临时目录或 workspace 内进行（避免污染宿主）
- 必须返回结构化结果：stdout/stderr/exitCode

### 5.2 Binary Runner（后台进程）

约束：
- 必须注入 `KAIRO_IPC_SOCKET`，允许二进制选择性连接 Kernel
- 进程管理必须委托给 Kernel 的 ProcessManager（统一治理与事件化）

## 6. 对 Agent 的工具面（system tools）

MVP 要求 SkillsPlugin 至少提供：
- `equip_skill`：让 Agent 获取技能说明（并可触发 binary 启动）
- `search_skills`：列出/检索可用技能
- `run_skill_script`：按名称执行脚本

工具执行结果必须以事件形式发布（用于回放与 UI），最小事件：
- `kairo.tool.result`（source: `system:skills` 或 `tool:skills`）

## 7. 依赖关系

Skills Runtime 依赖：
- Core Runtime（插件装配）
- Agent Runtime（注册 system tools）
- Sandbox（脚本执行、权限强制）
- Kernel（进程会话与 IO 原语）
- Eventing（发布 tool.result 与 skill.equipped 等事件）

Skills Runtime 被依赖：
- Agent（通过工具调用驱动技能）
- Server/UI（展示 tool.result 与技能状态）

## 8. 验收标准（MVP）

- 扫描 skills 目录可加载至少一个技能（manifest 或 SKILL.md）
- `equip_skill` 可返回技能说明，并在存在 binary artifact 时能启动后台进程
- `run_skill_script` 在沙箱内执行并返回 stdout/stderr/exitCode
- 权限未声明时默认拒绝出网（平台支持时）

