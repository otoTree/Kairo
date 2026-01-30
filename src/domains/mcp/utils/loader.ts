import { promises as fs } from "fs";
import * as path from "path";
import type { MCPServerConfig } from "../types";

export async function scanLocalMcpServers(
  mcpDirName: string = "mcp"
): Promise<MCPServerConfig[]> {
  const rootDir = process.cwd();
  const mcpDir = path.join(rootDir, mcpDirName);
  const configs: MCPServerConfig[] = [];

  try {
    const entries = await fs.readdir(mcpDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const serverDir = path.join(mcpDir, entry.name);
      const configPath = path.join(serverDir, "mcp.json");
      const indexPath = path.join(serverDir, "index.ts");

      let config: Partial<MCPServerConfig> = {};

      // Try to load mcp.json
      try {
        const configFile = await fs.readFile(configPath, "utf-8");
        config = JSON.parse(configFile);
      } catch (e) {
        // If config file doesn't exist, we'll try to infer
      }

      // If no command specified but index.ts exists, infer default bun command
      if (!config.command) {
        try {
            await fs.access(indexPath);
            config.command = "bun";
            config.args = ["run", path.relative(rootDir, indexPath)];
        } catch (e) {
            // No index.ts either, skip this directory
            if (!config.name) continue;
        }
      }

      // Fill defaults
      if (!config.name) config.name = entry.name;
      if (!config.description) config.description = `${entry.name} MCP server`;
      if (!config.keywords) config.keywords = [entry.name];
      if (!config.args) config.args = [];

      // Validate required fields
      if (config.name && config.command) {
          configs.push(config as MCPServerConfig);
      }
    }
  } catch (e) {
    console.warn(`[MCP] Failed to scan directory ${mcpDir}:`, e);
  }

  return configs;
}
