import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import type { AIPlugin } from "../ai/ai.plugin";
import type { MCPPlugin } from "../mcp/mcp.plugin";
import { LegacyObservationBusAdapter, type ObservationBus } from "./observation-bus";
import { InMemoryAgentMemory, type AgentMemory } from "./memory";
import { InMemorySharedMemory, type SharedMemory } from "./shared-memory";
import { AgentRuntime, type SystemTool } from "./runtime";
import { InMemoryGlobalBus, RingBufferEventStore, type EventBus, type KairoEvent } from "../events";

export class AgentPlugin implements Plugin {
  readonly name = "agent";
  
  public readonly globalBus: EventBus;
  public readonly bus: ObservationBus; // Legacy adapter exposed as bus for compatibility
  public readonly memory: AgentMemory; // Kept for legacy/default agent
  public readonly sharedMemory: SharedMemory;

  private agents: Map<string, AgentRuntime> = new Map();
  private activeAgentId: string = "default";
  
  private app?: Application;
  private actionListeners: ((action: any) => void)[] = [];
  private logListeners: ((log: any) => void)[] = [];
  private actionResultListeners: ((result: any) => void)[] = [];
  
  private ai?: AIPlugin;
  private mcp?: MCPPlugin;
  private systemTools: SystemTool[] = [];

  constructor() {
    this.globalBus = new InMemoryGlobalBus(new RingBufferEventStore());
    this.bus = new LegacyObservationBusAdapter(this.globalBus);
    this.memory = new InMemoryAgentMemory();
    this.sharedMemory = new InMemorySharedMemory();
  }

  registerSystemTool(definition: any, handler: (args: any, context: any) => Promise<any>) {
    this.systemTools.push({ definition, handler });
  }

  onAction(listener: (action: any) => void) {
    this.actionListeners.push(listener);
    return () => {
      this.actionListeners = this.actionListeners.filter(l => l !== listener);
    };
  }

  onLog(listener: (log: any) => void) {
    this.logListeners.push(listener);
    return () => {
      this.logListeners = this.logListeners.filter(l => l !== listener);
    };
  }

  onActionResult(listener: (result: any) => void) {
    this.actionResultListeners.push(listener);
    return () => {
      this.actionResultListeners = this.actionResultListeners.filter(l => l !== listener);
    };
  }

  public getAgent(id: string): AgentRuntime | undefined {
    return this.agents.get(id);
  }

  setup(app: Application) {
    this.app = app;
    console.log("[Agent] Setting up Agent domain...");
    app.registerService("agent", this);
  }

  async start() {
    if (!this.app) {
      throw new Error("AgentPlugin not initialized");
    }

    console.log("[Agent] Starting Agent domain...");
    
    try {
      this.ai = this.app.getService<AIPlugin>("ai");
    } catch (e) {
      console.error("[Agent] AI service not found. Agent cannot start.");
      throw e;
    }

    try {
      this.mcp = this.app.getService<MCPPlugin>("mcp");
    } catch (e) {
      console.warn("[Agent] MCP service not found. Tools will be disabled.");
    }

    // Spawn default agent
    this.spawnAgent("default", this.memory);

    // Subscribe to user messages for routing
    this.globalBus.subscribe("kairo.user.message", this.handleUserMessage.bind(this));
    
    // Subscribe to legacy messages and route to default
    this.globalBus.subscribe("kairo.legacy.*", async (event) => {
         const type = event.type.replace("kairo.legacy.", "");
         
         if (type === "user_message") {
             await this.globalBus.publish({
                type: `kairo.agent.default.message`,
                source: "orchestrator",
                data: { content: (event.data as any).text }
            });
         } else if (type === "system_event") {
              // Route system events to default agent as user message or special event?
              // AgentRuntime.mapEventToObservation handles 'user_message' or 'agent.ID.message'.
              // It maps them to { type: "user_message", ... }
              // If we want it to be a system event observation, we need a new event type or map it differently.
              // AgentRuntime.mapEventToObservation:
              // if (event.type === "kairo.user.message" || event.type === `kairo.agent.${this.id}.message`) -> user_message
              
              // We need a way to send system events.
              // Let's use `kairo.agent.default.message` with special content?
              // Or update AgentRuntime to listen to `kairo.agent.${this.id}.event`?
              
              // Simplest: Send as message for now, or update AgentRuntime.
              // Let's just log it for now as "System: ..."
              
              await this.globalBus.publish({
                type: `kairo.agent.default.message`,
                source: "orchestrator",
                data: { content: `[System Event] ${(event.data as any).name}: ${JSON.stringify((event.data as any).payload)}` }
            });
         }
    });
  }

