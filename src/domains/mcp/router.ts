import type { MCPRouter, MCPServerConfig } from "./types";

export class FullMCPRouter implements MCPRouter {
  async route(query: string, availableServers: MCPServerConfig[]): Promise<string[]> {
    return availableServers.map(s => s.name);
  }
}

export class KeywordMCPRouter implements MCPRouter {
  async route(query: string, availableServers: MCPServerConfig[]): Promise<string[]> {
    const q = query.toLowerCase();
    return availableServers
      .filter(s => {
        if (s.name.toLowerCase().includes(q)) return true;
        if (s.description && s.description.toLowerCase().includes(q)) return true;
        if (s.keywords && s.keywords.some(k => q.includes(k.toLowerCase()))) return true;
        return false;
      })
      .map(s => s.name);
  }
}
