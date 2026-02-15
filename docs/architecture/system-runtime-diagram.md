# Kairo AgentOS 系统运行时架构图 (System Runtime Diagram)

本文档提供了 Kairo AgentOS 运行时架构的全面可视化展示，集成了内核 (Ring 0)、核心服务 (Ring 1)、用户空间 (Ring 3) 和前端合成器 (Frontend Compositor)。

## 运行时架构概览

```mermaid
graph TD
    %% 样式定义
    classDef ring0 fill:#ffe6e6,stroke:#d9534f,stroke-width:2px,color:#333;
    classDef ring1 fill:#e6eeff,stroke:#428bca,stroke-width:2px,color:#333;
    classDef ring3 fill:#e6fffa,stroke:#1abc9c,stroke-width:2px,color:#333;
    classDef frontend fill:#fff5e6,stroke:#f0ad4e,stroke-width:2px,color:#333;
    classDef ext fill:#f9f9f9,stroke:#999,stroke-width:2px,stroke-dasharray: 5 5,color:#333;

    %% --- Frontend Layer (前端层) ---
    subgraph Frontend ["🖥️ 前端 / 合成器 (Wayland)"]
        direction TB
        UI_Shell["Kairo Linux Compositor"]
        Compositor["DRM/KMS Rendering<br/>(Direct Hardware Access)"]
        InputRouter["Input Router<br/>(libinput/udev)"]
        
        UI_Shell --> Compositor
        UI_Shell --> InputRouter
    end
    class UI_Shell,Compositor,InputRouter frontend

    %% --- Ring 3: User Space (用户空间) ---
    subgraph Ring3 ["🧠 Ring 3: 用户空间 (Agent)"]
        direction TB
        Agent["Agent Runtime<br/>(编排器)"]
        GUIToolkit["GUI 工具包<br/>(组件树)"]
        
        Agent -->|"1. 更新状态"| GUIToolkit
    end
    class Agent,GUIToolkit ring3

    %% --- Ring 0: Kernel (内核层) ---
    subgraph Ring0 ["⚙️ Ring 0: 内核 (系统)"]
        direction TB
        IPC["IPC 路由器<br/>(WebSocket/UDS)"]
        EventBus["全局事件总线<br/>(神经系统)"]
        ProcessMgr["进程管理器<br/>(启动/IO)"]
        Security["安全监控<br/>(原本性证明)"]
        
        IPC <--> EventBus
        IPC <--> ProcessMgr
        IPC <--> Security
    end
    class IPC,EventBus,ProcessMgr,Security ring0

    %% --- Ring 1: Core Services (核心服务层) ---
    subgraph Ring1 ["🛡️ Ring 1: 核心服务"]
        direction TB
        MemCube["MemCube<br/>(海马体)"]
        Vault["Vault<br/>(保险箱)"]
        DeviceMgr["设备管理器<br/>(HAL)"]
    end
    class MemCube,Vault,DeviceMgr ring1

    %% --- External Skills (外部技能) ---
    subgraph Skills ["📦 外部技能 / 进程"]
        Skill_Process["技能进程<br/>(如 Python/FFmpeg)"]
    end
    class Skill_Process ext

    %% ==============================
    %% 连接与数据流
    %% ==============================

    %% 1. 渲染循环 (Agent 原生渲染)
    GUIToolkit -- "2. 提交渲染 (KDP)" --> IPC
    IPC -- "3. 推送更新 (JSON)" --> Compositor
    InputRouter -- "4. 信号 (如 clicked)" --> IPC
    IPC -- "5. 分发信号" --> Agent

    %% 2. 认知循环 (记忆)
    Agent -- "回忆 / 记忆" --> MemCube
    MemCube -.->|"IPC (memory.*)"| IPC

    %% 3. 执行循环 (进程与工具)
    Agent -- "工具调用 (Handle)" --> IPC
    IPC -- "启动 / 管道" --> ProcessMgr
    ProcessMgr -- "标准输入输出 / 信号" --> Skill_Process
    
    %% 4. 安全循环 (盲盒)
    Skill_Process -.->|"兑换 Handle"| IPC
    IPC -.->|"验证 & 获取"| Vault
    Security -.->|"校验 PID/哈希"| Vault

    %% 5. 事件循环 (可观测性)
    Skill_Process -- "输出 / 退出" --> EventBus
    EventBus -- "广播事件" --> Agent
    EventBus -- "日志 / 追踪" --> Frontend

    %% 物理连接
    MemCube <--> IPC
    Vault <--> IPC
    DeviceMgr <--> IPC
```

## 关键流程说明

1.  **渲染循环 (Qt-Wayland 风格)**
    *   **Agent** 更新其内部状态并使用 **GUI Toolkit** 生成 `RenderNode` 树。
    *   工具包通过 **IPC** 发送 `kairo.agent.render.commit` 事件。
    *   **IPC 路由器** 将此更新推送到 **前端合成器 (Compositor)**。
    *   用户交互由 **输入路由 (Input Router)** 捕获，并作为 `kairo.ui.signal` 事件发回给 Agent。

2.  **认知循环 (记忆)**
    *   在行动之前，Agent 通过 IPC 调用 `memory.recall` 从 **MemCube** 获取上下文。
    *   行动之后，Agent 调用 `memory.add` 存储结果。
    *   **MemCube** 作为核心服务运行，管理向量存储和键值存储。

3.  **安全执行 (盲盒)**
    *   Agent 将 **安全句柄 (Secure Handle)** (如 `sh_123`) 传递给技能，而不是原始密钥。
    *   **进程管理器** 启动技能进程。
    *   技能请求兑换句柄。
    *   **安全监控 (Security Monitor)** 验证技能的身份 (PID, 二进制哈希)。
    *   **Vault (保险箱)** 将密钥直接释放到技能的内存中。

4.  **事件系统**
    *   所有系统状态变更 (进程 IO、工具结果、用户消息) 都流经 **全局事件总线**。
    *   Agent 订阅相关事件以驱动其决策循环。
