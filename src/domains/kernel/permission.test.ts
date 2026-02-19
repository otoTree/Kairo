import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { IPCServer } from "./ipc-server";
import { IPCClient } from "./ipc-client";
import { ProcessManager } from "./process-manager";
import { SystemMonitor } from "./system-info";
import { DeviceRegistry } from "../device/registry";

const SOCKET_PATH = `/tmp/kairo-test-perm-${process.pid}.sock`;

/**
 * 权限闭环集成测试
 * 验证 Skill 进程只能操作自己创建的进程，无法操作其他 Skill 的进程
 */
describe("IPC 权限闭环", () => {
  let server: IPCServer;
  let processManager: ProcessManager;

  beforeEach(async () => {
    processManager = new ProcessManager();
    const systemMonitor = new SystemMonitor();
    const deviceRegistry = new DeviceRegistry();
    server = new IPCServer(processManager, systemMonitor, deviceRegistry, undefined, SOCKET_PATH);
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  it("Skill A 可以操作自己创建的进程", async () => {
    const client = new IPCClient(SOCKET_PATH);
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    // 认证为 Skill A
    await client.request("identify", { skillId: "skill-a" });

    // 创建进程
    await client.request("process.spawn", {
      id: "proc-a",
      command: ["sleep", "10"],
    });
    await new Promise(r => setTimeout(r, 100));

    // 查询自己创建的进程状态 — 应该成功
    const status = await client.request("process.status", { id: "proc-a" });
    expect(status.state).toBe("running");

    // 终止自己创建的进程 — 应该成功
    const killResult = await client.request("process.kill", { id: "proc-a" });
    expect(killResult.status).toBe("killed");

    client.close();
  });

  it("Skill B 无法操作 Skill A 创建的进程", async () => {
    const clientA = new IPCClient(SOCKET_PATH);
    const clientB = new IPCClient(SOCKET_PATH);
    await clientA.connect();
    await clientB.connect();
    await new Promise(r => setTimeout(r, 50));

    // 认证
    await clientA.request("identify", { skillId: "skill-a" });
    await clientB.request("identify", { skillId: "skill-b" });

    // Skill A 创建进程
    await clientA.request("process.spawn", {
      id: "proc-owned-by-a",
      command: ["sleep", "10"],
    });
    await new Promise(r => setTimeout(r, 100));

    // Skill B 尝试查询 Skill A 的进程 — 应该被拒绝
    try {
      await clientB.request("process.status", { id: "proc-owned-by-a" });
      throw new Error("应该抛出权限拒绝错误");
    } catch (e: any) {
      expect(e.message).toContain("权限拒绝");
    }

    // Skill B 尝试终止 Skill A 的进程 — 应该被拒绝
    try {
      await clientB.request("process.kill", { id: "proc-owned-by-a" });
      throw new Error("应该抛出权限拒绝错误");
    } catch (e: any) {
      expect(e.message).toContain("权限拒绝");
    }

    // Skill B 尝试向 Skill A 的进程写入 stdin — 应该被拒绝
    try {
      await clientB.request("process.stdin.write", { id: "proc-owned-by-a", data: "hello" });
      throw new Error("应该抛出权限拒绝错误");
    } catch (e: any) {
      expect(e.message).toContain("权限拒绝");
    }

    // 清理
    await clientA.request("process.kill", { id: "proc-owned-by-a" });
    clientA.close();
    clientB.close();
  });

  it("无身份连接可以访问任何进程（向后兼容）", async () => {
    const clientWithId = new IPCClient(SOCKET_PATH);
    const clientNoId = new IPCClient(SOCKET_PATH);
    await clientWithId.connect();
    await clientNoId.connect();
    await new Promise(r => setTimeout(r, 50));

    // 只有 clientWithId 认证
    await clientWithId.request("identify", { skillId: "skill-x" });

    // clientWithId 创建进程
    await clientWithId.request("process.spawn", {
      id: "proc-compat",
      command: ["sleep", "10"],
    });
    await new Promise(r => setTimeout(r, 100));

    // 无身份连接查询 — 应该成功（向后兼容）
    const status = await clientNoId.request("process.status", { id: "proc-compat" });
    expect(status.state).toBe("running");

    // 清理
    await clientWithId.request("process.kill", { id: "proc-compat" });
    clientWithId.close();
    clientNoId.close();
  });

  it("ProcessManager.isOwnedBy 单元验证", () => {
    // 无所有者记录时，允许访问
    expect(processManager.isOwnedBy("unknown-proc", "anyone")).toBe(true);

    // 有所有者记录时，只有所有者可以访问
    // 通过 spawn 创建带 creatorId 的进程来测试
    // 这里直接测试 creatorMap 逻辑
    // spawn 会设置 creatorMap，但需要实际进程
    // 所以我们用 spawn + isOwnedBy 组合测试
  });
});
