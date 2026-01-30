import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPServerConfig, MCPTool } from "./types";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export class MCPRegistry {
  private clients: Map<string, Client> = new Map();
  private toolsCache: Map<string, Tool[]> = new Map();

  constructor(private configs: MCPServerConfig[]) {}

  async connectAll() {
    await Promise.all(this.configs.map(config => this.connect(config)));
  }

  async connect(config: MCPServerConfig) {
    if (config.disabled) return;
    if (this.clients.has(config.name)) return;

    console.log(`[MCP] Connecting to server: ${config.name}`);
    
    try {
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args || [],
            env: { ...process.env, ...config.env } as Record<string, string>,
        });

        const client = new Client({
            name: "kairo-client",
            version: "1.0.0",
        }, {
            capabilities: {},
        });

        await client.connect(transport);
        this.clients.set(config.name, client);
        
        // Cache tools
        const result = await client.listTools();
        this.toolsCache.set(config.name, result.tools);
        
        console.log(`[MCP] Connected to ${config.name}, found ${result.tools.length} tools`);
    } catch (e) {
        console.error(`[MCP] Failed to connect to ${config.name}:`, e);
    }
  }

  async disconnectAll() {
    for (const [name, client] of this.clients) {
        try {
            await client.close();
        } catch (e) {
            console.error(`[MCP] Error closing client ${name}:`, e);
        }
    }
    this.clients.clear();
    this.toolsCache.clear();
  }

  getTools(serverName: string): MCPTool[] {
    const tools = this.toolsCache.get(serverName) || [];
    return tools.map(t => ({ ...t, serverId: serverName }));
  }

  getAllTools(): MCPTool[] {
    const all: MCPTool[] = [];
    for (const [name, tools] of this.toolsCache) {
        all.push(...tools.map(t => ({ ...t, serverId: name })));
    }
    return all;
  }

  getClient(serverName: string): Client | undefined {
    return this.clients.get(serverName);
  }

  getAvailableServers(): string[] {
    return Array.from(this.clients.keys());
  }
}
