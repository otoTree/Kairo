# Skill 集成规范文档

## 1. 概述 (Overview)
本文档概述了将 "Skills"（技能）集成到 Kairo 系统中的架构和实施计划。

**Skills** 是模块化的、自包含的包，通过提供专业知识、工作流和工具来扩展 Agent 的能力。它们通常由说明文档 (`SKILL.md`) 和可选资源（脚本、参考资料）组成。

## 2. 目标 (Goals)
- **发现 (Discovery)**: 自动扫描并注册 `skills/` 目录中可用的技能。
- **激活 (Activation)**: 允许 Agent 在运行时动态“装备”或“加载”一项技能。
- **上下文注入 (Context Injection)**: 无缝地将技能说明注入到 Agent 的上下文中。
- **事件驱动 (Event-Driven)**: 通过事件总线广播技能状态变化，实现解耦和可观测性。
- **脚本执行 (Script Execution)**: 在安全沙箱中运行技能附带的脚本。

## 3. 架构 (Architecture)

我们将遵循“垂直领域切片”原则，引入一个新的领域：**`src/domains/skills`**。

### 3.1. 组件 (Components)

1.  **`Skill` (类型定义)**
    ```typescript
    interface Skill {
      name: string;
      description: string;
      path: string; // 技能目录的绝对路径
      content: string; // SKILL.md 的 Markdown 内容
      metadata: Record<string, any>; // 解析后的 frontmatter 元数据
      hasScripts: boolean; // 是否包含 scripts 目录
    }
    ```

2.  **`SkillRegistry`**
    - 负责扫描 `skills/` 目录。
    - 解析 `SKILL.md`（提取 YAML frontmatter）。
    - 检查是否存在 `scripts/` 子目录。
    - 在内存中存储可用的技能。

3.  **`SkillsPlugin`**
    - 实现 `Plugin` 接口。
    - 初始化 `SkillRegistry`。
    - 注册系统工具 `kairo_equip_skill`。
    - **集成 EventBus**: 发布技能相关的生命周期事件。
    - **集成 Sandbox**: 协调脚本的执行。

## 4. 事件驱动设计 (Event-Driven Design)

为了融入 Kairo 的事件总线架构，Skills 系统将定义并发布以下标准事件。

### 4.1. 事件定义

| 事件类型 (Type) | 来源 (Source) | 触发时机 | 数据载荷 (Data) | 消费者示例 |
| :--- | :--- | :--- | :--- | :--- |
| `kairo.skill.registered` | `system:skills` | 系统启动并完成技能扫描后 | `{ skills: [{ name, description }] }` | UI (显示可用技能列表), Agent (更新 System Prompt) |
| `kairo.skill.equipped` | `system:skills` | Agent 成功加载某项技能后 | `{ agentId: string, skillName: string }` | UI (显示当前装备的技能), Analytics |
| `kairo.skill.error` | `system:skills` | 加载技能失败时 | `{ agentId: string, skillName: string, error: string }` | Monitoring |
| `kairo.skill.exec` | `system:skills` | 技能脚本开始执行时 | `{ skillName: string, script: string }` | Audit Log |

## 5. 沙箱执行策略 (Sandbox Execution Strategy)

许多技能（如 `pdf`）包含 `scripts/` 目录，其中存放了 Python 或 Bash 脚本。为了安全地执行这些脚本，我们需要利用 Kairo 的 Sandbox 能力。

### 5.1. 脚本挂载与执行流程

当 Agent 加载一个包含脚本的 Skill (如 `pdf`) 时，除了返回文本指南外，系统还会自动注册动态工具来执行这些脚本。

#### 步骤 1: 脚本发现
`SkillRegistry` 在扫描时，如果发现 `skills/pdf/scripts/` 目录，会标记该 Skill `hasScripts: true`。

#### 步骤 2: 动态工具注册
当 `kairo_equip_skill(name="pdf")` 被调用时：
1.  **挂载**: 系统将 `skills/pdf/scripts` 目录挂载（或复制）到 Sandbox 的临时工作区（例如 `/tmp/kairo/skills/pdf`）。
2.  **工具生成**: `SkillsPlugin` 动态生成一个名为 `run_skill_script` 的工具（或一组特定工具）。

**工具定义**: `run_skill_script`
- **Description**: "Execute a script provided by the loaded skill."
- **Arguments**:
  - `skill_name`: string (e.g., "pdf")
  - `script_name`: string (e.g., "rotate_pdf.py")
  - `args`: array<string> (arguments to pass to the script)
  - `destination_path`: string (Optional) - If provided, generated files will be copied to this absolute path on your workspace.