  async stop() {
    console.log("[Agent] Stopping Agent domain...");
    for (const agent of this.agents.values()) {
        agent.stop();
    }
    this.agents.clear();
  }

  private spawnAgent(id: string, memory?: AgentMemory) {
      if (this.agents.has(id)) return this.agents.get(id)!;
      
      const runtime = new AgentRuntime({
          id,
          ai: this.ai!,
          mcp: this.mcp,
          bus: this.globalBus,
          memory: memory || new InMemoryAgentMemory(),
          sharedMemory: this.sharedMemory,
          onAction: (a) => this.actionListeners.forEach(l => l(a)),
          onLog: (l) => this.logListeners.forEach(l => l(l)),
          onActionResult: (r) => this.actionResultListeners.forEach(l => l(r)),
          systemTools: this.systemTools
      });
      
      this.agents.set(id, runtime);
      runtime.start();
      return runtime;
  }

  private async handleUserMessage(event: KairoEvent) {
        const content = (event.data as any).content;
        const target = (event.data as any).targetAgentId;
        
        if (target) {
            if (!this.agents.has(target)) {
                 // Auto-spawn if targeted explicitly?
                 this.spawnAgent(target);
            }
            await this.globalBus.publish({
                type: `kairo.agent.${target}.message`,
                source: "orchestrator",
                data: { content }
            });
            return;
        }
        
        // Semantic Routing: Check relevance to default agent
        // We only check default for now as it's the main context.
        const defaultAgent = this.agents.get("default");
        if (!defaultAgent) return; // Should not happen

        try {
            // Get a snippet of context (last 1000 chars)
            // Accessing private memory via 'any' or assuming getContext is public (it is)
            const context = this.memory.getContext(); 
            const recentContext = context.slice(-1000);

            const prompt = `You are a Router.
Current Conversation Context:
${recentContext}

New User Message: "${content}"

Is this message relevant to the current conversation?
Or is it a completely new, unrelated topic?
If it is unrelated, we should spawn a new agent.

Reply JSON: { "relevant": boolean }`;

            const response = await this.ai!.chat([{ role: "user", content: prompt }]);
            
            // Safe parse
            let relevant = true;
            try {
                const json = JSON.parse(response.content.replace(/```json/g, "").replace(/```/g, "").trim());
                relevant = json.relevant;
            } catch (e) {
                console.warn("[Orchestrator] Failed to parse routing decision, defaulting to relevant.", e);
            }

            if (relevant) {
                 await this.globalBus.publish({
                    type: `kairo.agent.default.message`,
                    source: "orchestrator",
                    data: { content }
                });
            } else {
                const newId = crypto.randomUUID();
                console.log(`[Orchestrator] Spawning new agent ${newId} for unrelated task.`);
                this.spawnAgent(newId);
                await this.globalBus.publish({
                    type: `kairo.agent.${newId}.message`,
                    source: "orchestrator",
                    data: { content }
                });
            }

        } catch (e) {
            console.error("[Orchestrator] Routing error:", e);
             // Fallback
             await this.globalBus.publish({
                type: `kairo.agent.default.message`,
                source: "orchestrator",
                data: { content }
            });
        }
  }
}
