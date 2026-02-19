/**
 * Agent 能力声明与注册表
 * 管理所有 Agent 的能力信息，支持按任务描述查找最匹配的 Agent
 */

export interface AgentCapability {
  agentId: string;
  name: string;        // 能力名称，如 "file_processing", "code_review"
  description: string; // 能力描述
  inputSchema?: any;   // 任务输入格式
  registeredAt: number;
}

export class CapabilityRegistry {
  // agentId → capabilities
  private capabilities = new Map<string, AgentCapability[]>();

  /**
   * 注册 Agent 能力
   */
  register(capability: AgentCapability): void {
    const existing = this.capabilities.get(capability.agentId) || [];
    // 避免重复注册
    const idx = existing.findIndex(c => c.name === capability.name);
    if (idx >= 0) {
      existing[idx] = capability;
    } else {
      existing.push(capability);
    }
    this.capabilities.set(capability.agentId, existing);
  }

  /**
   * 注销 Agent 的所有能力
   */
  unregister(agentId: string): void {
    this.capabilities.delete(agentId);
  }

  /**
   * 根据任务描述查找最匹配的 Agent
   * 使用简单关键词匹配，后续可升级为语义匹配
   */
  findBestAgent(taskDescription: string): AgentCapability | undefined {
    const lower = taskDescription.toLowerCase();
    let bestMatch: AgentCapability | undefined;
    let bestScore = 0;

    for (const caps of this.capabilities.values()) {
      for (const cap of caps) {
        // 计算匹配分数：名称匹配 + 描述关键词匹配
        let score = 0;
        if (lower.includes(cap.name.toLowerCase())) score += 10;
        const descWords = cap.description.toLowerCase().split(/\s+/);
        for (const word of descWords) {
          if (word.length > 2 && lower.includes(word)) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestMatch = cap;
        }
      }
    }

    return bestMatch;
  }

  /**
   * 获取指定 Agent 的能力列表
   */
  getCapabilities(agentId: string): AgentCapability[] {
    return this.capabilities.get(agentId) || [];
  }

  /**
   * 获取所有已注册的能力
   */
  getAllCapabilities(): AgentCapability[] {
    return Array.from(this.capabilities.values()).flat();
  }
}
