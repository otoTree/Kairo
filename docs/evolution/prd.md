# Kairo AgentOS 功能演进 — 产品需求文档 (PRD)

> 版本：v0.2
> 日期：2026-02-20
> 状态：草案

---

## 1. 背景

Kairo 已完成 MVP v0.1 的核心架构搭建（插件系统、Agent Runtime、事件总线、MemCube、沙箱、Skills、MCP、Vault、River/KDP 集成）。但在实际可用性上仍有关键缺口：

- Agent 无法与任意二进制程序全双工通信（Process IO 原语未暴露）
- 事件链路缺少取消语义，无法实现"中途插话"
- 权限模型未在执行路径中生效
- 多 Agent 协作能力缺失
- UI 合成器仅有状态管理，无用户交互回传

## 2. 目标用户

- 开发者：在本地机器上运行 Kairo，让 AI Agent 辅助日常开发
- 硬件爱好者：通过 Agent 控制 Arduino/传感器等外设
- 系统管理员：通过 Agent 自动化运维任务

## 3. 核心需求

### 3.1 Process IO 全双工通信

**用户故事**：作为 Agent，我需要能向子进程写入 stdin、订阅 stdout/stderr，以便与 FFmpeg、Python REPL 等程序交互。

**验收标准**：
- Agent 可通过 `process.stdin.write(pid, data)` 向子进程写入
- Agent 可通过 `process.stdout.subscribe(pid, mode)` 订阅输出（chunk/line 模式）
- 支持 `process.wait(pid)` 等待进程退出
- 支持 `process.status(pid)` 查询进程状态
- 有 backpressure 机制防止 OOM

### 3.2 IPC 服务端推送

**用户故事**：作为外部 Skill 进程，我需要能接收来自 Kernel 的事件推送，而不是轮询。

**验收标准**：
- IPC 协议支持 `EVENT` 帧类型（结构化事件推送）
- IPC 协议支持 `STREAM_CHUNK` 帧类型（二进制流推送）
- 客户端可通过 `subscribe`/`unsubscribe` 管理订阅

### 3.3 事件序列语义

**用户故事**：作为用户，我在 Agent 执行长任务时发送新消息，Agent 应能中断当前任务并响应。

**验收标准**：
- 所有事件强制携带 `correlationId` / `causationId`
- 支持 `cancel` 事件传播到进程终止
- 工具层贯通 `actionId` → `tool.invoke` → `tool.result`

### 3.4 权限闭环

**用户故事**：作为用户，我希望 Skill 只能访问其 manifest 中声明的资源。

**验收标准**：
- manifest permissions 自动映射到 sandbox enforcement
- IPC 方法级鉴权（caller 只能控制自己创建的进程）
- deny-by-default 策略强制执行

### 3.5 Agent 协作

**用户故事**：作为用户，我希望多个 Agent 能协作完成复杂任务。

**验收标准**：
- Agent 间可通过 EventBus topic 传递消息
- 支持任务委派（parent → child Agent）
- Agent 可声明自身能力（capability advertisement）

### 3.6 UI 交互闭环

**用户故事**：作为用户，我点击 Agent 渲染的按钮时，Agent 应能收到事件并响应。

**验收标准**：
- KDP `user_action` 事件实现（用户交互回传）
- UI diff 算法减少重绘
- 信号路由：UI 事件 → Agent 事件

## 4. 非功能需求

- Process IO 延迟 < 10ms（本地 IPC）
- 单 Agent tick 延迟 P99 < 500ms
- 内存占用 < 512MB（基础运行时）
- 支持 x86_64 和 aarch64 Linux

## 5. 排除范围

- 分布式 Agent 集群（v0.3+）
- GPU 加速推理（v0.3+）
- 自定义 Linux 发行版 ISO 构建（v0.3+）
