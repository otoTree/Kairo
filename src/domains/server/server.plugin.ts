import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { cors } from "hono/cors";
import type { WSContext } from "hono/ws";
import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import type { AgentPlugin } from "../agent/agent.plugin";
import type { ServerWebSocket } from "bun";

export class ServerPlugin implements Plugin {
  readonly name = "server";
  private app: Hono;
  private port: number;
  private coreApp?: Application;
  private agent?: AgentPlugin;
  private activeWebSockets: Set<WSContext<unknown>> = new Set();
  private server?: any;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = new Hono();
    
    const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<unknown>>();

    this.app.use("/*", cors({
        origin: '*', // For dev
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
        exposeHeaders: ['Content-Length'],
        maxAge: 600,
        credentials: true,
    }));

    this.app.get("/", (c) => c.json({ status: "ok", service: "Kairo Agent" }));

    this.app.get(
      "/ws",
      upgradeWebSocket((c) => {
        return {
          onOpen: (event, ws) => {
            console.log("[Server] Client connected");
            this.activeWebSockets.add(ws);
          },
          onMessage: (event, ws) => {
            const msg = event.data.toString();
            console.log(`[Server] Received: ${msg}`);
            if (this.agent) {
                try {
                    const data = JSON.parse(msg);
                    
                    if (data.type === 'user_message' || data.type === 'user_input') {
                        // Standardize on user_message
                        // We publish a standard KairoEvent
                        this.agent.globalBus.publish({
                            type: 'kairo.user.message',
                            source: 'client:web', // or ws id
                            data: { 
                                content: data.text || data.content,
                                targetAgentId: data.agentId
                            }
                        });
                    }
                } catch (e) {
                    console.error("[Server] Failed to parse message", e);
                }
            }
          },
          onClose: (event, ws) => {
            console.log("[Server] Client disconnected");
            this.activeWebSockets.delete(ws);
          },
        };
      })
    );
  }

  setup(app: Application) {
    this.coreApp = app;
    console.log("[Server] Setting up Server domain...");
    app.registerService("server", this);
  }

  async start() {
    console.log("[Server] Starting Server domain...");
    
    // Connect to Agent
    try {
        this.agent = this.coreApp?.getService<AgentPlugin>("agent");
        if (this.agent) {
            const bus = this.agent.globalBus;

            // Subscribe to standard Kairo events
            bus.subscribe("kairo.agent.thought", (event) => {
                this.broadcast(event);
            });
            
            bus.subscribe("kairo.agent.action", (event) => {
                this.broadcast(event);
            });

            bus.subscribe("kairo.tool.result", (event) => {
                this.broadcast(event);
            });
            
            bus.subscribe("kairo.system.log", (event) => {
                 this.broadcast(event);
            });
            
            // Also subscribe to legacy output for compatibility if Runtime emits them?
            // Runtime emits kairo.agent.thought, etc.
            
            console.log("[Server] Connected to AgentPlugin (Event Bus)");
        }
    } catch (e) {
        console.warn("[Server] AgentPlugin not found, running in standalone mode");
    }

    const { websocket } = createBunWebSocket<ServerWebSocket<unknown>>();

    this.server = Bun.serve({
      fetch: this.app.fetch,
      port: this.port,
      websocket,
    });

    console.log(`[Server] Listening on http://localhost:${this.port}`);
  }

  async stop() {
    if (this.server) {
        this.server.stop();
        console.log("[Server] Stopped");
    }
  }

  private broadcast(data: any) {
      const msg = JSON.stringify(data);
      for (const ws of this.activeWebSockets) {
          try {
            ws.send(msg);
          } catch (e) {
            console.error("Failed to send message to client", e);
            this.activeWebSockets.delete(ws);
          }
      }
  }
}