#### 步骤 3: Agent 调用
Agent 阅读 `SKILL.md`，其中可能包含如下指令：
> "To rotate a PDF, run the `rotate_pdf.py` script."

Agent 随后调用工具：
```json
{
  "name": "run_skill_script",
  "arguments": {
    "skill_name": "pdf",
    "script_name": "rotate_pdf.py",
    "args": ["input.pdf", "90", "output.pdf"],
    "destination_path": "/Users/hjr/Desktop/Kairo/output/rotated.pdf"
  }
}
```

#### 步骤 4: 沙箱执行
`SkillsPlugin` 收到请求后：
1.  验证 `script_name` 是否存在于该 Skill 的 `scripts/` 目录中。
2.  调用 `SandboxManager` 执行命令。
    - **Command**: `python3 /tmp/kairo/skills/pdf/rotate_pdf.py input.pdf 90 output.pdf`
3.  **产物收集**: 如果提供了 `destination_path`，插件将 Sandbox 中的 `output.pdf` 复制到主机的 `destination_path`。
4.  返回 Tool Result（包含 stdout 和产物交付状态）。

### 5.2. 产物收集 (Artifact Collection)
脚本执行可能会生成文件（如 PDF、图片、Excel）。

- **工作目录**: 脚本在 Sandbox 的一个临时可写目录中运行。
- **输出约定**: 脚本应将结果写入当前工作目录。
- **交付机制**:
  - Agent 在调用 `run_skill_script` 时，可以通过 `destination_path` 参数指定希望将结果保存到哪里。
  - 插件负责在脚本执行成功后，将 Sandbox 中的输出文件（通常是 `args` 中的最后一个参数，或由 Agent 推断的文件名）复制到 `destination_path`。

### 5.3. 安全性考量
- **只读挂载**: 脚本目录应以只读方式挂载，防止脚本自我修改或被恶意篡改。
- **路径限制**: 严格校验 `script_name`，禁止包含 `..` 或绝对路径。
- **环境隔离**: 脚本在 Sandbox 中运行，受限于 Sandbox 的网络和文件系统策略。
- **写入控制**: `destination_path` 必须在允许的 Workspace 范围内。

## 6. 详细使用逻辑 (Usage Logic)

### 6.1. 核心原则
- **按需加载**: 为了节省 Token 和避免上下文污染，Skill 内容**不**会预先加载到 System Prompt 中。
- **工具驱动**: Agent 通过调用系统级工具 `kairo_equip_skill` 来获取 Skill 内容。
- **自我感知**: Agent 需要知道有哪些 Skill 可用，以便决定何时调用工具。

### 6.2. 流程步骤

#### 步骤 1: 技能发现 (Discovery)
系统启动时，`SkillsPlugin` 扫描 `skills/` 目录，并发布 `kairo.skill.registered`。
同时，我们需要在 System Prompt 中动态注入一个简短的 **"技能索引"**。

#### 步骤 2: 决策与调用 (Decision & Call)
当用户请求匹配到 `<available_skills>` 中的 `pdf` 技能时：
1.  Agent 决定调用工具：`kairo_equip_skill(name="pdf")`。
2.  Agent 暂停并等待。

#### 步骤 3: 技能加载 (Loading/Equip)
`SkillsPlugin` 处理工具调用：
1.  发布 `kairo.skill.equipped`。
2.  如果存在脚本，注册 `run_skill_script` 工具。
3.  返回 `SKILL.md` 内容 + **"Scripts available: [list of scripts]"** 的提示。

#### 步骤 4: 执行与应用 (Execution)
Agent 收到 Tool Result 后，根据指南执行任务，必要时调用 `run_skill_script` 并指定 `destination_path` 收集产物。

## 7. 实现细节 (Implementation Details)

### 7.1. 目录结构
```
src/domains/skills/
├── index.ts          # 导出
├── skills.plugin.ts  # 插件实现 (EventBus + Sandbox 集成)
├── registry.ts       # 技能扫描和存储逻辑
└── types.ts          # 接口定义 (包含 Event types)
```

### 7.2. 依赖
- **`front-matter`**: 解析 YAML frontmatter。
- **`fs/promises`**: 文件读取。

## 8. 行动计划 (Action Plan)
1.  创建 `src/domains/skills` 目录。
2.  实现 `types.ts` (定义 Skill 接口和 Event 类型)。
3.  实现 `registry.ts` (扫描逻辑，增加 scripts 目录检测)。
4.  实现 `skills.plugin.ts` (集成 EventBus 和 Sandbox，实现 `run_skill_script` 工具)。
5.  在 `src/index.ts` 中注册 `SkillsPlugin`。
