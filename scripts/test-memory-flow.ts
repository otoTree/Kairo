import { Application } from "../src/core/app";
import { AIPlugin } from "../src/domains/ai/ai.plugin";
import { OpenAIProvider } from "../src/domains/ai/providers/openai";
import { MemoryPlugin } from "../src/domains/memory/memory.plugin";
import { AgentPlugin } from "../src/domains/agent/agent.plugin";

async function main() {
  console.log("🔍 Starting Memory Flow Test...\n");

  const app = new Application();

  // 1. Setup AI
  const openai = new OpenAIProvider({
    defaultModel: process.env.OPENAI_MODEL_NAME || "deepseek-chat",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.deepseek.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
  });

  const providers = [openai];
  
  // Separate embedding provider
  const embeddingBaseUrl = process.env.OPENAI_EMBEDDING_BASE_URL;
  if (embeddingBaseUrl) {
    providers.push(new OpenAIProvider({
        name: "openai-embedding",
        baseUrl: embeddingBaseUrl,
        apiKey: process.env.OPENAI_EMBEDDING_API_KEY,
        defaultEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL_NAME
    }));
  }

  await app.use(new AIPlugin(providers));

  // 2. Setup Agent (to receive tool registrations)
  const agentPlugin = new AgentPlugin();
  await app.use(agentPlugin);

  // 3. Setup Memory
  const memoryPlugin = new MemoryPlugin(embeddingBaseUrl ? "openai-embedding" : undefined);
  await app.use(memoryPlugin);

  await app.start();

  console.log("✅ Services Started\n");

  // 4. Test Memory Tools directly via AgentPlugin's system tools
  // Note: In a real scenario, the AgentRuntime calls these. Here we mock the call.
  
  // Find the tools
  // Access private systemTools via 'any' cast for testing
  const tools = (agentPlugin as any).systemTools;
  const addTool = tools.find((t: any) => t.definition.name === "memory_add");
  const recallTool = tools.find((t: any) => t.definition.name === "memory_recall");

  if (!addTool || !recallTool) {
      throw new Error("❌ Memory tools not registered!");
  }
  console.log("✅ Memory Tools Registered");

  // 5. Add Memories
  console.log("\n📝 Adding Memories...");
  const memories = [
      "The user's name is Alice.",
      "The project 'Kairo' is an Agent OS.",
      "Today is a sunny day in San Francisco.",
      "The user prefers TypeScript over Python."
  ];

  for (const content of memories) {
      const res = await addTool.handler({ content });
      console.log(`   - Added: "${content}" (ID: ${res.id})`);
  }

  // 6. Recall Memories
  console.log("\n🧠 Recalling Memories...");
  
  const queries = [
      "What is the user's name?",
      "Tell me about the project",
      "What language does the user like?"
  ];

  for (const query of queries) {
      console.log(`   ❓ Query: "${query}"`);
      // Lower threshold for testing, as embeddings might vary
      const res = await recallTool.handler({ query, limit: 1, threshold: 0.3 });
      if (res.entries.length > 0) {
          console.log(`      💡 Result: "${res.entries[0].entry.content}" (Score: ${res.entries[0].score})`);
      } else {
          console.log(`      ❌ No result found`);
      }
  }

  console.log("\n✅ Memory Flow Test Complete");
  process.exit(0);
}

main().catch((e) => {
    console.error("\n❌ Test Failed:", e);
    process.exit(1);
});
