# v0.5 Technical Specification: Skills Distribution

## 1. 核心功能规范 (Core Features)

### 1.1 Artifacts 管理
- **Metadata**: 定义 Skill 的元数据（版本、依赖、入口、校验和）。
- **Store**: 本地 Artifact 缓存与管理。
- **Verification**: 安装/加载时校验文件完整性 (Checksum)。

### 1.2 多形态运行时 (Polyglot Runtime)
- **Selection Strategy**: 根据 Skill 类型（Binary, Docker, Wasm, Script）选择合适的 Runner。
- **Platform Adaptation**: 根据 OS (macOS/Linux) 自动选择对应的二进制包。
- **Isolation**: 统一不同运行时的资源隔离配置。

### 1.3 升级与回滚 (Upgrade & Rollback)
- **Versioning**: 支持语义化版本 (SemVer)。
- **Atomic Upgrade**: 升级过程原子化，失败自动回滚。
- **Side-by-Side**: 支持多版本并存（特定场景）。

## 2. 接口与协议 (Interfaces & Protocols)

### 2.1 Skill Management Methods
- `skill.install(source: string, version?: string): Promise<void>`
- `skill.upgrade(skillId: string, targetVersion: string): Promise<void>`
- `skill.rollback(skillId: string): Promise<void>`
- `skill.list(): InstalledSkill[]`

### 2.2 Manifest Format (kairo.json)
```json
{
  "name": "ffmpeg-skill",
  "version": "1.2.0",
  "runtime": "binary",
  "platforms": {
    "darwin-arm64": { "url": "...", "sha256": "..." },
    "linux-x64": { "url": "...", "sha256": "..." }
  },
  "permissions": ["fs.read", "fs.write"]
}
```

## 3. 模块交互 (Module Interactions)

### 3.1 安装流程
1. User/System 请求安装 Skill X。
2. SkillManager 下载 Manifest。
3. 根据当前 OS 架构解析对应 Artifact URL。
4. 下载 Artifact 并校验 SHA256。
5. 解压/安装到 `skills/{name}/{version}`。
6. 更新 `installed.json` 注册表。

## 4. 数据模型 (Data Models)

### 4.1 InstalledSkill
```typescript
interface InstalledSkill {
  id: string;
  version: string;
  path: string;
  status: 'active' | 'broken' | 'upgrading';
  manifest: SkillManifest;
}
```

## 5. 异常处理 (Error Handling)
- **Checksum Mismatch**: 下载文件损坏，拒绝安装，清理临时文件。
- **Platform Unsupported**: 当前 OS 无对应 Artifact，报错提示。
- **Upgrade Failed**: 新版本启动检查失败，自动恢复 `current` 指针到旧版本。

## 6. 测试策略 (Testing Strategy)
- **Multi-Platform Mock**: 模拟不同 OS 环境，验证 Artifact 选择逻辑。
- **Rollback Test**: 模拟升级过程中断或新版本崩溃，验证回滚机制。
- **Integrity Test**: 篡改 Artifact 文件，验证校验逻辑。
