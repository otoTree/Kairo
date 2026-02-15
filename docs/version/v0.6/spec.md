# v0.6 Technical Specification: Observability & Diagnostics

## 1. 核心功能规范 (Core Features)

### 1.1 分布式追踪 (Distributed Tracing)
- **Trace Context**: 在 EventBus, IPC, Process IO 中传递 `traceId` 和 `spanId`。
- **Correlation**: 关联 User Request -> Agent Plan -> Tool Call -> Kernel IPC -> Process IO 全链路。

### 1.2 结构化日志 (Structured Logging)
- **Unified Format**: JSON 格式日志，包含 level, timestamp, component, traceId, message, metadata。
- **Centralized Collection**: 统一收集各模块日志（包括子进程 stdout/stderr）到日志中心。

### 1.3 诊断快照 (Diagnostic Snapshot)
- **Snapshot Generation**: 一键导出当前系统状态，包括：运行中进程、设备状态、最近 N 条日志/事件、环境信息。
- **Anonymization**: 敏感数据（如 API Key, User PII）在导出时自动脱敏。

## 2. 接口与协议 (Interfaces & Protocols)

### 2.1 Logging Interface
```typescript
interface Logger {
  info(msg: string, meta?: object): void;
  warn(msg: string, meta?: object): void;
  error(msg: string, err?: Error, meta?: object): void;
  // 自动注入 traceId
  withContext(ctx: TraceContext): Logger;
}
```

### 2.2 Diagnostic Methods
- `system.create_snapshot(): Promise<string>` (返回 snapshot path)
- `system.log.query(filter: LogFilter): LogEntry[]`

## 3. 模块交互 (Module Interactions)

### 3.1 追踪传播
1. EventBus 接收 `kairo.intent.started` (包含 traceId)。
2. AgentRuntime 处理事件，调用 Tool。
3. Tool Plugin 发起 IPC Request，Header 中携带 `X-Kairo-Trace-Id`。
4. Kernel 接收 IPC，记录日志携带该 traceId。
5. Kernel 启动子进程，环境变量注入 `KAIRO_TRACE_ID`。

## 4. 数据模型 (Data Models)

### 4.1 LogEntry
```typescript
interface LogEntry {
  ts: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  msg: string;
  traceId?: string;
  spanId?: string;
  component: string;
  [key: string]: any;
}
```

## 5. 异常处理 (Error Handling)
- **Snapshot Timeout**: 导出超时，返回部分快照并标记 incomplete。
- **Log Disk Full**: 日志文件达到阈值，自动轮转或丢弃低优先级日志。

## 6. 测试策略 (Testing Strategy)
- **Trace Integrity**: 模拟完整调用链，验证所有产生日志的 traceId 一致。
- **Snapshot Restore**: 验证导出的快照能否被诊断工具正确解析。
- **Performance**: 高频日志写入不阻塞主业务流程。
