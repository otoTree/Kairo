# v0.1 Technical Specification: Kernel Foundation

## 1. 核心功能规范 (Core Features)

### 1.1 IPC 通信基础
- **Unix Domain Socket**: 默认路径 `/tmp/kairo-kernel.sock`。
- **Frame Protocol**: 8 字节定长 Header (Magic + Version + Type + Length) + MsgPack Payload。
- **通信模式**: 支持 Request/Response (RPC) 模型。
- **环境注入**: 启动子进程时注入 `KAIRO_IPC_SOCKET` 环境变量。

### 1.2 进程管理 (Process Management)
- **Spawn**: 支持启动外部二进制进程，配置 cwd, env, resource limits。
- **IO Control**: 
  - 支持 stdin 写入。
  - 支持 stdout/stderr 的流式订阅（通过 IPC Event 或 Stream Chunk）。
- **Lifecycle**: 支持 `kill` (SIGTERM/SIGKILL), `pause` (SIGSTOP), `resume` (SIGCONT)。

### 1.3 基础权限与审计 (Basic Auth & Audit)
- **权限声明**: 进程启动时需声明所需权限（如 fs, net）。
- **审计日志**: 记录所有 IPC 调用与进程生命周期事件。

## 2. 接口与协议 (Interfaces & Protocols)

### 2.1 IPC Header Structure
```
0               1               2               3               4               7
|   MAGIC(2)    | VERSION(1)    | TYPE(1)       | LENGTH(4)                 |
```
- Magic: `0x4B41` ("KA")
- Version: `1`
- Type: `REQUEST(1)`, `RESPONSE(2)`, `EVENT(3)`, `STREAM_CHUNK(4)`

### 2.2 Core Methods
- `system.get_metrics()`: 获取系统负载信息。
- `process.spawn(id, command, options)`: 启动子进程。
- `process.kill(id, signal)`: 终止子进程。
- `process.stdin.write(id, data)`: 向子进程 stdin 写入数据。

## 3. 模块交互 (Module Interactions)

### 3.1 启动流程
1. Kernel 初始化 IPCServer，监听 socket。
2. Client (如 CLI) 连接 socket。
3. Client 发送 `process.spawn` 请求。
4. Kernel 校验权限，通过 Node.js `child_process.spawn` 启动目标程序。
5. Kernel 返回 `pid` 和内部 `processId`。

### 3.2 IO 转发流程
1. 子进程产生 stdout 数据。
2. Kernel 捕获数据，封装为 `STREAM_CHUNK` 类型包。
3. Kernel 将包推送给订阅该进程输出的 Client。

## 4. 数据模型 (Data Models)

### 4.1 ProcessConfig
```typescript
interface ProcessConfig {
  id: string;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  limits?: {
    cpu?: number;
    memory?: number; // bytes
  };
}
```

## 5. 异常处理 (Error Handling)
- **IPC 解析错误**: 断开连接，记录错误日志。
- **权限不足**: 返回标准错误码 `E_PERMISSION_DENIED`，触发安全审计事件。
- **进程崩溃**: Kernel 捕获 exit code，广播 `process.exited` 事件。

## 6. 测试策略 (Testing Strategy)
- **Unit Test**: 验证 IPC 编解码的正确性。
- **Integration Test**: 启动真实子进程 (如 `ls`, `grep`)，验证输入输出管道是否畅通。
- **E2E**: 模拟 CLI 连接 Kernel，执行完整生命周期操作。
