import { listen, type Socket } from 'bun';
import { unlink } from 'node:fs/promises';
import { Protocol, PacketType, type Packet } from './protocol';
import type { ProcessManager } from './process-manager';
import type { SystemMonitor } from './system-info';
import type { DeviceRegistry } from '../device/registry';
import type { Vault } from '../vault/vault';
import type { EventBus, KairoEvent } from '../events/types';
import { StreamSubscriptionManager } from './stream-subscription';
import { TopicSubscriptionManager } from './subscription-manager';

/**
 * IPC 连接身份信息
 */
export interface IPCConnectionIdentity {
  pid?: number;
  skillId?: string;
  runtimeToken?: string;
}

export class IPCServer {
  private socketPath: string;
  private server: any;
  private connections = new Set<Socket>();
  private buffers = new Map<Socket, Buffer>();
  private identities = new Map<Socket, IPCConnectionIdentity>();
  private streamSubs = new StreamSubscriptionManager();
  private topicSubs = new TopicSubscriptionManager();
  private eventBus?: EventBus;

  constructor(
    private processManager: ProcessManager,
    private systemMonitor: SystemMonitor,
    private deviceRegistry: DeviceRegistry,
    private vault?: Vault,
    socketPath: string = '/tmp/kairo-kernel.sock'
  ) {
    this.socketPath = socketPath;
    this.setupProcessEvents();
  }

  setVault(vault: Vault) {
    this.vault = vault;
  }

  /**
   * 注入 EventBus，启用 topic 订阅桥接
   */
  setEventBus(bus: EventBus) {
    this.eventBus = bus;
    bus.subscribe('kairo.>', (event: KairoEvent) => {
      this.topicSubs.dispatch(event);
    });
  }

  private setupProcessEvents() {
    // 流数据通过 StreamSubscriptionManager 选择性推送
    this.processManager.on('output', ({ id, type, data }: { id: string; type: 'stdout' | 'stderr'; data: Uint8Array }) => {
      this.streamSubs.push(id, type, data);
    });

    // 进程退出事件广播
    this.processManager.on('exit', ({ id, code }: { id: string; code: number }) => {
      this.broadcast(PacketType.EVENT, { topic: 'process.exit', data: { id, code } });
      this.streamSubs.removeByProcess(id);
    });
  }

  async start() {
    try { await unlink(this.socketPath); } catch (e) { /* 忽略 */ }

    this.server = listen({
      unix: this.socketPath,
      socket: {
        data: (socket, data) => this.handleData(socket, data),
        open: (socket) => {
          console.log('[IPC] 客户端已连接');
          this.connections.add(socket);
          this.buffers.set(socket, Buffer.alloc(0));
        },
        close: (socket) => {
          console.log('[IPC] 客户端已断开');
          this.cleanupSocket(socket);
        },
        error: (socket, error) => {
          console.error('[IPC] Socket 错误:', error);
          this.cleanupSocket(socket);
        }
      },
    });
    console.log(`[IPC] 服务端监听 ${this.socketPath}`);
  }

  private cleanupSocket(socket: Socket) {
    this.connections.delete(socket);
    this.buffers.delete(socket);
    this.identities.delete(socket);
    this.streamSubs.removeBySocket(socket);
    this.topicSubs.removeBySocket(socket);
  }

  private handleData(socket: Socket, data: Buffer) {
    let buffer = this.buffers.get(socket) || Buffer.alloc(0);
    buffer = Buffer.concat([buffer, data]);

    try {
      while (true) {
        const result = Protocol.decode(buffer);
        if (!result) break;
        const { packet, consumed } = result;
        buffer = buffer.subarray(consumed);
        this.processPacket(socket, packet);
      }
    } catch (e) {
      console.error('[IPC] 协议错误:', e);
      socket.close();
    }
    this.buffers.set(socket, buffer);
  }

  private async processPacket(socket: Socket, packet: Packet) {
    if (packet.type !== PacketType.REQUEST) return;

    const { id, method, params } = packet.payload;
    let result: any = null;
    let error: string | undefined;

    try {
      // 权限检查：process.* 方法（spawn 除外）需要所有权验证
      if (method.startsWith('process.') && method !== 'process.spawn') {
        this.checkProcessPermission(socket, method, params);
      }

      result = await this.dispatch(socket, method, params);
    } catch (e: any) {
      error = e.message || String(e);
    }

    socket.write(Protocol.encode(PacketType.RESPONSE, { id, result, error }));
  }

