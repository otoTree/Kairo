import { describe, it, expect, mock, beforeEach } from "bun:test";
import { AgentRuntime } from "./runtime";
import { InMemoryGlobalBus, type EventStore, type KairoEvent } from "../events";
import { InMemoryAgentMemory } from "./memory";
import type { AIPlugin } from "../ai/ai.plugin";
import type { VaultResolver } from "./runtime";

class SimpleInMemoryEventStore implements EventStore {
  private events: KairoEvent[] = [];
  async append(event: KairoEvent): Promise<void> {
    this.events.push(event);
  }
  async query(filter: any): Promise<KairoEvent[]> {
    return this.events;
  }
}

describe("Agent Runtime v0.3 Features", () => {
  let bus: InMemoryGlobalBus;
  let memory: InMemoryAgentMemory;
  let ai: AIPlugin;
  let vault: VaultResolver;
  let runtime: AgentRuntime;

  beforeEach(() => {
    bus = new InMemoryGlobalBus(new SimpleInMemoryEventStore());
    memory = new InMemoryAgentMemory();
    
    // Mock AI
    ai = {
      name: "mock-ai",
      setup: () => {},
      start: async () => {},
      stop: async () => {},
      chat: mock(async () => ({
        content: JSON.stringify({
          thought: "I will use a secret",
          action: {
            type: "tool_call",
            function: {
              name: "use_secret",
              arguments: {
                apiKey: "vault:my-secret-key"
              }
            }
          }
        }),
        usage: { input: 10, output: 10, total: 20 }
      })),
      embed: mock(async () => ({ embedding: [0.1, 0.2, 0.3] }))
    } as unknown as AIPlugin;

    // Mock Vault
    vault = {
      resolve: mock((handleId: string) => {
        if (handleId === "vault:my-secret-key") return "s3cr3t-v4lu3";
        return undefined;
      })
    };

    // Mock Memory Recall
    memory.recall = mock(async () => ["Remember to be secure."]);

    runtime = new AgentRuntime({
      id: "test-agent",
      ai,
      bus,
      memory,
      vault,
      systemTools: [{
        definition: {
          name: "use_secret",
          description: "Uses a secret",
          inputSchema: { type: "object", properties: { apiKey: { type: "string" } } }
        },
        handler: mock(async (args) => {
          return { status: "ok", receivedKey: args.apiKey };
        })
      }]
    });

    runtime.start();
  });

  it("should recall memories and include them in the prompt", async () => {
    // Trigger a tick
    await bus.publish({
      type: "kairo.agent.test-agent.message",
      source: "user",
      data: { content: "Do something" },
    });

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify recall was called
    expect(memory.recall).toHaveBeenCalled();
    
    // Verify AI was called with prompt containing memory
    const calls = (ai.chat as any).mock.calls;
    const lastCall = calls[calls.length - 1];
    const systemPrompt = lastCall[0][0].content;
    
    expect(systemPrompt).toContain("【Recalled Memories】");
    expect(systemPrompt).toContain("Remember to be secure.");
  });

  it("should emit intent events", async () => {
    const events: any[] = [];
    bus.subscribe("kairo.intent.*", (e) => { events.push(e); });

    await bus.publish({
      type: "kairo.agent.test-agent.message",
      source: "user",
      data: { content: "Do something" },
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const started = events.find(e => e.type === "kairo.intent.started");
    const ended = events.find(e => e.type === "kairo.intent.ended");

    expect(started).toBeDefined();
    expect(started.data.intent).toBe("I will use a secret");
    
    expect(ended).toBeDefined();
    // Action result from tool
    expect(ended.data.result).toEqual({ status: "ok", receivedKey: "s3cr3t-v4lu3" });
  });

  it("should resolve vault handles in tool arguments", async () => {
    const toolHandler = (runtime as any).systemTools.get("use_secret").handler;

    await bus.publish({
      type: "kairo.agent.test-agent.message",
      source: "user",
      data: { content: "Do something" },
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(vault.resolve).toHaveBeenCalledWith("vault:my-secret-key");
    expect(toolHandler).toHaveBeenCalled();
    
    const handlerCall = toolHandler.mock.calls[0];
    const args = handlerCall[0];
    
    // The handler should receive the RESOLVED value
    expect(args.apiKey).toBe("s3cr3t-v4lu3");
  });
});
