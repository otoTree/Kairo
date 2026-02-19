import type { AIPlugin } from "../ai/ai.plugin";
import type { MCPPlugin } from "../mcp/mcp.plugin";
import type { Observation } from "./observation-bus"; // Still need type for memory compat
import type { AgentMemory } from "./memory";
import type { SharedMemory } from "./shared-memory";
import type { EventBus, KairoEvent, CancelEventData } from "../events";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { rootLogger } from "../observability/logger";
import type { Logger } from "../observability/types";
import { randomUUID } from "crypto";

export interface SystemToolContext {
  agentId: string;
  traceId?: string;
  spanId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface SystemTool {
  definition: Tool;
  handler: (args: any, context: SystemToolContext) => Promise<any>;
}

export interface VaultResolver {
  resolve(handleId: string): string | undefined;
}

export interface AgentRuntimeOptions {
  id?: string;
  ai: AIPlugin;
  mcp?: MCPPlugin;
  bus: EventBus;
  memory: AgentMemory;
  sharedMemory?: SharedMemory;
  vault?: VaultResolver;
  onAction?: (action: any) => void;
  onLog?: (log: any) => void;
  onActionResult?: (result: any) => void;
  systemTools?: SystemTool[];
  capabilities?: { name: string; description: string; inputSchema?: any }[];
}

export class AgentRuntime {
  public readonly id: string;
  private ai: AIPlugin;
  private mcp?: MCPPlugin;
  private bus: EventBus;
  private memory: AgentMemory;
  private sharedMemory?: SharedMemory;
  private vault?: VaultResolver;
  private onAction?: (action: any) => void;
  private onLog?: (log: any) => void;
  private onActionResult?: (result: any) => void;
  private systemTools: Map<string, SystemTool> = new Map();
  private logger: Logger;
  private currentTraceContext?: { traceId: string; spanId: string };
  
  private tickCount: number = 0;
  private running: boolean = false;
  private unsubscribe?: () => void;
  
  private isTicking: boolean = false;
  private hasPendingUpdate: boolean = false;
  private tickHistory: number[] = [];
  private tickLock: Promise<void> = Promise.resolve();
  // Agent 能力声明
  private capabilities: { name: string; description: string; inputSchema?: any }[] = [];

  // 限制 pendingActions 和 eventBuffer 的最大容量，防止内存泄漏
  private static readonly MAX_PENDING_ACTIONS = 100;
  private static readonly MAX_EVENT_BUFFER = 500;
  
  // Track pending actions for result correlation
  private pendingActions: Set<string> = new Set();
  // actionEventId → correlationId 映射，用于取消语义
  private pendingCorrelations = new Map<string, string>();

  // Internal event buffer to replace legacy adapter
  private eventBuffer: KairoEvent[] = [];

  constructor(options: AgentRuntimeOptions) {
    this.id = options.id || "default";
    this.ai = options.ai;
    this.mcp = options.mcp;
    this.bus = options.bus;
    this.memory = options.memory;
    this.sharedMemory = options.sharedMemory;
    this.vault = options.vault;
    this.onAction = options.onAction;
    this.onLog = options.onLog;
    this.onActionResult = options.onActionResult;
    this.logger = rootLogger.child({ component: `AgentRuntime:${this.id}` });
    
    if (options.systemTools) {
        options.systemTools.forEach(t => {
            this.registerSystemTool(t.definition, t.handler);
        });
    }
    this.capabilities = options.capabilities || [];
  }

  registerSystemTool(definition: Tool, handler: (args: any, context: SystemToolContext) => Promise<any>) {
    this.systemTools.set(definition.name, { definition, handler });
  }

