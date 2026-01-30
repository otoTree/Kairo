import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import { MCPRegistry } from "./registry";
import { FullMCPRouter, KeywordMCPRouter } from "./router";
import type { MCPServerConfig, MCPRouter, MCPTool } from "./types";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export class MCPPlugin implements Plugin {
  readonly name = "mcp";
  
  private registry: MCPRegistry;
  private router: MCPRouter;
  private configs: MCPServerConfig[] = [];

  constructor(configs: MCPServerConfig[] = []) {
    this.configs = configs;
    this.registry = new MCPRegistry(configs);
    // Use FullRouter by default if few tools, or KeywordRouter if many.
    // For now, let's use FullRouter to ensure we don't miss anything in MVP
    this.router = new FullMCPRouter(); 
  }

  setRouter(router: MCPRouter) {
    this.router = router;
  }

  addServer(config: MCPServerConfig) {
    this.configs.push(config);
    // Re-init registry or add to it? Registry takes configs in constructor.
    // Ideally we should be able to add dynamic servers.
    // For now, let's just connect it.
    this.registry.connect(config);
  }

  setup(app: Application) {
    console.log("[MCP] Setting up MCP domain...");
    app.registerService("mcp", this);
  }

  async start() {
    console.log("[MCP] Starting MCP domain...");
    await this.registry.connectAll();
  }

  async stop() {
    console.log("[MCP] Stopping MCP domain...");
    await this.registry.disconnectAll();
  }

  async getRelevantTools(query: string = ""): Promise<MCPTool[]> {
    const serverNames = await this.router.route(query, this.configs);
    const tools: MCPTool[] = [];
    
    for (const name of serverNames) {
      const serverTools = this.registry.getTools(name);
      tools.push(...serverTools);
    }
    
    return tools;
  }

  async callTool(name: string, args: any) {
    // We need to find which server has this tool.
    // Since tool names might collide, we should ideally namespace them or track them.
    // But MCP tools are global per server.
    // In `getRelevantTools`, we returned tools with `serverId`.
    // The Agent should ideally pass back the `serverId` or we have to search.
    
    // If the agent only gives us `name`, we search all connected servers.
    const allTools = this.registry.getAllTools();
    const tool = allTools.find(t => t.name === name);
    
    if (!tool) {
      throw new Error(`Tool ${name} not found`);
    }

    const client = this.registry.getClient(tool.serverId);
    if (!client) {
      throw new Error(`Client for server ${tool.serverId} not found`);
    }

    console.log(`[MCP] Calling tool ${name} on server ${tool.serverId}`);
    const result = await client.request(
      {
          method: "tools/call",
          params: {
              name: name,
              arguments: args
          }
      },
      CallToolRequestSchema
    );

    return result;
  }
}
