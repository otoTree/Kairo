# Product Requirements Document (PRD): Kairo Agent OS

## 1. Introduction
### 1.1 Product Name
Kairo Agent OS

### 1.2 Vision & Background
Kairo is evolving from a simple LLM Agent Runtime into a full-fledged **Agent Operating System**. The core vision is to empower Agents with capabilities beyond text processing, enabling them to:
- **Interact with the physical world** (Hardware I/O).
- **Manage system resources** (Process/Memory management).
- **Extend capabilities via "Intelligence Defined Software"** (Skills).

In this paradigm, Agents are "first-class citizens" (like processes in a traditional OS), and "Skills" are dynamic software units orchestrated by intelligence.

### 1.3 Goals
- **Unified Kernel**: Build a high-performance, native kernel (TypeScript/Rust/C++) independent of MCP for core operations.
- **Hardware Abstraction**: Provide standardized, secure access to physical hardware (USB, Serial, GPIO, Camera).
- **Skill Ecosystem**: Enable Agents to deploy and control binary applications and AI models as "Skills".
- **Deep System Integration**: Leverage custom Linux capabilities (PTY, FFI, D-Bus, UDS) for low-latency, high-performance operations.

## 2. User Stories
- **As a Developer**, I want to create "Skills" that include compiled binaries so that my Agent can perform high-performance tasks (e.g., signal processing).
- **As an IoT Integrator**, I want my Agent to automatically detect and configure USB devices so that I don't have to manually map `/dev/tty` paths.
- **As a User**, I want to grant granular permissions (e.g., "access camera") to an Agent so that I maintain security control.
- **As an Agent**, I want to spawn background terminals to run long-running tasks even after the user session disconnects.

## 3. System Architecture

### 3.1 High-Level Architecture
- **User Space**: Agents, Skills (Intelligence Defined Software), 3rd Party MCP Tools.
- **Kairo Kernel**: Orchestrator, Security Monitor, HAL, Global Event Bus.
- **Physical Hardware**: USB, Serial/GPIO, Network, Compute.

### 3.2 Core Principles
- **Kernel Unification**: Core functions (Process/Memory/Drivers) are native (TS/Rust/C++), using internal IPC/Shared Memory, NOT MCP.
- **Role of MCP**: Strictly for **external** extension (3rd party tools like Slack/GitHub). Not for internal kernel comms.
- **Skills as Intelligence Defined Software**: Skills are dynamic, potentially containing binaries or AI models, managed/configured by the Agent.

## 4. Functional Requirements

### 4.1 Kernel & Core
| ID | Feature | Description | Priority |
| :--- | :--- | :--- | :--- |
| K-01 | **Native Kernel Protocol** | Implement high-performance internal IPC for kernel components (bypassing MCP). | P0 |
| K-02 | **Global Event Bus** | Unified bus for system-wide events (Hardware, Agent, User). | P0 |
| K-03 | **SystemInfo Module** | Native module to retrieve real-time system status (CPU, RAM, Processes). | P1 |

### 4.2 Hardware Abstraction Layer (HAL)
| ID | Feature | Description | Priority |
| :--- | :--- | :--- | :--- |
| H-01 | **Device Registry** | Dynamic tracking of connected devices (USB, Serial, Camera). | P1 |
| H-02 | **Semantic Device Paths** | Auto-mapping of devices to stable paths (e.g., `agent://tty_sensor`) based on VID/PID. | P1 |
| H-03 | **Standard Interfaces** | Unified APIs for `serial` (Stream), `gpio` (I/O), and `camera` (Frame Stream). | P2 |
| H-04 | **Direct Hardware Access** | Native bindings (FFI) for hardware control, bypassing MCP for latency. | P1 |

### 4.3 Skills & Execution Environment
| ID | Feature | Description | Priority |
| :--- | :--- | :--- | :--- |
| S-01 | **Binary Skill Support** | Ability to package, verify, and execute compiled binaries (ARM64/x64) as Skills. | P1 |
| S-02 | **High-Performance IPC** | Unix Domain Sockets / Shared Memory support for Agent <-> Binary communication. | P1 |
| S-03 | **Infinite Terminals** | Support for persistent background PTY sessions (via `tmux`/`screen` logic). | P2 |
| S-04 | **Atomic Skill Library** | Pre-bundled common FFI libraries (OpenCV, SQLite, FFmpeg) for instant use. | P2 |

### 4.4 Security
| ID | Feature | Description | Priority |
| :--- | :--- | :--- | :--- |
| SEC-01 | **Permission Manifests** | Declarative permissions for Skills (e.g., `device: serial`). | P0 |
| SEC-02 | **User Consent Flow** | Kernel-level interception for critical resource access requests. | P0 |
| SEC-03 | **Sandboxed Execution** | Isolate binary skills to prevent system compromise. | P1 |

## 5. Non-Functional Requirements
- **Latency**: Hardware control loop latency < 10ms for critical operations via native bindings.
- **Stability**: Kernel must survive crashes of individual Agents or Skills.
- **Compatibility**: Core system targets custom Linux (Yocto/Buildroot), but runtime should support macOS/Linux for dev.

## 6. Roadmap

### Phase 1: System Perception & Kernel Foundation
- [ ] Define non-MCP Kernel API specifications.
- [ ] Implement `SystemInfo` native module.
- [ ] Establish Native IPC mechanisms.

### Phase 2: Intelligence Defined Software Foundation
- [ ] Upgrade `Skill` architecture to support binary distribution.
- [ ] Implement Lifecycle Management (Start/Stop/Monitor) for binary processes.
- [ ] Implement Unix Domain Socket communication for Agents.

### Phase 3: Hardware Interface Takeover
- [ ] Implement `DeviceManager` and Device Registry.
- [ ] Develop native bindings for Serial/GPIO.
- [ ] Demo: Agent controlling a physical device via a loaded binary skill.

## 7. Open Questions / Risks
- **Security Model**: How to effectively sandboxing binary skills without hampering performance?
- **Driver Compatibility**: Managing diverse hardware drivers across different host Linux versions.
- **Resource Limits**: Preventing Agents/Skills from exhausting system resources (CPU/RAM).
