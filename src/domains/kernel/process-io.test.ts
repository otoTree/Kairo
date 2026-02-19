import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { IPCServer } from "./ipc-server";
import { IPCClient } from "./ipc-client";
import { ProcessManager } from "./process-manager";
import { SystemMonitor } from "./system-info";
import { DeviceRegistry } from "../device/registry";

const SOCKET_PATH = `/tmp/kairo-test-pio-${process.pid}.sock`;

/**
 * Process IO 全双工通信集成测试
 * 验证 Agent 通过 IPC 与子进程（Python REPL）交互
 */
describe("Process IO 全双工通信", () => {
  let server: IPCServer;
  let processManager: ProcessManager;

  beforeEach(async () => {
    processManager = new ProcessManager();
    const systemMonitor = new SystemMonitor();
    const deviceRegistry = new DeviceRegistry();
    server = new IPCServer(
      processManager, systemMonitor, deviceRegistry,
      undefined, SOCKET_PATH
    );
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  it("通过 IPC 与 cat 进程进行 stdin/stdout 交互", async () => {
    const client = new IPCClient(SOCKET_PATH);
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    // 启动 cat 进程（echo stdin to stdout）
    await client.request("process.spawn", {
      id: "cat-proc",
      command: ["cat"],
    });
    await new Promise(r => setTimeout(r, 100));

    // 订阅 stdout
    const subResult = await client.request("process.stdout.subscribe", {
      pid: "cat-proc",
      stream: "stdout",
      mode: "chunk",
    });
    expect(subResult.subscriptionId).toBeDefined();

    // 收集 STREAM_CHUNK
    const chunks: any[] = [];
    client.on("stream", (payload: any) => {
      chunks.push(payload);
    });

    // 写入 stdin
    await client.request("process.stdin.write", {
      id: "cat-proc",
      data: "hello kairo\n",
    });

    // 等待输出
    await new Promise(r => setTimeout(r, 500));

    // 验证收到了输出
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const output = chunks
      .map(c => {
        if (c.data instanceof Uint8Array) return new TextDecoder().decode(c.data);
        if (typeof c.data === "string") return c.data;
        if (c.data?.type === "Buffer") return Buffer.from(c.data.data).toString();
        return String(c.data);
      })
      .join("");
    expect(output).toContain("hello kairo");

    // 验证 sequence 单调递增
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].sequence).toBeGreaterThan(chunks[i - 1].sequence);
    }

    // 终止进程
    await client.request("process.kill", { id: "cat-proc" });
    client.close();
  });

  it("process.status 返回正确的进程状态", async () => {
    const client = new IPCClient(SOCKET_PATH);
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    // 启动进程
    await client.request("process.spawn", {
      id: "status-proc",
      command: ["sleep", "10"],
    });
    await new Promise(r => setTimeout(r, 100));

    // 查询运行中的进程
    const running = await client.request("process.status", { id: "status-proc" });
    expect(running.state).toBe("running");

    // 终止进程
    await client.request("process.kill", { id: "status-proc" });
    await new Promise(r => setTimeout(r, 200));

    // 查询已退出的进程
    const exited = await client.request("process.status", { id: "status-proc" });
    expect(exited.state).toBe("exited");

    client.close();
  });

  it("process.wait 等待进程退出并返回退出码", async () => {
    const client = new IPCClient(SOCKET_PATH);
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    // 启动一个快速退出的进程
    await client.request("process.spawn", {
      id: "wait-proc",
      command: ["echo", "done"],
    });

    // 等待进程退出
    const result = await client.request("process.wait", { id: "wait-proc" });
    expect(result.status).toBe("exited");
    expect(result.exitCode).toBe(0);

    client.close();
  });

  it("通过 IPC 与 Python3 REPL 交互", async () => {
    // 检查 python3 是否可用
    const proc = Bun.spawn(["which", "python3"]);
    const whichResult = await proc.exited;
    if (whichResult !== 0) {
      console.log("跳过: python3 不可用");
      return;
    }

    const client = new IPCClient(SOCKET_PATH);
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    // 启动 Python3，使用 -u 禁用缓冲，-i 强制交互模式
    await client.request("process.spawn", {
      id: "python-repl",
      command: ["python3", "-u", "-i"],
    });
    await new Promise(r => setTimeout(r, 500));

    // 订阅 stdout + stderr
    const subResult = await client.request("process.stdout.subscribe", {
      pid: "python-repl",
      stream: "both",
      mode: "chunk",
    });
    expect(subResult.subscriptionId).toBeDefined();

    const chunks: any[] = [];
    client.on("stream", (payload: any) => {
      chunks.push(payload);
    });

    // 发送 Python 表达式
    await client.request("process.stdin.write", {
      id: "python-repl",
      data: "print(2 + 3)\n",
    });

    // 等待输出
    await new Promise(r => setTimeout(r, 1000));

    // 验证输出包含计算结果
    const allOutput = chunks
      .map(c => {
        if (c.data instanceof Uint8Array) return new TextDecoder().decode(c.data);
        if (typeof c.data === "string") return c.data;
        if (c.data?.type === "Buffer") return Buffer.from(c.data.data).toString();
        return String(c.data);
      })
      .join("");
    expect(allOutput).toContain("5");

    // 终止 Python 进程
    await client.request("process.kill", { id: "python-repl" });
    client.close();
  });

  it("line 模式按行推送数据", async () => {
    const client = new IPCClient(SOCKET_PATH);
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    // 启动 cat 进程
    await client.request("process.spawn", {
      id: "line-proc",
      command: ["cat"],
    });
    await new Promise(r => setTimeout(r, 100));

    // 以 line 模式订阅
    await client.request("process.stdout.subscribe", {
      pid: "line-proc",
      stream: "stdout",
      mode: "line",
    });

    const chunks: any[] = [];
    client.on("stream", (payload: any) => {
      chunks.push(payload);
    });

    // 写入多行数据
    await client.request("process.stdin.write", {
      id: "line-proc",
      data: "line1\nline2\nline3\n",
    });

    await new Promise(r => setTimeout(r, 500));

    // 验证收到了至少 3 个 chunk（每行一个）
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    // 终止进程
    await client.request("process.kill", { id: "line-proc" });
    client.close();
  });
});
