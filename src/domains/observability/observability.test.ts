import { describe, it, expect, spyOn, beforeAll, afterAll } from "bun:test";
import { KairoLogger } from "./logger";
import { ObservabilityPlugin } from "./observability.plugin";
import { Application } from "../../core/app";
import fs from "fs";
import path from "path";

describe("Observability", () => {
  describe("Logger", () => {
    it("should include traceId in output when context is set", () => {
      const logger = new KairoLogger({ format: 'json' });
      const spy = spyOn(console, 'log');
      
      logger.withContext({ traceId: "trace-123", spanId: "span-456" }).info("test message");
      
      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[0]!;
      const json = JSON.parse(call[0] as string);
      
      expect(json.traceId).toBe("trace-123");
      expect(json.spanId).toBe("span-456");
      expect(json.msg).toBe("test message");
      
      spy.mockRestore();
    });

    it("should broadcast logs to listeners", () => {
      const received: any[] = [];
      const cleanup = KairoLogger.addListener((entry) => {
        received.push(entry);
      });

      const logger = new KairoLogger();
      logger.info("listener test");

      expect(received.length).toBe(1);
      expect(received[0].msg).toBe("listener test");

      cleanup();
    });
  });

  describe("Plugin & Snapshot", () => {
    const snapshotDir = path.join(process.cwd(), "snapshots");

    beforeAll(async () => {
        if (fs.existsSync(snapshotDir)) {
            await fs.promises.rm(snapshotDir, { recursive: true, force: true });
        }
    });

    afterAll(async () => {
        if (fs.existsSync(snapshotDir)) {
            await fs.promises.rm(snapshotDir, { recursive: true, force: true });
        }
    });

    it("should create snapshot with logs", async () => {
      const app = new Application();
      const plugin = new ObservabilityPlugin();
      
      // Setup app with minimal services mock if needed
      // ObservabilityPlugin uses 'agent' and 'kernel' services.
      // We can register mocks.
      
      app.registerService("agent", {
          globalBus: { subscribe: () => {} },
          registerSystemTool: () => {}
      } as any);
      
      app.registerService("kernel", {
          systemMonitor: { getMetrics: async () => ({ cpu: 10 }) },
          shellManager: { listSessions: () => [] }
      } as any);

      await app.use(plugin);
      await plugin.start();

      // Generate some logs
      const logger = new KairoLogger();
      logger.info("Log for snapshot");

      const result = await plugin.createSnapshot();
      
      expect(result.path).toBeDefined();
      expect(fs.existsSync(result.path)).toBe(true);

      const content = JSON.parse(fs.readFileSync(result.path, 'utf-8'));
      expect(content.logs.length).toBeGreaterThan(0);
      expect(content.logs[0].msg).toBe("Log for snapshot");
      expect(content.system).toBeDefined();
      expect(content.system.cpu).toBe(10);
    });
  });
});
