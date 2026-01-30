import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  description?: string;
  keywords?: string[];
}

export interface MCPTool extends Tool {
  serverId: string;
}

export interface MCPRouter {
  route(query: string, availableServers: MCPServerConfig[]): Promise<string[]>; // Returns server names
}