  private log(message: string, data?: any) {
    const logger = this.currentTraceContext ? this.logger.withContext(this.currentTraceContext) : this.logger;
    logger.info(message, data);
    
    if (this.onLog) {
      this.onLog({
        type: 'debug',
        message: message,
        data: data,
        ts: Date.now(),
        ...this.currentTraceContext
      });
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tickCount = 0;
    this.tickHistory = [];
    this.log(`Starting event-driven agent loop...`);
    
    // Subscribe to standard Kairo events
    // We listen to user messages and tool results (and legacy events for compat)
    // Note: 'kairo.legacy.*' includes 'user_message', 'system_event', etc.
    // 'kairo.tool.result' is the new standard
    // 'kairo.agent.action' is emitted by us, so we ignore it (or use it for history?)
    // For now, we subscribe to everything relevant and filter in the handler
    
    const unsubs: (() => void)[] = [];
    
    // Subscribe to legacy events (compatibility)
    // We moved legacy handling to AgentPlugin (Orchestrator) to prevent broadcast storm
    // unsubs.push(this.bus.subscribe("kairo.legacy.*", this.handleEvent.bind(this)));
    
    // Subscribe to tool results (standard)
    unsubs.push(this.bus.subscribe("kairo.tool.result", this.handleEvent.bind(this)));

    // Subscribe to global user messages (Runtime filters by targetAgentId internally)
    unsubs.push(this.bus.subscribe("kairo.user.message", this.handleEvent.bind(this)));

    // Subscribe to direct agent messages (Router handles user.message -> agent.ID.message)
    unsubs.push(this.bus.subscribe(`kairo.agent.${this.id}.message`, this.handleEvent.bind(this)));

    // Subscribe to system events
    unsubs.push(this.bus.subscribe("kairo.system.>", this.handleEvent.bind(this)));

    // 订阅取消事件
    unsubs.push(this.bus.subscribe("kairo.cancel", this.handleCancel.bind(this)));

    // 订阅任务委派事件
    unsubs.push(this.bus.subscribe(`kairo.agent.${this.id}.task`, this.handleTaskEvent.bind(this)));

    this.unsubscribe = () => {
      unsubs.forEach(u => u());
    };

    // 广播能力声明
    if (this.capabilities.length > 0) {
      for (const cap of this.capabilities) {
        this.publish({
          type: "kairo.agent.capability",
          source: `agent:${this.id}`,
          data: {
            agentId: this.id,
            name: cap.name,
            description: cap.description,
            inputSchema: cap.inputSchema,
            registeredAt: Date.now(),
          },
        });
      }
    }

    // Initial check (if any events were persisted/replayed?)
    // Usually we wait for events.
  }

  stop() {
    this.running = false;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    this.log("Stopped.");
  }

  private handleEvent(event: KairoEvent) {
    if (!this.running) return;
    
    // Filter out our own emissions if necessary to avoid loops
    // (though 'tool.result' comes from tools, and 'legacy' comes from outside usually)

    // Filter tool results: Only accept if we caused it
    if (event.type === "kairo.tool.result") {
        if (!event.causationId || !this.pendingActions.has(event.causationId)) {
            // Not for us
            return;
        }
        // It is for us, consume it and remove from pending
        this.pendingActions.delete(event.causationId);
        this.pendingCorrelations.delete(event.causationId);
    }

    // Filter user messages if targeted
    if (event.type === "kairo.user.message") {
        const target = (event.data as any).targetAgentId;
        if (target && target !== this.id) {
            return;
        }
    }
    
    this.eventBuffer.push(event);
    // 防止 eventBuffer 无限增长
    if (this.eventBuffer.length > AgentRuntime.MAX_EVENT_BUFFER) {
      this.eventBuffer = this.eventBuffer.slice(-AgentRuntime.MAX_EVENT_BUFFER);
    }
    this.onObservation();
  }

  /**
   * 处理取消事件：终止匹配 correlationId 的待处理动作
   */
  private handleCancel(event: KairoEvent) {
    if (!this.running) return;
    const data = event.data as CancelEventData;
    if (!data?.targetCorrelationId) return;

    // 查找匹配的 pendingAction
    for (const [actionId, corrId] of this.pendingCorrelations) {
      if (corrId === data.targetCorrelationId) {
        this.pendingActions.delete(actionId);
        this.pendingCorrelations.delete(actionId);

        this.log(`取消动作 ${actionId}，原因: ${data.reason || '用户取消'}`);

        // 发布取消完成事件
        this.publish({
          type: "kairo.intent.cancelled",
          source: "agent:" + this.id,
          data: { actionId, reason: data.reason },
          correlationId: data.targetCorrelationId,
          causationId: event.id,
        });
        break;
      }
    }
  }

  /**
   * 处理任务委派事件：将任务转为 Agent 可理解的消息
   */
  private handleTaskEvent(event: KairoEvent) {
    if (!this.running) return;
    const taskData = event.data as any;

    this.eventBuffer.push({
      ...event,
      type: `kairo.agent.${this.id}.message`,
      data: {
        content: `[委派任务] 来自 Agent ${taskData.parentId}:\n任务: ${taskData.description}\n输入: ${JSON.stringify(taskData.input || {})}\n请完成此任务并回复结果。`,
        taskId: taskData.taskId,
        parentId: taskData.parentId,
      },
    });
    if (this.eventBuffer.length > AgentRuntime.MAX_EVENT_BUFFER) {
      this.eventBuffer = this.eventBuffer.slice(-AgentRuntime.MAX_EVENT_BUFFER);
    }
    this.onObservation();
  }

  private onObservation() {
    if (!this.running) return;

    // 使用 Promise 链作为互斥锁，防止并发 tick
    this.tickLock = this.tickLock.then(() => this.processTick());
  }

  private async processTick() {
    if (!this.running) return;

    this.isTicking = true;
    this.hasPendingUpdate = false; 

    try {
      // Drain buffer immediately to capture current state
      const eventsToProcess = [...this.eventBuffer];
      this.eventBuffer = [];
      
      if (eventsToProcess.length > 0) {
        // Trace Setup
        const trigger = eventsToProcess[eventsToProcess.length - 1];
        this.currentTraceContext = {
            traceId: trigger?.traceId || randomUUID(),
            spanId: randomUUID(),
        };

        try {
            await this.tick(eventsToProcess);
        } finally {
            this.currentTraceContext = undefined;
        }
      }
    } catch (error) {
      console.error("[AgentRuntime] Tick error:", error);
    } finally {
      this.isTicking = false;
    }
  }

  private async tick(events: KairoEvent[]) {
    this.tickCount++;
    this.tickHistory.push(Date.now());
    
    // Convert events to Observations for internal logic/memory
    // This is the "Adapter" logic moved inside
    const observations: Observation[] = events.map(e => this.mapEventToObservation(e)).filter((o): o is Observation => o !== null);
    
    if (observations.length === 0) {
        return; // Nothing actionable
    }

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
    const availableTools: Tool[] = [];

    // Add System Tools
    if (this.systemTools.size > 0) {
        availableTools.push(...Array.from(this.systemTools.values()).map(t => t.definition));
    }

    if (this.mcp) {
        const lastObservation = observations.length > 0 ? JSON.stringify(observations[observations.length - 1]) : context.slice(-500);
        try {
            const mcpTools = await this.mcp.getRelevantTools(lastObservation);
            if (mcpTools.length > 0) {
                availableTools.push(...mcpTools);
            }
        } catch (e) {
            console.warn("[AgentRuntime] Failed to route tools:", e);
        }
    }

    if (availableTools.length > 0) {
        toolsContext = `\n可用工具 (Available Tools):\n${JSON.stringify(availableTools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), null, 2)}`;
    }

    // Construct Prompt
    // RECALL: Query memory before planning
    const recentContext = observations.map(o => JSON.stringify(o)).join(" ").slice(-500);
    const recalledMemories = await this.memory.recall(recentContext);
    const memoryContext = recalledMemories.length > 0 ? `\n【Recalled Memories】\n${recalledMemories.join('\n')}` : "";

    const systemPrompt = await this.getSystemPrompt(context, toolsContext, memoryContext);
    const userPrompt = this.composeUserPrompt(observations);
    
    // Determine context for tracing
    const triggerEvent = events[events.length - 1];
    const causationId = triggerEvent?.id;
    const correlationId = triggerEvent?.correlationId || causationId;

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

      // Publish Thought Event (Intent Started)
      this.publish({
          type: "kairo.agent.thought",
          source: "agent:" + this.id,
          data: { thought },
          correlationId,
          causationId
      });

      // PLAN: Intent Started
      this.publish({
          type: "kairo.intent.started",
          source: "agent:" + this.id,
          data: { intent: thought },
          correlationId,
          causationId
      });

      let actionResult = null;
      let actionEventId: string | undefined;

      if (action.type === 'say' || action.type === 'query') {
          // ACT: Publish Action Event
          actionEventId = await this.publish({
              type: "kairo.agent.action",
              source: "agent:" + this.id,
              data: { action },
              correlationId,
              causationId
          });
          actionResult = "Displayed to user";
          
          // MEMORIZE: Intent Ended (Immediate)
          this.publish({
              type: "kairo.intent.ended",
              source: "agent:" + this.id,
              data: { result: actionResult },
              correlationId,
              causationId: actionEventId
          });

      } else if (action.type === 'render') {
          // ACT: Publish Action Event
          actionEventId = await this.publish({
              type: "kairo.agent.action",
              source: "agent:" + this.id,
              data: { action },
              correlationId,
              causationId
          });
          
          // Publish Render Commit
          await this.publish({
            type: "kairo.agent.render.commit",
            source: "agent:" + this.id,
            data: {
              surfaceId: action.surfaceId || "default",
              tree: action.tree
            },
            correlationId,
            causationId: actionEventId
          });

          actionResult = "UI Rendered";
          
          // MEMORIZE: Intent Ended (Immediate)
          this.publish({
              type: "kairo.intent.ended",
              source: "agent:" + this.id,
              data: { result: actionResult },
              correlationId,
              causationId: actionEventId
          });

      } else if (action.type === 'tool_call') {
          // Validate action structure
          if (!action.function || !action.function.name) {
              const errorMsg = "Invalid tool_call action: missing function name";
              console.error("[AgentRuntime]", errorMsg, action);
              
              this.publish({
                 type: "kairo.tool.result",
                 source: "system", 
                 data: { error: errorMsg },
                 causationId: actionEventId || causationId,
                 correlationId
              });

              // Intent Ended with Error
              this.publish({
                  type: "kairo.intent.ended",
                  source: "agent:" + this.id,
                  data: { error: errorMsg },
                  correlationId,
                  causationId
              });
              
          } else {
              // ACT: Publish Action Event
              actionEventId = await this.publish({
                  type: "kairo.agent.action",
                  source: "agent:" + this.id,
                  data: { action },
                  correlationId,
                  causationId
              });
              
              this.pendingActions.add(actionEventId);
              // 记录 actionId → correlationId 映射，用于取消语义
              if (correlationId) {
                this.pendingCorrelations.set(actionEventId, correlationId);
              }
              // 限制 pendingActions 大小，清理最早的条目
              if (this.pendingActions.size > AgentRuntime.MAX_PENDING_ACTIONS) {
                const oldest = this.pendingActions.values().next().value;
                if (oldest) {
                  this.pendingActions.delete(oldest);
                  this.pendingCorrelations.delete(oldest);
                }
              }

              try {
                 actionResult = await this.dispatchToolCall(action, { agentId: this.id, correlationId, causationId: actionEventId });
                 if (this.onActionResult) {
                     this.onActionResult({
                         action,
                         result: actionResult
                     });
                 }
                 
                 // Publish standardized result event
                 this.publish({
                     type: "kairo.tool.result",
                     source: "tool:" + action.function.name,
                     data: { result: actionResult },
                     causationId: actionEventId,
                     correlationId
                 });

                 // MEMORIZE: Intent Ended (Success)
                 this.publish({
                     type: "kairo.intent.ended",
                     source: "agent:" + this.id,
                     data: { result: actionResult },
                     correlationId,
                     causationId: actionEventId
                 });

              } catch (e: any) {
                 actionResult = `Tool call failed: ${e.message}`;

                 this.publish({
                     type: "kairo.tool.result",
                     source: "tool:" + action.function.name,
                     data: { error: e.message },
                     causationId: actionEventId,
                     correlationId
                 });

                 // MEMORIZE: Intent Ended (Failure)
                 this.publish({
                     type: "kairo.intent.ended",
                     source: "agent:" + this.id,
                     data: { error: e.message },
                     correlationId,
                     causationId: actionEventId
                 });
              }
          }
      } else {
        // No-op or unknown action
      }

      // Update Memory
      this.memory.update({
        observation: JSON.stringify(observations), 
        thought,
        action: JSON.stringify(action),
        actionResult: action.type === 'tool_call' ? undefined : (actionResult ? (typeof actionResult === 'string' ? actionResult : JSON.stringify(actionResult)) : undefined)
      });


    } catch (error) {
      console.error("[AgentRuntime] Error in tick:", error);
    }
  }

