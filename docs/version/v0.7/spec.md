# v0.7 Technical Specification: State & Recovery

## 1. 核心功能规范 (Core Features)

### 1.1 实体持久化 (Entity Persistence)
- **State Store**: 使用轻量级 KV 数据库（如 LMDB/SQLite）存储 Kernel 核心实体状态。
- **Persisted Entities**: ProcessSession (pid, cmd, start_time), DeviceClaim (lease, owner), AgentContext.

### 1.2 事件投影 (Event Projection)
- **Event Sourcing**: 系统状态由事件流聚合而成。
- **Snapshotting**: 定期对 Event Log 做快照（Projection），加速启动和查询。
- **Compaction**: 压缩旧事件，仅保留当前状态所需的有效信息。

### 1.3 崩溃恢复 (Crash Recovery)
- **Resume**: Kernel 重启后，读取持久化状态，尝试恢复/重连之前的子进程和设备。
- **Reconciliation**: 对比实际系统状态（如 `ps` 结果）与存储状态，进行修正（如标记僵尸进程为 dead）。

## 2. 接口与协议 (Interfaces & Protocols)

### 2.1 State Methods
- `kernel.state.save(): Promise<void>` (手动触发 checkpoint)
- `kernel.state.restore(checkpointId?: string): Promise<void>`

### 2.2 Persistence Schema
- Key: `process:{id}` -> Value: JSON(ProcessState)
- Key: `device:{id}:claim` -> Value: JSON(ClaimState)
- Key: `projection:agent:{id}` -> Value: JSON(AgentState)

## 3. 模块交互 (Module Interactions)

### 3.1 恢复流程
1. Kernel 启动。
2. 加载 State Store。
3. 遍历 `active` 状态的 Process 记录。
4. 检查 PID 是否存在且匹配。
   - 存在: 重新接管 IO 管道。
   - 不存在: 标记为 `abnormal_exit`，发布 `process.exited` 事件。
5. 恢复 Device Claims。

## 4. 数据模型 (Data Models)

### 4.1 Checkpoint
```typescript
interface Checkpoint {
  id: string;
  timestamp: number;
  entities: {
    processes: ProcessState[];
    devices: DeviceClaim[];
  };
  eventLogOffset: number;
}
```

## 5. 异常处理 (Error Handling)
- **State Corrupted**: 状态文件损坏，启动失败或回退到空状态（需备份）。
- **Orphan Process**: 发现未记录的 Kairo 子进程，尝试接管或 Kill。

## 6. 测试策略 (Testing Strategy)
- **Crash Test**: `kill -9` Kernel 进程，重启后验证状态一致性。
- **Projection Accuracy**: 对比从零重放事件流与读取快照的状态是否一致。
