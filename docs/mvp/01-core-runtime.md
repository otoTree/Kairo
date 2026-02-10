# Core Runtime（插件系统）规格说明（MVP）

## 1. 目标

提供一个稳定、可扩展的“微内核 + 插件”运行时：
- Core 只负责插件生命周期编排与服务注册/发现
- 领域能力（Agent/Kernel/Skills/DB/Server/Sandbox/Device/AI/MCP）必须以插件形式装配
- 插件之间通过显式 service 获取交互，避免跨域直接实例化对方内部对象

## 2. 范围

v0.1 覆盖：
- 插件生命周期：`setup → start → stop`
- 服务注册与获取：`registerService/getService`
- 启动顺序可控（由装配层 `src/index.ts` 决定）

不在 v0.1 覆盖：
- 插件热插拔、热升级
- 插件依赖声明与自动拓扑排序（目前由装配顺序保证）

## 3. 现状对齐（代码基线）

- Core 应用容器：[app.ts](file:///Users/hjr/Desktop/Kairo/src/core/app.ts)
- 插件接口：[plugin.ts](file:///Users/hjr/Desktop/Kairo/src/core/plugin.ts)
- 运行时装配顺序：[index.ts](file:///Users/hjr/Desktop/Kairo/src/index.ts)

## 4. 对外契约

### 4.1 Plugin 接口

插件必须实现：
- `name: string`（唯一）
- `setup(app: Application): void | Promise<void>`

插件可选实现：
- `start(): void | Promise<void>`
- `stop(): void | Promise<void>`

### 4.2 Application 容器能力

必须提供：
- `use(plugin)`：注册插件并执行 `setup`
- `start()`：按注册顺序执行每个插件的 `start`
- `stop()`：按注册顺序执行每个插件的 `stop`
- `registerService(name, service)`：将 service 放入容器（可为实例或类，取决于领域约定）
- `getService(name)`：按 name 获取 service；不存在则抛错

## 5. 依赖关系与装配规则（必须）

### 5.1 依赖方向

Core 不依赖任何领域插件；所有领域插件依赖 Core 提供的容器能力。

### 5.2 装配顺序约束（当前代码事实）

以 `src/index.ts` 为准，关键约束：
- Agent 在 Kernel 之前启动：Kernel 需要拿到 Agent 的 globalBus 才能桥接事件/注册工具
- Device 在 Kernel 之后启动：DevicePlugin 依赖 Kernel 暴露的 deviceRegistry
- Skills 在 Agent 之后 setup：SkillsPlugin 会尝试注册系统工具到 Agent

## 6. 验收标准

- 插件重复注册会被拒绝（name 唯一）
- 任意插件在 `setup` 内可注册 service，并在后续插件的 `setup/start` 中可被获取
- `start/stop` 生命周期按注册顺序执行

