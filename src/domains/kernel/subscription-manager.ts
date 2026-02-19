import type { Socket } from 'bun';
import { Protocol, PacketType } from './protocol';
import type { KairoEvent } from '../events/types';

export interface TopicSubscription {
  id: string;
  topic: string;
  regex: RegExp;
  socket: Socket;
}

/**
 * EventBus topic 订阅管理器
 * 管理 IPC 客户端对 EventBus 事件的选择性订阅
 */
export class TopicSubscriptionManager {
  private subscriptions = new Map<string, TopicSubscription>();
  // socket → subscriptionId[] 的索引
  private socketIndex = new Map<Socket, Set<string>>();

  /**
   * 订阅 EventBus topic
   * 支持通配符：* 匹配单段，> 匹配剩余部分
   */
  subscribe(topic: string, socket: Socket): string {
    const id = `topic_${crypto.randomUUID().slice(0, 8)}`;

    // 将 topic 模式转换为正则表达式
    const regexStr = topic
      .replace(/\./g, '\\.')
      .replace(/\*/g, '[^.]+')
      .replace(/>/g, '.+');
    const regex = new RegExp(`^${regexStr}$`);

    const sub: TopicSubscription = { id, topic, regex, socket };
    this.subscriptions.set(id, sub);

    if (!this.socketIndex.has(socket)) {
      this.socketIndex.set(socket, new Set());
    }
    this.socketIndex.get(socket)!.add(id);

    return id;
  }

  /**
   * 取消订阅
   */
  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    this.subscriptions.delete(subscriptionId);
    this.socketIndex.get(sub.socket)?.delete(subscriptionId);
    if (this.socketIndex.get(sub.socket)?.size === 0) {
      this.socketIndex.delete(sub.socket);
    }
    return true;
  }

  /**
   * 分发事件到匹配的订阅者
   * 由 EventBus 桥接调用
   */
  dispatch(event: KairoEvent): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.regex.test(event.type)) {
        try {
          const packet = Protocol.encode(PacketType.EVENT, {
            topic: event.type,
            payload: event.data,
            correlationId: event.correlationId,
            causationId: event.causationId,
            traceId: event.traceId,
            source: event.source,
            time: event.time,
            id: event.id,
          });
          sub.socket.write(packet);
        } catch (e) {
          console.error('[TopicSubscription] 发送失败:', e);
        }
      }
    }
  }

  /**
   * 清理指定连接的所有订阅
   */
  removeBySocket(socket: Socket): void {
    const subIds = this.socketIndex.get(socket);
    if (!subIds) return;
    for (const id of [...subIds]) {
      this.subscriptions.delete(id);
    }
    this.socketIndex.delete(socket);
  }
}
