# Local Database Specification & PRD

## 1. Overview
Kairo 需要一个本地数据库解决方案，用于在边缘设备（如 Raspberry Pi）上持久化数据。首要目标是实现 **Event Sourcing** 的持久化存储，确保系统重启后事件历史不丢失，并支持未来的状态查询和分析。

### Goals
- **Persistence**: 持久化存储系统事件 (`kairo.*`)。
- **Performance**: 在低功耗设备（树莓派 4/5）上保持高性能。
- **Scalability**: 支持数百万级事件存储，支持索引查询。
- **Simplicity**: 零配置，随应用启动，无需独立守护进程。

## 2. Technology Selection

### Selected: SQLite
我们选择 **SQLite** 作为底层存储引擎。

#### Rationale
1.  **Zero Configuration**: 它是嵌入式的，不需要安装和维护额外的数据库服务器（如 PostgreSQL/MySQL），非常适合树莓派环境。
2.  **Single File**: 数据存储在单个文件中，易于备份和迁移。
3.  **Performance**: 对于单写多读的场景（如事件日志），SQLite 性能极佳（WAL 模式）。
4.  **Ecosystem**: Node.js 生态中有优秀的驱动支持 (`better-sqlite3`)。

### Selected: Kysely (Query Builder)
我们选择 **Kysely** 作为 SQL 构建器和轻量级 ORM。

#### Rationale
1.  **Type Safety**: 提供端到端的 TypeScript 类型安全，无需代码生成（相比 Prisma 更轻量）。
2.  **Performance**: 运行时开销极小，仅仅是构建 SQL 字符串。
3.  **Flexibility**: 支持 SQLite，且未来如果需要迁移到 Postgres，只需更换 Dialect。

*Alternative considered: Prisma (too heavy for Pi sometimes), TypeORM (complex).*

## 3. Architecture Design

遵循 Kairo 的 **Vertical Domain Slicing** 架构原则，我们将创建一个新的领域模块：`src/domains/database`。

### Directory Structure
```
src/domains/database/
├── database.plugin.ts    # Plugin definition (Lifecycle management)
├── client.ts             # Kysely instance & SQLite connection
├── migrator.ts           # Database migration logic
├── types.ts              # Database schema types
├── migrations/           # Migration files
│   └── 001_init.ts
└── repositories/         # Data access layers
    └── event-repository.ts
```

### Integration Pattern
- **Database Plugin**: 负责在应用启动时初始化数据库连接，运行 Pending Migrations，并在关闭时断开连接。
- **Dependency Injection**: Database 实例可以通过 Context 或直接作为单例导出的方式被其他模块（如 `events` domain）使用。
- **Event Persistence**: `EventStore` (in `src/domains/events`) 将使用 `EventRepository` 来异步写入事件。

## 4. Schema Design

### Table: `events`
用于存储全局事件总线中的所有事件。

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (UUID) | Primary Key |
| `type` | TEXT | Event type (e.g., `kairo.user.message`) |
| `source` | TEXT | Event source/emitter |
| `payload` | TEXT (JSON) | JSON serialized event data |
| `metadata` | TEXT (JSON) | JSON serialized metadata (timestamp, correlationId) |
| `created_at` | INTEGER | Timestamp (ms) for sorting |

**Indexes**:
- `idx_events_type`: 加速按类型查询。
- `idx_events_created_at`: 加速按时间范围查询。
- `idx_events_metadata_trace`: (Optional) 用于追踪 traceId/causationId。

### Table: `kv_store` (Optional, Phase 2)
用于简单的状态持久化（如 Agent 的记忆快照）。

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT | Primary Key |
| `value` | TEXT (JSON) | Stored value |
| `updated_at` | INTEGER | Last update timestamp |

## 5. Implementation Specifications

### 5.1 Dependencies
```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "kysely": "^0.27.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

### 5.2 CRUD Operations
- **Insert**: `saveEvent(event: KairoEvent): Promise<void>`
- **Query**:
    - `getEvents(filter: { type?: string, limit?: number, since?: number }): Promise<KairoEvent[]>`
    - `getEventById(id: string): Promise<KairoEvent | null>`

### 5.3 Resilience
- **WAL Mode**: 必须启用 Write-Ahead Logging (`PRAGMA journal_mode = WAL`) 以提高并发性能。
- **Synchronous**: 设置为 `NORMAL` 平衡性能与数据安全。

## 6. Roadmap
1.  **Phase 1**: 建立 `database` domain，实现 SQLite 连接和 `events` 表迁移。
2.  **Phase 2**: 修改 `EventStore` (in `src/domains/events`)，使其支持持久化适配器。
3.  **Phase 3**: 实现数据回放（Replay）机制，用于系统恢复。
