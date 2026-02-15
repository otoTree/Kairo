import { OpenAIProvider } from "../src/domains/ai/providers/openai";
import { OllamaProvider } from "../src/domains/ai/providers/ollama";

async function main() {
  console.log("🔍 Verifying Environment Configuration...\n");

  // 1. Check OpenAI / DeepSeek Configuration
  console.log("👉 Checking OpenAI/DeepSeek Configuration:");
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.OPENAI_BASE_URL;
  const openaiModel = process.env.OPENAI_MODEL_NAME;
  const openaiEmbeddingModel = process.env.OPENAI_EMBEDDING_MODEL_NAME;

  console.log(`   - API Key: ${openaiApiKey ? "********" : "❌ Missing"}`);
  console.log(`   - Base URL: ${openaiBaseUrl || "Default"}`);
  console.log(`   - Chat Model: ${openaiModel || "Default"}`);
  console.log(`   - Embedding Model: ${openaiEmbeddingModel || "Default"}`);

  // Check for separate embedding provider config
  const embeddingBaseUrl = process.env.OPENAI_EMBEDDING_BASE_URL;
  const embeddingApiKey = process.env.OPENAI_EMBEDDING_API_KEY;

  if (embeddingBaseUrl) {
      console.log(`   👉 Separate Embedding Provider Configured:`);
      console.log(`      - Base URL: ${embeddingBaseUrl}`);
      console.log(`      - API Key: ${embeddingApiKey ? "********" : "❌ Missing"}`);
  }

  if (openaiApiKey) {
    const openai = new OpenAIProvider({
        baseUrl: openaiBaseUrl,
        apiKey: openaiApiKey,
        defaultModel: openaiModel
    });
    try {
      console.log("   🔄 Testing Chat (Main Provider)...");
      // Use configured model name explicitly if available, otherwise default
      const model = openaiModel || "deepseek-chat"; 
      const chatRes = await openai.chat([{ role: "user", content: "Hello" }], { model });
      console.log(`   ✅ Chat Success: "${chatRes.content.slice(0, 20)}..."`);
    } catch (e: any) {
      console.error(`   ❌ Chat Failed: ${e.message}`);
    }

    // Test Embedding
    let embeddingProvider = openai;
    if (embeddingBaseUrl) {
        console.log("   🔄 Testing Embedding (Separate Provider)...");
        embeddingProvider = new OpenAIProvider({
            name: "openai-embedding",
            baseUrl: embeddingBaseUrl,
            apiKey: embeddingApiKey || openaiApiKey,
            defaultEmbeddingModel: openaiEmbeddingModel
        });
    } else {
        console.log("   🔄 Testing Embedding (Main Provider)...");
    }

    try {
      const embedRes = await embeddingProvider.embed("Hello World");
      console.log(`   ✅ Embedding Success: Vector dimension ${embedRes.embedding.length}`);
    } catch (e: any) {
      console.error(`   ❌ Embedding Failed: ${e.message}`);
      if (!embeddingBaseUrl) {
        console.log("      (Note: DeepSeek API typically does not support embeddings. Configure OPENAI_EMBEDDING_BASE_URL in .env)");
      }
    }
  } else {
    console.log("   ⚠️  Skipping OpenAI tests (No API Key)");
  }

  console.log("\n--------------------------------------------------\n");

  // 2. Check Ollama Configuration
  console.log("👉 Checking Ollama Configuration:");
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL_NAME;
  const ollamaEmbeddingModel = process.env.OLLAMA_EMBEDDING_MODEL_NAME || "nomic-embed-text";
  
  console.log(`   - Base URL: ${ollamaBaseUrl}`);
  console.log(`   - Chat Model: ${ollamaModel || "Default"}`);
  console.log(`   - Embedding Model: ${ollamaEmbeddingModel}`);

  const ollama = new OllamaProvider();
  try {
      console.log("   🔄 Testing Ollama Reachability...");
      // Simple fetch to see if Ollama is up
      await fetch(ollamaBaseUrl);
      console.log("   ✅ Ollama is reachable");

      try {
        console.log(`   🔄 Testing Embedding (${ollamaEmbeddingModel})...`);
        const embedRes = await ollama.embed("Hello World", { model: ollamaEmbeddingModel });
        console.log(`   ✅ Embedding Success: Vector dimension ${embedRes.embedding.length}`);
      } catch (e: any) {
        console.error(`   ❌ Embedding Failed: ${e.message}`);
        console.log(`      (Hint: Run 'ollama pull ${ollamaEmbeddingModel}' if model is missing)`);
      }

  } catch (e) {
      console.log("   ⚠️  Ollama not reachable (Is it running?)");
  }

  console.log("\nDone.");
}

main().catch(console.error);
