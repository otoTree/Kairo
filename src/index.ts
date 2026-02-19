import { Application } from "./core/app";
import { HealthPlugin } from "./domains/health/health.plugin";
import { DatabasePlugin } from "./domains/database/database.plugin";
import { AIPlugin } from "./domains/ai/ai.plugin";
import { OllamaProvider } from "./domains/ai/providers/ollama";
import { OpenAIProvider } from "./domains/ai/providers/openai";
import { AgentPlugin } from "./domains/agent/agent.plugin";
import { ServerPlugin } from "./domains/server/server.plugin";
import { SandboxPlugin } from "./domains/sandbox/sandbox.plugin";
import { MCPPlugin } from "./domains/mcp/mcp.plugin";
import { scanLocalMcpServers } from "./domains/mcp/utils/loader";
import { SkillsPlugin } from "./domains/skills/skills.plugin";
import { KernelPlugin } from "./domains/kernel/kernel.plugin";
import { DevicePlugin } from "./domains/device/device.plugin";
import { MemoryPlugin } from "./domains/memory/memory.plugin";
import { VaultPlugin } from "./domains/vault/vault.plugin";
import { ObservabilityPlugin } from "./domains/observability/observability.plugin";
import { CompositorPlugin } from "./domains/ui/compositor.plugin";
import path from "path";

const app = new Application();

// Bootstrap the application
async function bootstrap() {
  try {
    // Configuration - Paths
    const PROJECT_ROOT = process.cwd();
    // Python environment: sibling to project root, or override via env
    const PYTHON_ENV_DIR = process.env.PYTHON_ENV_PATH || path.join(PROJECT_ROOT, "..", "kairo_python_env");
    const WORKSPACE_DIR = path.join(PROJECT_ROOT, "workspace");
    const DELIVERABLES_DIR = path.join(PROJECT_ROOT, "deliverables");
    const SKILLS_DIR = path.join(PROJECT_ROOT, "skills");
    const MCP_DIR = path.join(PROJECT_ROOT, "mcp");

    console.log("[Config] Python Env:", PYTHON_ENV_DIR);
    console.log("[Config] Workspace:", WORKSPACE_DIR);
    console.log("[Config] Deliverables:", DELIVERABLES_DIR);
    console.log("[Config] Skills:", SKILLS_DIR);
    console.log("[Config] MCP:", MCP_DIR);

    // Register plugins
    await app.use(new DatabasePlugin());
    await app.use(new HealthPlugin());
    
    // Sandbox with configuration
    await app.use(new SandboxPlugin({
        pythonEnvPath: PYTHON_ENV_DIR,
        workspacePath: WORKSPACE_DIR,
        deliverablesPath: DELIVERABLES_DIR
    }));
    
    // Setup AI with Ollama and OpenAI
    const openai = new OpenAIProvider({
     defaultModel: process.env.OPENAI_MODEL_NAME || "deepseek-chat",
     baseUrl: process.env.OPENAI_BASE_URL || "https://api.deepseek.com/v1",
     apiKey: process.env.OPENAI_API_KEY,
    });
    
    // Check if separate embedding configuration is provided
    const providers = [openai];
    const embeddingBaseUrl = process.env.OPENAI_EMBEDDING_BASE_URL;
    const embeddingApiKey = process.env.OPENAI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY; // Fallback to main key if not specific

    if (embeddingBaseUrl) {
        const embeddingProvider = new OpenAIProvider({
            name: "openai-embedding",
            baseUrl: embeddingBaseUrl,
            apiKey: embeddingApiKey,
            defaultEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL_NAME || "text-embedding-3-small"
        });
        providers.push(embeddingProvider);
        console.log("[AI] Configured separate embedding provider: openai-embedding");
    }

    await app.use(new AIPlugin(providers));

    // Setup Memory (Depends on AI)
    // If separate embedding provider exists, use it; otherwise use default
    await app.use(new MemoryPlugin(embeddingBaseUrl ? "openai-embedding" : undefined));

    // Setup Vault
    await app.use(new VaultPlugin());

    // Setup MCP
    // Pass PROJECT_ROOT as baseDir, and "mcp" as dirName.
    const localMcps = await scanLocalMcpServers(PROJECT_ROOT, "mcp");
    await app.use(new MCPPlugin(localMcps, MCP_DIR));

    // Setup Agent
    const agent = new AgentPlugin();
    await app.use(agent);

    // Setup Kernel (must be after Agent setup for service discovery in start, or just use registered service)
    await app.use(new KernelPlugin());

    // Setup Device Plugin (Depends on Kernel)
    await app.use(new DevicePlugin());

    // Setup Skills
    await app.use(new SkillsPlugin(SKILLS_DIR));

    // Setup Observability
    await app.use(new ObservabilityPlugin());

    // Setup Compositor (UI/Wayland)
    await app.use(new CompositorPlugin());

    // Setup Server
    const server = new ServerPlugin(
      Number(process.env.PORT || 3000),
      process.env.KAIRO_TOKEN || (() => {
        const generated = require("crypto").randomBytes(32).toString("hex");
        console.warn("[Security] KAIRO_TOKEN 未设置，已自动生成临时密钥。生产环境请通过环境变量配置。");
        return generated;
      })()
    );
    await app.use(server);



    await app.start();

    // Trigger initial event to wake up the agent
    agent.globalBus.publish({
      type: "kairo.system.event", // Standard system event
      source: "system",
      data: { 
          type: "system_event", // Legacy payload for compatibility if needed, or just new structure
          name: "startup",
          payload: { message: "System initialized. Hello Agent!" }
      }
    });

    // Also publish legacy for compat if runtime relies strictly on mapping
    agent.globalBus.publish({
        type: "kairo.legacy.system_event",
        source: "system",
        data: {
            type: "system_event",
            name: "startup",
            payload: { message: "System initialized. Hello Agent!" },
            ts: Date.now()
        }
    });
    
    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      await app.stop();
      process.exit(0);
    });
    
    process.on("SIGTERM", async () => {
      await app.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error("Failed to start application:", error);
    process.exit(1);
  }
}

bootstrap();
