import { describe, it, expect, afterAll, beforeAll } from "bun:test";
import { BinaryRunner } from "./binary-runner";
import { ProcessManager } from "../kernel/process-manager";
import { Vault } from "../vault/vault";
import { IPCServer } from "../kernel/ipc-server";
import { SystemMonitor } from "../kernel/system-info";
import { DeviceRegistry } from "../device/registry";
import path from "path";
import { randomUUID } from "crypto";

describe("BinaryRunner Integration", () => {
  const processManager = new ProcessManager();
  const systemMonitor = new SystemMonitor();
  const deviceRegistry = new DeviceRegistry();
  const socketPath = `/tmp/kairo-test-${randomUUID()}.sock`;
  const vault = new Vault();
  const ipcServer = new IPCServer(processManager, systemMonitor, deviceRegistry, vault, socketPath);
  const runner = new BinaryRunner(processManager);
  
  // Connect vault to runner
  runner.setVault(vault);

  const fixturePath = path.resolve(process.cwd(), "tests/fixtures/skills/hello-world/run.sh");
  let skillId: string;

  beforeAll(async () => {
      await ipcServer.start();
  });

  afterAll(() => {
    if (skillId) {
      runner.stop(skillId);
    }
    ipcServer.stop();
  });

  // Helper to collect output for a future process
  const captureOutput = () => {
    const outputs = new Map<string, string>();
    
    const handler = ({ id, type, data }: any) => {
      if (type === 'stdout') {
        const chunk = new TextDecoder().decode(data);
        outputs.set(id, (outputs.get(id) || "") + chunk);
      }
    };
    
    processManager.on('output', handler);
    
    return {
      getOutput: (id: string) => outputs.get(id) || "",
      stop: () => processManager.off('output', handler)
    };
  };

  it("should successfully start a binary skill", async () => {
    const capturer = captureOutput();
    
    // Use custom socket path for test
    const originalEnv = process.env;
    
    skillId = await runner.run("hello-skill", fixturePath, [], {
      TEST_VAR: "true"
    }, {}, undefined); // sandboxConfig undefined

    // Inject socket path override for the test process via IPC env var?
    // BinaryRunner sets KAIRO_IPC_SOCKET to /tmp/kairo-kernel.sock by default.
    // We need to override it or make BinaryRunner configurable.
    // Since BinaryRunner hardcodes the socket path, we might fail IPC connection if we don't patch it.
    // However, for this test (hello-world), it doesn't use IPC.

    expect(skillId).toStartWith("skill-hello-skill-");
    
    const proc = processManager.getProcess(skillId);
    expect(proc).toBeDefined();

    if (proc) {
      await proc.exited;
      const output = capturer.getOutput(skillId);
      capturer.stop();
      
      expect(output).toContain("Hello from Binary Skill!");
      expect(output).toContain("KAIRO_SKILL_NAME=hello-skill");
      expect(await proc.exited).toBe(0);
    }
  });

  it("should NOT inject plaintext secrets into environment", async () => {
    const handle = vault.store("super-secret-value");
    
    const capturer = captureOutput();
    const secretEnvName = "MY_API_KEY";
    
    skillId = await runner.run("vault-test-skill", fixturePath, [], {
      [secretEnvName]: handle.id
    });

    const proc = processManager.getProcess(skillId);
    expect(proc).toBeDefined();

    if (proc) {
      await proc.exited;
      const output = capturer.getOutput(skillId);
      capturer.stop();
      
      // Should contain the HANDLE, not the SECRET
      expect(output).toContain(`${secretEnvName}=${handle.id}`);
      expect(output).not.toContain("super-secret-value");
      expect(await proc.exited).toBe(0);
    }
  });

  it("should allow resolving secrets via IPC", async () => {
    const handle = vault.store("ipc-secret-value");
    const capturer = captureOutput();
    
    // Use the ts fixture
    // BinaryRunner expects a binary, but we can run "bun" as the binary and pass the script as arg
    // However, we need absolute path to bun or assume it's in PATH
    // And we need absolute path to fixture
    
    const clientFixturePath = path.resolve(process.cwd(), "tests/fixtures/skills/vault-client/index.ts");
    
    // We run "bun" as the command
    // Note: processManager.spawn takes command[]
    // But BinaryRunner.run takes (binaryPath, args)
    // So we invoke run("vault-client", "bun", ["run", clientFixturePath], env...)
    
    // Find bun executable
    const bunPath = process.execPath; // current bun executable

    skillId = await runner.run("vault-client-skill", bunPath, ["run", clientFixturePath], {
      MY_API_KEY: handle.id,
      KAIRO_IPC_SOCKET: socketPath // Inject test socket path
    });

    const proc = processManager.getProcess(skillId);
    expect(proc).toBeDefined();

    if (proc) {
      await proc.exited;
      const output = capturer.getOutput(skillId);
      capturer.stop();
      
      console.log("Client Output:", output);

      expect(output).toContain(`Resolved Secret: ipc-secret-value`);
      expect(await proc.exited).toBe(0);
    }
  });
});
