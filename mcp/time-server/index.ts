#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Create server instance
const server = new Server(
  {
    name: "time-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_current_time",
        description: "Get the current time in a specific timezone",
        inputSchema: {
          type: "object",
          properties: {
            timezone: {
              type: "string",
              description: "The timezone to get the time for (e.g. 'UTC', 'Asia/Shanghai')",
            },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_current_time") {
    const timezone = String(request.params.arguments?.timezone || "UTC");
    try {
        const time = new Date().toLocaleString("en-US", { timeZone: timezone });
        return {
            content: [
                {
                    type: "text",
                    text: `Current time in ${timezone}: ${time}`,
                },
            ],
        };
    } catch (e) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error: Invalid timezone '${timezone}'`,
                },
            ],
            isError: true,
        };
    }
  }
  throw new Error("Tool not found");
});

// Connect transport
const transport = new StdioServerTransport();
await server.connect(transport);
