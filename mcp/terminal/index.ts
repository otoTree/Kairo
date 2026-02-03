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
import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 60 * 1000; // 60s command timeout
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes session inactivity timeout

interface ExecutionResult {
  output: string;
  exitCode: number;
}

class TerminalSession {
  public id: string;
  public lastAccessedAt: number;
  private process: any; // Bun subprocess
  private writer: any; // stdin writer
  private buffer: string = "";
  private currentResolver: ((value: ExecutionResult) => void) | null = null;
  private currentRejecter: ((reason?: any) => void) | null = null;
  private currentMarker: string | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(id: string) {
    this.id = id;
    this.lastAccessedAt = Date.now();
    
    // Start a persistent bash process
    // We combine stdout and stderr to ensure we capture the marker correctly
    // and to simplify output handling.
    this.process = Bun.spawn(["/bin/bash"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe", // We will pipe stderr manually or merge it? Bun spawn separates them.
      // Merging in shell command is easier: command 2>&1
    });

    this.writer = this.process.stdin.getWriter();
    
    // We need to read from stdout continuously
    this.startReading();
  }

  private async startReading() {
    // We only read stdout. Stderr is assumed to be redirected to stdout by the command wrapper.
    // If we don't redirect, we might miss the marker if it's interleaved.
    // So we will enforce `2>&1` in the execution wrapper.
    if (!this.process.stdout) return;
    
    const reader = this.process.stdout.getReader();
    this.reader = reader;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = new TextDecoder().decode(value);
        this.buffer += chunk;
        this.checkBuffer();
      }
    } catch (e) {
      console.error(`Session ${this.id} read error:`, e);
    }
  }

  private checkBuffer() {
    if (!this.currentMarker || !this.currentResolver) return;

    // Marker format: __MCP_END:<UUID>:<EXIT_CODE>__
    // We look for this pattern.
    const markerPattern = `__MCP_END:${this.currentMarker}:`;
    const idx = this.buffer.indexOf(markerPattern);

    if (idx !== -1) {
      // Found the marker
      // We need to find the end of the line/marker to get the exit code
      // The marker is likely at the end of the buffer, but let's be safe
      // We expect: ... __MCP_END:<UUID>:<EXIT_CODE>__ \n
      
      const rest = this.buffer.slice(idx + markerPattern.length);
      const endIdx = rest.indexOf("__");
      
      if (endIdx !== -1) {
        const exitCodeStr = rest.slice(0, endIdx);
        const exitCode = parseInt(exitCodeStr, 10);
        
        // The output is everything before the marker
        // We also need to strip the command echo if it appears (bash usually doesn't echo unless -x)
        // However, there might be a trailing newline before the marker
        const output = this.buffer.slice(0, idx).trimEnd();
        
        // Clear buffer, but keep anything after the marker (rare, but possible)
        // actually, we should discard everything up to the end of marker line
        const markerEndTotalIdx = idx + markerPattern.length + endIdx + 2; // +2 for "__"
        // Also skip potential newline after marker
        let nextStart = markerEndTotalIdx;
        if (this.buffer[nextStart] === '\n') nextStart++;
        else if (this.buffer[nextStart] === '\r' && this.buffer[nextStart+1] === '\n') nextStart += 2;

        this.buffer = this.buffer.slice(nextStart);
        
        const resolver = this.currentResolver;
        this.currentResolver = null;
        this.currentRejecter = null;
        this.currentMarker = null;

        resolver({ output, exitCode });
      }
    }
  }

  public async execute(command: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ExecutionResult> {
    if (this.currentResolver) {
      throw new Error("Session is busy executing another command");
    }

    this.lastAccessedAt = Date.now();
    const marker = randomUUID();
    this.currentMarker = marker;

    return new Promise<ExecutionResult>(async (resolve, reject) => {
      this.currentResolver = resolve;
      this.currentRejecter = reject;

      // Timeout handling
      const timeout = setTimeout(() => {
        if (this.currentResolver === resolve) {
          this.currentResolver = null;
          this.currentRejecter = null;
          this.currentMarker = null;
          // We can't easily kill the command without killing the shell, 
          // but we can send Ctrl+C (SIGINT) to the process group?
          // For now, we just reject. The shell might be stuck.
          reject(new Error(`Command timed out after ${timeoutMs}ms`));
          
          // Try to interrupt
          // this.process.kill(Bun.SIGINT); // This kills the bash shell?
          // To be safe, maybe we should mark this session as 'stuck' or just kill it.
          // Let's kill the session to be safe.
          this.kill();
        }
      }, timeoutMs);

      try {
        // Wrap command to redirect stderr to stdout and append marker
        // We use ( ) subshell to capture both streams
        // echo marker needs to happen even if command fails, so use ;
        const wrappedCommand = `( ${command} ) 2>&1; echo "__MCP_END:${marker}:$?__"\n`;
        await this.writer.write(wrappedCommand);
      } catch (e) {
        clearTimeout(timeout);
        this.currentResolver = null;
        this.currentRejecter = null;
        reject(e);
      }
    });
  }

  public kill() {
    try {
      this.process.kill();
    } catch (e) {
      // ignore
    }
  }
}

