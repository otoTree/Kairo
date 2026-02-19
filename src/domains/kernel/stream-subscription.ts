import type { Socket } from 'bun';
import { Protocol, PacketType } from './protocol';

/**
 * 环形缓冲区，用于存储流数据
 * 满时丢弃最旧的 chunk
 */
class RingBuffer {
  private chunks: Uint8Array[] = [];
  private totalSize = 0;

  constructor(private maxSize: number = 1024 * 1024) {} // 默认 1MB

  push(data: Uint8Array): boolean {
    this.chunks.push(data);
    this.totalSize += data.length;

    // 溢出时丢弃最旧的 chunk
    let overflow = false;
    while (this.totalSize > this.maxSize && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.totalSize -= removed.length;
      overflow = true;
    }
    return overflow;
  }

  drain(): Uint8Array[] {
    const result = this.chunks;
    this.chunks = [];
    this.totalSize = 0;
    return result;
  }

  get size() { return this.totalSize; }
}

export interface StreamSubscription {
  id: string;
  processId: string;
  stream: 'stdout' | 'stderr' | 'both';
  mode: 'chunk' | 'line';
  socket: Socket;
  buffer: RingBuffer;
  // line 模式下的行缓冲
  lineBuffer: string;
  sequence: number;
}

/**
 * 流订阅管理器
 * 管理 IPC 客户端对进程 stdout/stderr 的选择性订阅
 */
export class StreamSubscriptionManager {
  private subscriptions = new Map<string, StreamSubscription>();
  // processId → subscriptionId[] 的索引
  private processIndex = new Map<string, Set<string>>();

  /**
   * 创建流订阅
   */
  subscribe(
    processId: string,
    stream: 'stdout' | 'stderr' | 'both',
    mode: 'chunk' | 'line',
    socket: Socket,
    bufferSize?: number
  ): string {
    const id = `stream_${crypto.randomUUID().slice(0, 8)}`;
    const sub: StreamSubscription = {
      id,
      processId,
      stream,
      mode,
      socket,
      buffer: new RingBuffer(bufferSize || 1024 * 1024),
      lineBuffer: '',
      sequence: 0,
    };

    this.subscriptions.set(id, sub);

    if (!this.processIndex.has(processId)) {
      this.processIndex.set(processId, new Set());
    }
    this.processIndex.get(processId)!.add(id);

    return id;
  }

  /**
   * 取消订阅
   */
  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    this.subscriptions.delete(subscriptionId);
    this.processIndex.get(sub.processId)?.delete(subscriptionId);
    if (this.processIndex.get(sub.processId)?.size === 0) {
      this.processIndex.delete(sub.processId);
    }
    return true;
  }

  /**
   * 推送流数据到匹配的订阅者
   * 由 ProcessManager 的 output 事件触发
   */
  push(processId: string, stream: 'stdout' | 'stderr', data: Uint8Array): void {
    const subIds = this.processIndex.get(processId);
    if (!subIds) return;

    for (const subId of subIds) {
      const sub = this.subscriptions.get(subId);
      if (!sub) continue;

      // 检查流类型匹配
      if (sub.stream !== 'both' && sub.stream !== stream) continue;

      if (sub.mode === 'chunk') {
        this.sendChunk(sub, stream, data);
      } else {
        this.sendLines(sub, stream, data);
      }
    }
  }

  private sendChunk(sub: StreamSubscription, stream: 'stdout' | 'stderr', data: Uint8Array): void {
    const overflow = sub.buffer.push(data);

    if (overflow) {
      // 发送溢出警告
      this.sendPacket(sub.socket, PacketType.EVENT, {
        topic: 'stream.overflow',
        data: { subscriptionId: sub.id, processId: sub.processId },
      });
    }

    // 直接发送 STREAM_CHUNK 帧
    sub.sequence++;
    this.sendPacket(sub.socket, PacketType.STREAM_CHUNK, {
      subscriptionId: sub.id,
      stream,
      data,
      sequence: sub.sequence,
    });
  }

  private sendLines(sub: StreamSubscription, stream: 'stdout' | 'stderr', data: Uint8Array): void {
    const text = new TextDecoder().decode(data);
    sub.lineBuffer += text;

    const lines = sub.lineBuffer.split('\n');
    // 最后一个元素是不完整的行，保留在缓冲区
    sub.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.length === 0) continue;
      sub.sequence++;
      this.sendPacket(sub.socket, PacketType.STREAM_CHUNK, {
        subscriptionId: sub.id,
        stream,
        data: new TextEncoder().encode(line + '\n'),
        sequence: sub.sequence,
      });
    }
  }

  private sendPacket(socket: Socket, type: PacketType, payload: any): void {
    try {
      socket.write(Protocol.encode(type, payload));
    } catch (e) {
      console.error('[StreamSubscription] 发送失败:', e);
    }
  }

  /**
   * 清理指定连接的所有订阅
   */
  removeBySocket(socket: Socket): void {
    for (const [id, sub] of this.subscriptions) {
      if (sub.socket === socket) {
        this.unsubscribe(id);
      }
    }
  }

  /**
   * 清理指定进程的所有订阅
   */
  removeByProcess(processId: string): void {
    const subIds = this.processIndex.get(processId);
    if (!subIds) return;
    for (const id of [...subIds]) {
      this.unsubscribe(id);
    }
  }
}
