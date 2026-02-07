import type { AIPlugin } from "../ai/ai.plugin";
import type { MCPPlugin } from "../mcp/mcp.plugin";
import type { Observation } from "./observation-bus"; // Still need type for memory compat
import type { AgentMemory } from "./memory";
import type { SharedMemory } from "./shared-memory";
import type { EventBus, KairoEvent } from "../events";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface SystemToolContext {
  agentId: string;
}

export interface SystemTool {
  definition: Tool;
  handler: (args: any, context: SystemToolContext) => Promise<any>;
}

export interface AgentRuntimeOptions {
  id?: string;
  ai: AIPlugin;
  mcp?: MCPPlugin;
  bus: EventBus;
  memory: AgentMemory;
  sharedMemory?: SharedMemory;
  onAction?: (action: any) => void;
  onLog?: (log: any) => void;
  onActionResult?: (result: any) => void;
  systemTools?: SystemTool[];
}

export class AgentRuntime {
  public readonly id: string;
  private ai: AIPlugin;
  private mcp?: MCPPlugin;
  private bus: EventBus;
  private memory: AgentMemory;
  private sharedMemory?: SharedMemory;
  private onAction?: (action: any) => void;
  private onLog?: (log: any) => void;
  private onActionResult?: (result: any) => void;
  private tickCount: number = 0;
  private running: boolean = false;
  private unsubscribe?: () => void;
  
  private isTicking: boolean = false;
  private hasPendingUpdate: boolean = false;
  private tickHistory: number[] = [];
  
  // Track pending actions for result correlation
  private pendingActions: Set<string> = new Set();
  
  // Internal event buffer to replace legacy adapter
  private eventBuffer: KairoEvent[] = [];

  private systemTools: Map<string, SystemTool> = new Map();

  constructor(options: AgentRuntimeOptions) {
    this.id = options.id || crypto.randomUUID();
    this.ai = options.ai;
    this.mcp = options.mcp;
    this.bus = options.bus;
    this.memory = options.memory;
    this.sharedMemory = options.sharedMemory;
    this.onAction = options.onAction;
    this.onLog = options.onLog;
    this.onActionResult = options.onActionResult;

    if (options.systemTools) {
      options.systemTools.forEach(t => this.systemTools.set(t.definition.name, t));
    }
  }

  public addSystemTool(tool: SystemTool) {
    this.systemTools.set(tool.definition.name, tool);
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

    // Subscribe to direct agent messages (Router handles user.message -> agent.ID.message)
    unsubs.push(this.bus.subscribe(`kairo.agent.${this.id}.message`, this.handleEvent.bind(this)));

    // Subscribe to system events
    unsubs.push(this.bus.subscribe("kairo.system.>", this.handleEvent.bind(this)));

    this.unsubscribe = () => {
      unsubs.forEach(u => u());
    };

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
    }

    // Filter user messages if targeted
    if (event.type === "kairo.user.message") {
        const target = (event.data as any).targetAgentId;
        if (target && target !== this.id) {
            return;
        }
    }
    
    this.eventBuffer.push(event);
    this.onObservation();
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
    this.hasPendingUpdate = false; 

    try {
      // Drain buffer immediately to capture current state
      const eventsToProcess = [...this.eventBuffer];
      this.eventBuffer = [];
      
      if (eventsToProcess.length > 0) {
        await this.tick(eventsToProcess);
      }
    } catch (error) {
      console.error("[AgentRuntime] Tick error:", error);
    } finally {
      this.isTicking = false;
      // If new events arrived while we were ticking, run again
      if (this.hasPendingUpdate && this.running) {
        // Simple debounce/next-tick
        setTimeout(() => this.processTick(), 0);
      }
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
    const systemPrompt = await this.getSystemPrompt(context, toolsContext);
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

      // Publish Thought Event
      this.bus.publish({
          type: "kairo.agent.thought",
          source: "agent:" + this.id,
          data: { thought }
      });

      let actionResult = null;
      let actionEventId: string | undefined;

      if (action.type === 'say' || action.type === 'query') {
          // Publish Action Event
          actionEventId = await this.bus.publish({
              type: "kairo.agent.action",
              source: "agent:" + this.id,
              data: { action }
          });
          actionResult = "Displayed to user";
      } else if (action.type === 'tool_call' && this.mcp) {
          // Validate action structure
          if (!action.function || !action.function.name) {
              const errorMsg = "Invalid tool_call action: missing function name";
              console.error("[AgentRuntime]", errorMsg, action);
              
              // We need to feed this error back to the agent so it can correct itself
              // instead of crashing or getting stuck.
              // We simulate a result event with error.
              this.bus.publish({
                 type: "kairo.tool.result",
                 source: "system", // System error
                 data: { error: errorMsg },
                 causationId: actionEventId
              });
              
              // Skip execution
          } else {
              // Publish Action Event
              actionEventId = await this.bus.publish({
                  type: "kairo.agent.action",
                  source: "agent:" + this.id,
                  data: { action }
              });
              
              this.pendingActions.add(actionEventId);

              try {
                 actionResult = await this.dispatchToolCall(action);
                 if (this.onActionResult) {
                     this.onActionResult({
                         action,
                         result: actionResult
                     });
                 }
                 
                 // Publish standardized result event
                 this.bus.publish({
                     type: "kairo.tool.result",
                     source: "tool:" + action.function.name,
                     data: { result: actionResult },
                     causationId: actionEventId
                 });

              } catch (e: any) {
                 actionResult = `Tool call failed: ${e.message}`;

                 this.bus.publish({
                     type: "kairo.tool.result",
                     source: "tool:" + action.function.name,
                     data: { error: e.message },
                     causationId: actionEventId
                 });
              }
          }
      } else {
        // No-op or unknown action
      }

      // Update Memory
      // For tool calls, we defer result to the event loop (observed as action_result)
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
  
  private async getSystemPrompt(context: string, toolsContext: string): Promise<string> {
      let facts = "";
      if (this.sharedMemory) {
          const allFacts = await this.sharedMemory.getFacts();
          if (allFacts.length > 0) {
              facts = `\n【Shared Knowledge】\n${allFacts.map(f => `- ${f}`).join('\n')}`;
          }
      }

      const validActionTypes = ["say", "query", "noop"];
      if (toolsContext && toolsContext.trim().length > 0) {
          validActionTypes.push("tool_call");
      }

      return `You are Kairo (Agent ${this.id}), an autonomous AI agent running on the user's local machine.
Your goal is to assist the user with their tasks efficiently and safely.

【Environment】
- OS: ${process.platform}
- CWD: ${process.cwd()}
- Date: ${new Date().toISOString()}

【Capabilities】
- You can execute shell commands.
- You can read/write files.
- You can use provided tools.
- You can extend your capabilities by equipping Skills. Use \`kairo_search_skills\` to find skills and \`kairo_equip_skill\` to load them.

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

  private async dispatchToolCall(action: any): Promise<any> {
    const { name, arguments: args } = action.function;
    this.log(`Executing tool: ${name}`, args);
    
    if (this.onAction) {
        this.onAction(action);
    }

    // Check System Tools first
    if (this.systemTools.has(name)) {
        try {
            return await this.systemTools.get(name)!.handler(args, { agentId: this.id });
        } catch (e: any) {
             throw new Error(`System tool execution failed: ${e.message}`);
        }
    }

    if (!this.mcp) throw new Error("MCP not enabled and tool not found in system tools");
    
    return await this.mcp.callTool(name, args);
  }
}
