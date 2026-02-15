# v1.0 Technical Specification: General Availability (GA)

## 1. 核心功能规范 (Core Features)

### 1.1 全链路验收 (E2E Acceptance)
- **Golden Flows**: 覆盖 80% 用户场景的核心链路（记忆、工具、设备、协作）。
- **UX Polish**: 错误提示友好化、CLI 交互优化、文档完整性。

### 1.2 发布流水线 (Release Pipeline)
- **Automated Build**: CI 自动构建多平台 Artifacts。
- **Signing**: 对二进制和 Manifest 进行数字签名。
- **Distribution**: 搭建稳定分发源（CDN/S3）。

### 1.3 迁移工具 (Migration Tools)
- **Data Migration**: 支持 v0.x 到 v1.0 的数据格式升级。
- **Config Migration**: 自动转换旧版配置文件。

## 2. 接口与协议 (Interfaces & Protocols)

### 2.1 System Methods
- `system.version()`: 获取详细版本信息（Commit, Build Date）。
- `system.check_update()`: 检查新版本。
- `system.migrate(dryRun: boolean): MigrationReport`

## 3. 模块交互 (Module Interactions)

### 3.1 升级流程
1. User 收到更新提示。
2. User 确认更新。
3. Kernel 下载新版 Core Artifacts。
4. 验证签名。
5. 停止服务 -> 备份数据 -> 替换文件 -> 启动服务 -> 执行迁移脚本。
6. 验证启动成功，否则回滚。

## 4. 数据模型 (Data Models)

### 4.1 ReleaseManifest
```json
{
  "version": "1.0.0",
  "channel": "stable",
  "releaseDate": "2026-05-01",
  "components": {
    "kernel": { "url": "...", "sha256": "..." },
    "cli": { "url": "...", "sha256": "..." }
  },
  "migrationRequired": true
}
```

## 5. 异常处理 (Error Handling)
- **Migration Failed**: 保持旧数据不变，启动旧版本，报告错误。
- **Signature Invalid**: 拒绝更新，防止供应链攻击。

## 6. 测试策略 (Testing Strategy)
- **Upgrade Path**: 验证从 v0.8, v0.9 升级到 v1.0 的兼容性。
- **Fresh Install**: 验证全新安装流程。
- **Documentation**: 验证文档中的示例代码 100% 可运行。