class SessionManager {
  private sessions: Map<string, TerminalSession> = new Map();

  constructor() {
    // Cleanup interval
    setInterval(() => this.cleanup(), 60 * 1000);
  }

  createSession(): string {
    const id = randomUUID();
    const session = new TerminalSession(id);
    this.sessions.set(id, session);
    return id;
  }

  getSession(id: string): TerminalSession | undefined {
    const session = this.sessions.get(id);
    if (session) {
      session.lastAccessedAt = Date.now();
    }
    return session;
  }

  deleteSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.kill();
      this.sessions.delete(id);
      return true;
    }
    return false;
  }

  listSessions() {
    return Array.from(this.sessions.keys()).map(id => ({
      id,
      lastAccessed: new Date(this.sessions.get(id)!.lastAccessedAt).toISOString()
    }));
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastAccessedAt > SESSION_TTL_MS) {
        console.log(`Cleaning up stale session ${id}`);
        session.kill();
        this.sessions.delete(id);
      }
    }
  }
}

const manager = new SessionManager();

const server = new Server(
  {
    name: "terminal-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_session",
        description: "Create a new persistent terminal session",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "list_sessions",
        description: "List active terminal sessions",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "run_command",
        description: "Run a command in a specific session",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "The session ID to run the command in",
            },
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            timeout: {
              type: "number",
              description: "Timeout in milliseconds (default 60000)",
            },
          },
          required: ["session_id", "command"],
        },
      },
      {
        name: "delete_session",
        description: "Close and delete a terminal session",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "The session ID to delete",
            },
          },
          required: ["session_id"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "create_session") {
    const id = manager.createSession();
    return {
      content: [{ type: "text", text: id }],
    };
  }

  if (name === "list_sessions") {
    const sessions = manager.listSessions();
    return {
      content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
    };
  }

  if (name === "delete_session") {
    const id = String(args?.session_id);
    const success = manager.deleteSession(id);
    return {
      content: [{ type: "text", text: success ? "Session deleted" : "Session not found" }],
    };
  }

  if (name === "run_command") {
    if (!args?.session_id || !args?.command) {
      throw new McpError(ErrorCode.InvalidParams, "Missing session_id or command");
    }
    
    const sessionId = String(args.session_id);
    const command = String(args.command);
    const timeout = Number(args.timeout) || DEFAULT_TIMEOUT_MS;

    const session = manager.getSession(sessionId);
    if (!session) {
      throw new McpError(ErrorCode.InvalidRequest, `Session ${sessionId} not found`);
    }

    try {
      const result = await session.execute(command, timeout);
      return {
        content: [
          {
            type: "text",
            text: result.output,
          },
        ],
        isError: result.exitCode !== 0,
      };
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing command: ${e.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