  private async dispatch(socket: Socket, method: string, params: any): Promise<any> {
    switch (method) {
      // === 系统 ===
      case 'system.get_metrics':
        return await this.systemMonitor.getMetrics();

      // === 进程管理 ===
      case 'process.spawn': {
        if (!params?.id || !params?.command) throw new Error('缺少参数: id, command');
        const identity = this.identities.get(socket);
        const creatorId = identity?.skillId || identity?.runtimeToken || undefined;
        await this.processManager.spawn(params.id, params.command, params.options, creatorId);
        return { status: 'spawned', id: params.id };
      }
      case 'process.kill':
        if (!params?.id) throw new Error('缺少参数: id');
        this.processManager.kill(params.id);
        return { status: 'killed', id: params.id };

      case 'process.stdin.write':
        if (!params?.id || params?.data === undefined) throw new Error('缺少参数: id, data');
        this.processManager.writeToStdin(params.id, params.data);
        return { status: 'written', id: params.id };

      case 'process.wait': {
        if (!params?.id) throw new Error('缺少参数: id');
        const exitCode = await this.processManager.wait(params.id);
        return { status: 'exited', id: params.id, exitCode };
      }
      case 'process.status':
        if (!params?.id) throw new Error('缺少参数: id');
        return this.processManager.getStatus(params.id);

      case 'process.pause': {
        if (!params?.id) throw new Error('缺少参数: id');
        const ok = this.processManager.pause(params.id);
        return { status: ok ? 'paused' : 'failed', id: params.id };
      }
      case 'process.resume': {
        if (!params?.id) throw new Error('缺少参数: id');
        const ok = this.processManager.resume(params.id);
        return { status: ok ? 'resumed' : 'failed', id: params.id };
      }

      // === 流订阅 ===
      case 'process.stdout.subscribe': {
        if (!params?.pid) throw new Error('缺少参数: pid');
        const subId = this.streamSubs.subscribe(
          params.pid, params.stream || 'both', params.mode || 'chunk', socket, params.bufferSize
        );
        return { subscriptionId: subId };
      }
      case 'process.stdout.unsubscribe':
        if (!params?.subscriptionId) throw new Error('缺少参数: subscriptionId');
        return { ok: this.streamSubs.unsubscribe(params.subscriptionId) };

      // === EventBus topic 订阅 ===
      case 'subscribe':
        if (!params?.topic) throw new Error('缺少参数: topic');
        return { subscriptionId: this.topicSubs.subscribe(params.topic, socket) };

      case 'unsubscribe':
        if (!params?.subscriptionId) throw new Error('缺少参数: subscriptionId');
        return { ok: this.topicSubs.unsubscribe(params.subscriptionId) };

      // === 身份认证 ===
      case 'identify':
        this.identities.set(socket, {
          pid: params?.pid, skillId: params?.skillId, runtimeToken: params?.runtimeToken,
        });
        return { status: 'identified' };

      // === 设备 ===
      case 'device.list':
        return this.deviceRegistry.list();

      // === Vault ===
      case 'vault.get': {
        if (!this.vault) throw new Error('Vault 服务不可用');
        if (!params?.token || !params?.handle) throw new Error('缺少参数: token, handle');
        const secret = this.vault.resolveWithToken(params.token, params.handle);
        if (secret === undefined) throw new Error('访问被拒绝或句柄无效');
        return { value: secret };
      }

      default:
        throw new Error(`未知方法: ${method}`);
    }
  }

  /**
   * 检查进程操作权限
   */
  private checkProcessPermission(socket: Socket, method: string, params: any): void {
    const identity = this.identities.get(socket);
    if (!identity?.skillId) return; // 无身份信息，允许访问（向后兼容）

    const processId = params?.id || params?.pid;
    if (!processId) return;

    const creatorId = identity.skillId || identity.runtimeToken;
    if (creatorId && !this.processManager.isOwnedBy(processId, creatorId)) {
      throw new Error(`权限拒绝: ${method} 对进程 ${processId}`);
    }
  }

  private broadcast(type: PacketType, payload: any) {
    const packet = Protocol.encode(type, payload);
    for (const socket of this.connections) {
      try { socket.write(packet); } catch (e) {
        console.error('[IPC] 广播错误:', e);
        this.connections.delete(socket);
      }
    }
  }

  stop() {
    if (this.server) {
      this.server.stop();
      this.connections.clear();
      this.buffers.clear();
      this.identities.clear();
    }
  }
}