  private mapEventToObservation(event: KairoEvent): Observation | null {
    // 1. Legacy events
    if (event.type.startsWith("kairo.legacy.")) {
      return event.data as Observation;
    }

    // 2. Standard User Message (or targeted)
    if (event.type === "kairo.user.message" || event.type === `kairo.agent.${this.id}.message`) {
        return {
            type: "user_message",
            text: (event.data as any).content,
            ts: new Date(event.time).getTime()
        };
    }
    
    // 3. Standard Tool Results
    if (event.type === "kairo.tool.result") {
      // Need to reconstruct context? 
      // The memory expects "action_result".
      // We might need to map it back to what Memory expects.
      return {
        type: "action_result",
        action: { type: "tool_call", function: { name: event.source.replace("tool:", "") } }, // Approximate
        result: (event.data as any).result || (event.data as any).error,
        ts: new Date(event.time).getTime()
      };
    }

    // 4. System Events
    if (event.type.startsWith("kairo.system.")) {
      return {
        type: "system_event",
        name: event.type,
        payload: event.data,
        ts: new Date(event.time).getTime()
      };
    }

    return null;
  }
  
  // Helper methods (getSystemPrompt, composeUserPrompt, parseResponse, dispatchToolCall)
  
  private async getSystemPrompt(context: string, toolsContext: string, memoryContext: string): Promise<string> {
      let facts = "";
      if (this.sharedMemory) {
          const allFacts = await this.sharedMemory.getFacts();
          if (allFacts.length > 0) {
              facts = `\n【Shared Knowledge】\n${allFacts.map(f => `- ${f}`).join('\n')}`;
          }
      }

      const validActionTypes = ["say", "query", "render", "noop"];
      if (toolsContext && toolsContext.trim().length > 0) {
          validActionTypes.push("tool_call");
      }

      return `You are Kairo (Agent ${this.id}), an autonomous AI agent running on the user's local machine.
Your goal is to assist the user with their tasks efficiently and safely.

【Environment】
- OS: ${process.platform}
- CWD: ${process.cwd()}
- Date: ${new Date().toISOString()}

${facts}
${memoryContext}

【Capabilities】
- You can execute shell commands.
- You can read/write files.
- You can use provided tools.
- You can extend your capabilities by equipping Skills. Use \`kairo_search_skills\` to find skills and \`kairo_equip_skill\` to load them.
- You can render native UI components using the 'render' action.
  Supported Components:
  - Containers: "Column" (vertical stack), "Row" (horizontal stack). Props: none.
  - Basic: "Text" (props: text), "Button" (props: label, signals: clicked).
  - Input: "TextInput" (props: placeholder, value, signals: textChanged).

【Language Policy】
You MUST respond in the same language as the user's input.
- If the user speaks Chinese, you speak Chinese.
- If the user speaks English, you speak English.
- This applies specifically to the 'content' field in 'say' and 'query' actions.

【Memory & Context】
${context}
${toolsContext}
${facts}

【Response Format】
You must respond with a JSON object strictly. Do not include markdown code blocks (like \`\`\`json).

Valid "action.type" values:
${validActionTypes.map(t => `- "${t}"`).join('\n')}

Format:
{
  "thought": "Your reasoning process here...",
  "action": {
    "type": "one of [${validActionTypes.join(', ')}]",
    ...
  }
}

Examples:

To speak to the user:
{
  "thought": "reasoning...",
  "action": { "type": "say", "content": "message to user" }
}

To ask the user a question:
{
  "thought": "reasoning...",
  "action": { "type": "query", "content": "question to user" }
}

To render a UI:
{
  "thought": "reasoning...",
  "action": {
    "type": "render",
    "surfaceId": "default",
    "tree": {
      "type": "Column",
      "children": [
        { "type": "Text", "props": { "text": "Hello" } },
        { "type": "Button", "props": { "label": "Click Me" }, "signals": { "clicked": "slot_id" } }
      ]
    }
  }
}${toolsContext && toolsContext.trim().length > 0 ? `

To use a tool:
{
  "thought": "reasoning...",
  "action": {
    "type": "tool_call",
    "function": {
      "name": "tool_name",
      "arguments": { ... }
    }
  }
}` : ''}

Or if no action is needed (waiting for user):
{
  "thought": "...",
  "action": { "type": "noop" }
}
`;
  }

