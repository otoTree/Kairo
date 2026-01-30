# MCP Servers

This directory contains local Model Context Protocol (MCP) servers.
Each subdirectory represents a standalone MCP server that can be used by the Kairo agent.

## Available Servers

### time-server
A simple example server that provides time-related tools.
- **Tools**: `get_current_time`
- **Command**: `bun run mcp/time-server/index.ts`

## How to add a new server

1. Create a new directory here (e.g., `my-tool`).
2. Create an `index.ts` file implementing the MCP server using `@modelcontextprotocol/sdk`.
3. Register the server in `src/index.ts` inside the `MCPPlugin` configuration.

```typescript
// src/index.ts
await app.use(new MCPPlugin([
  {
    name: "my-tool",
    command: "bun",
    args: ["run", "mcp/my-tool/index.ts"],
    description: "Description for the router",
    keywords: ["keyword1", "keyword2"]
  }
]));
```
