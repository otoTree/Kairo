# v0.2 Technical Specification: Core Services

## 1. 核心功能规范 (Core Features)

### 1.1 记忆服务 (MemCube Integration)
- **L1/L2 存储**: 集成 LMDB (KV) 和 HNSW (Vector) 基础库。
- **CRUD**: 提供 `memory.add` (写入) 和 `memory.recall` (检索) 接口。
- **Embedding**: 集成基础 Embedding 模型（或通过 API 转发）用于向量化。

### 1.2 安全保险箱 (Vault)
- **Handle 机制**: 敏感数据不直接传输，通过 UUID Handle 引用。
- **Store**: 将敏感数据（如 API Key）存入 Vault，返回 Handle。
- **Resolve**: 在受信任的执行环境（如 HTTP 请求发起处）解析 Handle。
- **Scope**: Handle 绑定到特定的 Session 或 Request，防止泄露。

### 1.3 运行时身份 (Runtime Identity)
- **Token 注入**: Kernel 启动 Agent/Skill 进程时，注入临时的 Runtime Token。
- **Attestation**: IPC 调用时携带 Token，Kernel 验证调用方身份。

## 2. 接口与协议 (Interfaces & Protocols)

### 2.1 Memory Methods
- `memory.add(content: string, meta: object): string`
  - 返回 memoryId。
- `memory.recall(query: string, limit: number): MemoryItem[]`
  - 返回包含 content, similarity, metadata 的列表。

### 2.2 Vault Methods
- `vault.store(value: string, ttl?: number): string`
  - 返回 handle (e.g., `vlt_abc123`).
- `vault.resolve(handle: string): string`
  - 仅限 Kernel 内部或特权插件调用。

## 3. 模块交互 (Module Interactions)

### 3.1 记忆存储流程
1. Agent 产生交互数据。
2. Agent 调用 `memory.add`。
3. MemCube Service 接收请求，计算 Embedding。
4. 数据写入 LMDB，向量写入 HNSW 索引。
5. 返回 ID。

### 3.2 敏感配置使用流程
1. 用户配置 API Key，System 调用 `vault.store` 存入，获得 Handle。
2. Agent 调用 Tool，参数包含 Handle。
3. Tool Plugin 接收请求，在发起 HTTP 请求前调用 `vault.resolve` 获取真实 Key。
4. Tool 执行操作，日志中仅记录 Handle。

## 4. 数据模型 (Data Models)

### 4.1 MemoryItem
```typescript
interface MemoryItem {
  id: string;
  content: string;
  vector?: number[]; // 通常不返回给普通调用者
  metadata: {
    timestamp: number;
    source: string;
    importance?: number;
  };
}
```

## 5. 异常处理 (Error Handling)
- **Handle 无效/过期**: `vault.resolve` 抛出 `E_VAULT_INVALID_HANDLE`。
- **身份验证失败**: IPC 请求未携带有效 Token，直接拒绝。

## 6. 测试策略 (Testing Strategy)
- **Security Test**: 尝试使用伪造 Token 调用特权接口，验证拒绝逻辑。
- **Vault Test**: 验证 Handle 在不同 Session 间的隔离性。
- **Memory Test**: 写入多条数据，验证 Recall 的相关性排序。