  private composeUserPrompt(observations: Observation[]): string {
    if (observations.length === 0) return "No new observations.";
    
    return observations.map(obs => {
      if (obs.type === 'user_message') return `User: ${obs.text}`;
      if (obs.type === 'system_event') return `System Event: ${obs.name} ${JSON.stringify(obs.payload)}`;
      if (obs.type === 'action_result') return `Action Result: ${JSON.stringify(obs.result)}`;
      return JSON.stringify(obs);
    }).join("\n");
  }

  private parseResponse(content: string): { thought: string; action: any } {
    try {
      // Try to find JSON object in the content (in case LLM adds extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(jsonStr);
      return {
        thought: parsed.thought || "No thought provided",
        action: parsed.action || { type: "noop" }
      };
    } catch (e) {
      console.error("Failed to parse response:", content);
      return {
        thought: "Failed to parse response",
        action: { type: "noop" }
      };
    }
  }

  private async publish(payload: any) {
    return this.bus.publish({
        ...payload,
        ...this.currentTraceContext
    });
  }

  private async dispatchToolCall(action: any, context: SystemToolContext): Promise<any> {
    if (this.currentTraceContext) {
        context.traceId = this.currentTraceContext.traceId;
        context.spanId = randomUUID(); // New span for tool call
    }

    const { name, arguments: args } = action.function;
    this.log(`Executing tool: ${name}`, args);
    
    // Resolve handles in args
    const resolvedArgs = this.resolveHandles(args);
    
    if (this.onAction) {
        this.onAction(action);
    }

    // Check System Tools first
    if (this.systemTools.has(name)) {
        try {
            return await this.systemTools.get(name)!.handler(resolvedArgs, context);
        } catch (e: any) {
             throw new Error(`System tool execution failed: ${e.message}`);
        }
    }

    if (!this.mcp) throw new Error("MCP not enabled and tool not found in system tools");
    
    return await this.mcp.callTool(name, resolvedArgs);
  }

  private resolveHandles(args: any): any {
    if (!this.vault) return args;

    const resolve = (obj: any): any => {
        if (typeof obj === 'string') {
            if (obj.startsWith('vault:')) {
                const val = this.vault!.resolve(obj);
                if (val !== undefined) return val;
            }
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(resolve);
        }
        if (typeof obj === 'object' && obj !== null) {
            const newObj: any = {};
            for (const key in obj) {
                newObj[key] = resolve(obj[key]);
            }
            return newObj;
        }
        return obj;
    };
    
    // Simple deep clone by JSON parse/stringify if needed, but the recursive function handles structure.
    // However, we should be careful not to mutate the original args if they are reused (which they shouldn't be).
    // Let's just clone first to be safe.
    const clone = JSON.parse(JSON.stringify(args));
    return resolve(clone);
  }
}
