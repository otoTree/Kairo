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
import path from "path";

const app = new Application();

// Bootstrap the application
async function bootstrap() {
  try {
    // Configuration - Paths
    const PROJECT_ROOT = process.cwd();
    // Python environment: sibling to project root
    const PYTHON_ENV_DIR = path.join(PROJECT_ROOT, "..", "kairo_python_env");
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
    await app.use(DatabasePlugin);
    await app.use(new HealthPlugin());
    
    // Sandbox with configuration
    await app.use(new SandboxPlugin({
        pythonEnvPath: PYTHON_ENV_DIR,
        workspacePath: WORKSPACE_DIR,
        deliverablesPath: DELIVERABLES_DIR
    }));
    
    // Setup AI with Ollama and OpenAI
    const openai = new OpenAIProvider({
     defaultModel:"deepseek-chat",
     baseUrl:"https://api.deepseek.com/v1",
     apiKey:process.env.OPENAI_API_KEY,
    });
    await app.use(new AIPlugin([ openai]));

    // Setup MCP
    // Pass PROJECT_ROOT as baseDir, and "mcp" as dirName.
    const localMcps = await scanLocalMcpServers(PROJECT_ROOT, "mcp");
    await app.use(new MCPPlugin(localMcps, MCP_DIR));

    // Setup Agent
    const agent = new AgentPlugin();
    await app.use(agent);

    // Setup Skills
    await app.use(new SkillsPlugin(SKILLS_DIR));

    // Setup Server
    const server = new ServerPlugin(3000);
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
