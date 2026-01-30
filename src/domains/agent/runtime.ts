import type { AIPlugin } from "../ai/ai.plugin";
import type { MCPPlugin } from "../mcp/mcp.plugin";
import type { ObservationBus } from "./observation-bus";
import type { AgentMemory } from "./memory";

export interface AgentRuntimeOptions {
  ai: AIPlugin;
  mcp?: MCPPlugin;
  bus: ObservationBus;
  memory: AgentMemory;
  onAction?: (action: any) => void;
  onLog?: (log: any) => void;
  onActionResult?: (result: any) => void;
}

export class AgentRuntime {
  private ai: AIPlugin;
  private mcp?: MCPPlugin;
  private bus: ObservationBus;
  private memory: AgentMemory;
  private onAction?: (action: any) => void;
  private onLog?: (log: any) => void;
  private onActionResult?: (result: any) => void;
  private tickCount: number = 0;
  private running: boolean = false;
  private unsubscribeBus?: () => void;
  
  private isTicking: boolean = false;
  private hasPendingUpdate: boolean = false;
  private tickHistory: number[] = [];

  constructor(options: AgentRuntimeOptions) {
    this.ai = options.ai;
    this.mcp = options.mcp;
    this.bus = options.bus;
    this.memory = options.memory;
    this.onAction = options.onAction;
    this.onLog = options.onLog;
    this.onActionResult = options.onActionResult;
  }

  private get hz(): number {
    const now = Date.now();
    // Keep only ticks within the last 1000ms
    this.tickHistory = this.tickHistory.filter(t => now - t < 1000);
    return this.tickHistory.length;
  }

  private log(message: string, data?: any) {
    console.log(`[AgentRuntime] ${message}`, data ? data : "");
    if (this.onLog) {
      this.onLog({
        type: 'debug',
        message: message,
        data: data,
        ts: Date.now()
      });
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tickCount = 0;
    this.tickHistory = [];
    this.log(`Starting event-driven agent loop...`);
    
    // Subscribe to bus events
    this.unsubscribeBus = this.bus.subscribe(() => {
      this.onObservation();
    });

    // Initial check in case there are already observations
    this.onObservation();
  }

  stop() {
    this.running = false;
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = undefined;
    }
    this.log("Stopped.");
  }

  private onObservation() {
    if (!this.running) return;

    if (this.isTicking) {
      this.hasPendingUpdate = true;
      return;
    }

    this.processTick();
  }

  private async processTick() {
    if (!this.running || this.isTicking) return;

    this.isTicking = true;
    this.hasPendingUpdate = false; // Consuming the event

    try {
      await this.tick();
    } catch (error) {
      console.error("[AgentRuntime] Tick error:", error);
    } finally {
      this.isTicking = false;
      // If new observations arrived while we were ticking, run again
      if (this.hasPendingUpdate && this.running) {
        setTimeout(() => this.processTick(), 0);
      }
    }
  }

  private async tick() {
    this.tickCount++;
    this.tickHistory.push(Date.now());
    
    const { observations, ts } = this.bus.snapshot();
    let context = this.memory.getContext();

    // Check compression trigger (80% of ~40k tokens)
    // Heuristic: ~80,000 characters
    const COMPRESSION_THRESHOLD_CHARS = 80000;
    if (context.length > COMPRESSION_THRESHOLD_CHARS) {
      console.log(`[AgentRuntime] Context length ${context.length} > ${COMPRESSION_THRESHOLD_CHARS}. Triggering compression...`);
      await this.memory.compress(this.ai);
      context = this.memory.getContext(); // Refresh context
    }

    // MCP Routing
    let toolsContext = "";
    if (this.mcp) {
        // Use observations and context to find relevant tools
        // For MVP, we use the last observation content or context summary
        const lastObservation = observations.length > 0 ? JSON.stringify(observations[observations.length - 1]) : context.slice(-500);
        try {
            const tools = await this.mcp.getRelevantTools(lastObservation);
            if (tools.length > 0) {
                toolsContext = `\n可用工具 (Available Tools):\n${JSON.stringify(tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), null, 2)}`;
            }
        } catch (e) {
            console.warn("[AgentRuntime] Failed to route tools:", e);
        }
    }

    // Construct Prompt
    const systemPrompt = this.getSystemPrompt(context, toolsContext);
    const userPrompt = this.composeUserPrompt(observations);
    
    this.log(`Tick #${this.tickCount} processing...`);
    this.log(`Input Prompt:`, { system: systemPrompt, user: userPrompt });

    try {
      const response = await this.ai.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]);

