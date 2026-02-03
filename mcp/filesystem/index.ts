#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const server = new Server(
  {
    name: "filesystem-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper to resolve and validate paths
// For security, we might want to restrict this, but for a local tool, we allow absolute paths.
// If a relative path is provided, it's relative to the current working directory of the process.
function resolvePath(p: string): string {
  return path.resolve(process.cwd(), p);
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_file",
        description: "Read the complete contents of a file",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The path to the file to read",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write content to a file (overwrites existing)",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The path to the file to write",
            },
            content: {
              type: "string",
              description: "The content to write",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "list_directory",
        description: "List the contents of a directory",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The path to the directory",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "make_directory",
        description: "Create a directory (and parent directories if needed)",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The path to the directory to create",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "file_info",
        description: "Get metadata about a file or directory",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The path to inspect",
            },
          },
          required: ["path"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new McpError(ErrorCode.InvalidParams, "Missing arguments");
  }

  try {
    if (name === "read_file") {
      const filePath = resolvePath(String(args.path));
      const content = await fs.readFile(filePath, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    }

    if (name === "write_file") {
      const filePath = resolvePath(String(args.path));
      const content = String(args.content);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `Successfully wrote to ${filePath}`,
          },
        ],
      };
    }

    if (name === "list_directory") {
      const dirPath = resolvePath(String(args.path));
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const formatted = entries
        .map((e) => {
          const type = e.isDirectory() ? "[DIR]" : e.isFile() ? "[FILE]" : "[OTHER]";
          return `${type} ${e.name}`;
        })
        .join("\n");
      
      return {
        content: [
          {
            type: "text",
            text: formatted,
          },
        ],
      };
    }

    if (name === "make_directory") {
      const dirPath = resolvePath(String(args.path));
      await fs.mkdir(dirPath, { recursive: true });
      return {
        content: [
          {
            type: "text",
            text: `Successfully created directory ${dirPath}`,
          },
        ],
      };
    }

    if (name === "file_info") {
      const filePath = resolvePath(String(args.path));
      const stats = await fs.stat(filePath);
      const info = {
        path: filePath,
        size: stats.size,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        created: stats.birthtime,
        modified: stats.mtime,
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(info, null, 2),
          },
        ],
      };
    }

    throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
