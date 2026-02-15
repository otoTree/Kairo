# Kairo AgentOS 系统架构图 (System Architecture Diagram)

本文档展示了 Kairo AgentOS 的静态分层架构（Ring Model）。与关注数据流的[运行时架构图](./system-runtime-diagram.md)不同，本图侧重于展示系统的**层级结构**、**模块边界**与**包含关系**。

## 环形架构模型 (The Ring Model)

Kairo 采用类似操作系统内核的 Ring 架构，将系统划分为三个特权层级。

```mermaid
graph TD
    %% 样式定义
    classDef ring3 fill:#e6fffa,stroke:#1abc9c,stroke-width:2px,color:#333;
    classDef ring1 fill:#e6eeff,stroke:#428bca,stroke-width:2px,color:#333;
    classDef ring0 fill:#ffe6e6,stroke:#d9534f,stroke-width:3px,color:#333;
    classDef infra fill:#f3f3f3,stroke:#999,stroke-width:1px,stroke-dasharray: 5 5,color:#666;
    classDef shell fill:#fff5e6,stroke:#f0ad4e,stroke-width:2px,color:#333;

    %% --- 最上层：交互层 ---
    subgraph Presentation ["🖥️ 交互层 (Presentation Layer)"]
        direction TB
        Shell["Kairo Shell (Wayland Compositor)<br/>[Linux Native: Rust/Smithay]"]
        CLI["CLI 终端工具"]
        
        Shell_Modules["Shell 模块:<br/>- 窗口管理器 (WM)<br/>- 表面合成 (Surface Composition)<br/>- 输入管理 (libinput)"]
        
        Shell --- Shell_Modules
    end
    class Shell,CLI,Shell_Modules shell

    %% --- Ring 3: 用户空间 ---
    subgraph Ring3 ["🧠 Ring 3: 用户空间 (User Space)"]
        direction TB
        
        subgraph Agents ["智能体 (Agents)"]
            DevOpsAgent["DevOps Agent"]
            WriterAgent["Writer Agent"]
            Router["Agent 路由器"]
        end
        
        subgraph Ext ["扩展 (Extensions)"]
            LocalSkills["本地技能 (Skills)<br/>(Filesystem, Git)"]
            RemoteSkills["远程技能 (MCP)"]
        end
        
        Agents -->|"使用"| Ext
        Agents -->|"GUI 渲染"| Shell
    end
    class Agents,Ext,DevOpsAgent,WriterAgent,Router,LocalSkills,RemoteSkills ring3

    %% --- Ring 1: 核心服务 ---
    subgraph Ring1 ["🛡️ Ring 1: 核心服务 (Core Services)"]
        direction LR
        MemCube["MemCube (海马体)<br/>- 向量数据库<br/>- 键值存储"]
        Vault["Vault (保险箱)<br/>- 密钥管理<br/>- 句柄映射"]
        DeviceMgr["Device Mgr (设备管理)<br/>- 硬件抽象层 (HAL)"]
    end
    class MemCube,Vault,DeviceMgr ring1

    %% --- Ring 0: 内核 ---
    subgraph Ring0 ["⚙️ Ring 0: 内核 (Kernel)"]
        direction TB
        
        subgraph Kernel_Core ["核心组件"]
            IPC_Router["IPC 路由器<br/>(Socket/MsgPack)"]
            Event_Bus["全局事件总线<br/>(Event Sourcing)"]
        end
        
        subgraph Kernel_Mgr ["资源管理"]
            Process_Mgr["进程管理器<br/>(Process Mgr)"]
            Security_Mon["安全监控器<br/>(Security Monitor)"]
        end
        
        IPC_Router <--> Event_Bus
        IPC_Router <--> Process_Mgr
        IPC_Router <--> Security_Mon
    end
    class IPC_Router,Event_Bus,Process_Mgr,Security_Mon ring0

    %% --- 基础设施 ---
    subgraph Infra ["🏗️ 基础设施 (Infrastructure)"]
        HostOS["宿主操作系统 (macOS/Linux/Windows)"]
        Hardware["物理硬件 (CPU/Mem/Disk/Net)"]
    end
    class HostOS,Hardware infra

    %% ==============================
    %% 层级依赖关系
    %% ==============================

    %% 交互层 -> 用户空间
    Shell ==>|"渲染指令 / 用户输入"| Ring3

    %% 用户空间 -> 内核 (Syscalls)
    Ring3 ==>|"系统调用 (IPC)"| Ring0
    Ring3 -.->|"受限访问"| Ring1

    %% 核心服务 -> 内核
    Ring1 ==>|"特权 IPC"| Ring0

    %% 内核 -> 基础设施
    Ring0 ==>|"Spawn / IO"| HostOS
```

## 架构层级详解

### 1. 交互层 (Presentation Layer)
这是用户“看到”的部分。
*   **Kairo Shell**: 相当于桌面环境 (Desktop Environment)。它不产生内容，只负责**展示** Ring 3 中 Agent 生成的内容，并捕获用户输入。
*   **CLI**: 供开发者或无头模式使用的命令行接口。

### 2. Ring 3: 用户空间 (User Space)
这是业务逻辑发生的地方，也是生态扩展的层级。
*   **Agents**: 纯粹的逻辑单元。它们没有“身体”（不直接持有文件句柄或密钥），完全通过发送指令（Events/IPC）来工作。
*   **Skills**: 实际干活的工具。运行在沙箱进程中，由 Agent 编排。

### 3. Ring 1: 核心服务 (Core Services)
这是 Kairo 的“增强组件”，提供了传统 OS 没有的高级能力。
*   **MemCube**: 系统的长期记忆存储。
*   **Vault**: 系统的安全凭证保管库。
*   **Device Manager**: 统一管理摄像头、麦克风、GPIO 等硬件资源。

### 4. Ring 0: 内核 (Kernel)
这是 Kairo 的心脏，负责最底层的资源调度与通信。
*   **IPC Router**: 神经中枢，所有跨进程通信都必须经过它。
*   **Event Bus**: 系统的“意识流”，记录所有发生过的事件。
*   **Process Manager**: 负责启动、停止、监控所有 Ring 3 和 Ring 1 的进程。
*   **Security Monitor**: 负责校验权限，确保 Ring 3 的组件不能越权访问 Ring 1 或 Ring 0。