      if (response.usage) {
        this.log(`Token Usage: Input=${response.usage.input}, Output=${response.usage.output}`, response.usage);
      }
      
      this.log(`Raw Output:`, response.content);

      const { thought, action } = this.parseResponse(response.content);
      
      this.log(`Thought: ${thought}`);
      this.log(`Action:`, action);

      let actionResult = null;
      if (action.type === 'tool_call' && this.mcp) {
          try {
             actionResult = await this.dispatchToolCall(action);
             if (this.onActionResult) {
                 this.onActionResult({
                     action,
                     result: actionResult
                 });
             }
             // Publish action result to observation bus so it becomes part of the next tick's context
             this.bus.publish({
                 type: "action_result",
                 action: action,
                 result: actionResult,
                 ts: Date.now()
             });
          } catch (e: any) {
             actionResult = `Tool call failed: ${e.message}`;
             // Also publish failure
             this.bus.publish({
                 type: "action_result",
                 action: action,
                 result: actionResult,
                 ts: Date.now()
             });
          }
      } else {
          this.dispatchAction(action);
      }

      this.memory.update({
        observation: JSON.stringify(observations), // Simplified for MVP
        thought,
        action: JSON.stringify(action),
        actionResult: actionResult ? JSON.stringify(actionResult) : undefined
      });

    } catch (e) {
      console.error("[AgentRuntime] LLM call failed:", e);
      this.log(`LLM call failed`, e);
    }
  }

  private getSystemPrompt(context: string, toolsContext: string) {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short' 
    });

    return `你是一个持续运行的 Agent。你的任务是根据观测到的信息和记忆，决定下一步的行动。
当前系统时间: ${timeStr}

<memory>
${context}
</memory>

${toolsContext ? `<tools>\n${toolsContext}\n</tools>` : ''}

输出格式说明：
请先在 <thought> 标签中进行思考，分析当前状态、信息缺口和下一步计划。
然后在 <action> 标签中输出 JSON 格式的行动指令。

Action JSON 格式说明：
1. 闲聊/回复 (say) 或 提问 (query) 或 无操作 (noop):
   payload 为字符串。
2. 工具调用 (tool_call):
   payload 必须为对象，包含 name 和 args。

Examples:

<thought>
用户打招呼，我应该回复。
</thought>
<action>
{ "type": "say", "payload": "你好！有什么我可以帮你的吗？" }
</action>

<thought>
需要查询当前时间。
</thought>
<action>
{ "type": "tool_call", "payload": { "name": "get_current_time", "args": { "timezone": "Asia/Shanghai" } } }
</action>

规则：
1) 如果需要获取客观信息（如时间、文件、搜索等），必须输出 tool_call。
2) 如果需要向用户提问或确认意图，输出 query，payload 为自然语言问题。
3) 如果已有结果或需要闲聊，输出 say，payload 为自然语言回复。
4) 如果没有新信息且无需行动，输出 noop。
5) JSON 必须包含在 <action> 标签内，严禁使用 Markdown 代码块 (如 \`\`\`json ... \`\`\`)。`;
  }

  private composeUserPrompt(observations: any[]) {
    return `当前 tick: t=${this.tickCount}, hz=${this.hz}

<observations>
${observations.length > 0 ? JSON.stringify(observations, null, 2) : "无新观测"}
</observations>
`;
  }

  private parseResponse(raw: string): { thought: string; action: any } {
    try {
      // Extract thought
      const thoughtMatch = raw.match(/<thought>([\s\S]*?)<\/thought>/);
      const thought = (thoughtMatch && thoughtMatch[1]) ? thoughtMatch[1].trim() : "No thought provided";

      // Extract action
      const actionMatch = raw.match(/<action>([\s\S]*?)<\/action>/);
      let actionJson = (actionMatch && actionMatch[1]) ? actionMatch[1].trim() : raw; // Fallback to raw if no tags

      // Clean up markdown code blocks if present
      actionJson = actionJson.replace(/```json\n?|\n?```/g, "").trim();
      
      // Try to parse JSON
      let parsed;
      try {
          parsed = JSON.parse(actionJson);
      } catch (e) {
          // Fallback: try to find JSON object in the string if direct parse fails
          const jsonMatch = actionJson.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
              try {
                parsed = JSON.parse(jsonMatch[0]);
              } catch (innerE) {
                // Ignore inner error, will try XML fallback
              }
          }
      }

      // Fallback for XML-style tags if JSON parsing fails (compatibility mode)
      if (!parsed) {
          const sayMatch = raw.match(/<say>([\s\S]*?)<\/say>/);
          if (sayMatch && sayMatch[1] !== undefined) {
              parsed = { type: 'say', payload: sayMatch[1].trim() };
          } else {
              const queryMatch = raw.match(/<query>([\s\S]*?)<\/query>/);
              if (queryMatch && queryMatch[1] !== undefined) {
                  parsed = { type: 'query', payload: queryMatch[1].trim() };
              }
          }
      }
      
      // Final Fallback: Treat the remaining content as a "say" action (Lenient Extraction)
      if (!parsed) {
          let contentToSay = raw;
          // Remove <thought> block from raw content to avoid repeating internal monologue
          if (thoughtMatch) {
              contentToSay = contentToSay.replace(thoughtMatch[0], "").trim();
          }
          
          // Remove <action> tags if they exist but failed to parse (rare case)
          if (actionMatch) {
             contentToSay = contentToSay.replace(actionMatch[0], "").trim();
          }

          // Clean up markdown code blocks wrappers
          contentToSay = contentToSay.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();

          if (contentToSay.length > 0) {
             parsed = { type: 'say', payload: contentToSay };
          } else {
             // If nothing left, it's a noop
             parsed = { type: 'noop', payload: "No actionable content" };
          }
      }
      
      if (typeof parsed !== 'object') {
         // Should not happen with above logic, but safety first
         parsed = { type: 'say', payload: String(parsed) };
      }

      return {
        thought: thought,
        action: parsed.action || parsed // Handle both { action: { ... } } and { type: ... } formats
      };
    } catch (e) {
      console.warn("[AgentRuntime] Failed to parse response:", raw);
      return {
        thought: "Failed to parse response",
        action: { type: "noop", payload: "Parse error" }
      };
    }
  }

  private dispatchAction(action: any) {
    if (!action) return;
    
    // Notify listener
    if (this.onAction) {
      try {
        this.onAction(action);
      } catch (e) {
        console.error("[AgentRuntime] Error in onAction listener:", e);
      }
    }
    
    if (action.type === 'say') {
        console.log(`[AGENT SAYS]:`, action.payload);
    } else if (action.type === 'query') {
        console.log(`[AGENT QUERIES]:`, action.payload);
    }
  }

  private async dispatchToolCall(action: any) {
      if (!this.mcp) return "MCP not available";
      const payload = action.payload;
      if (!payload || !payload.name) return "Invalid tool payload";
      
      console.log(`[AgentRuntime] Executing tool ${payload.name}...`);
      const result = await this.mcp.callTool(payload.name, payload.args || {});
      console.log(`[AgentRuntime] Tool result:`, result);
      return result;
  }
}
