/**
 * 窗口生命周期管理器
 *
 * 统一管理所有 Kairo 窗口的创建、销毁、焦点切换，
 * 并将 KDP 事件路由到对应窗口控制器。
 */

import type { KdpNode } from "./builders/kdp-node";
import { InteractionState } from "./state";

// ============================================================
// 窗口控制器接口
// ============================================================

/** KDP 事件类型 */
export type KdpEventType = "user_action" | "key_event" | "pointer_event" | "focus_event";

/** KDP 事件载荷 */
export interface KdpEvent {
  type: KdpEventType;
  surfaceId: string;
  data: Record<string, any>;
}

/**
 * 窗口控制器接口
 *
 * 每种窗口类型（品牌/终端/文件管理器）实现此接口，
 * WindowManager 通过它驱动窗口的渲染和事件处理。
 */
export interface WindowController {
  /** 窗口类型标识 */
  readonly windowType: string;
  /** 构建当前 UI 树 */
  buildTree(): KdpNode;
  /** 处理 KDP 事件，返回是否需要重绘 */
  handleEvent?(event: KdpEvent): boolean;
  /** 窗口销毁时的清理 */
  dispose?(): void;
}

// ============================================================
// 窗口实例
// ============================================================

export interface WindowInstance {
  id: string;
  surfaceId: string;
  controller: WindowController;
  interaction: InteractionState;
  focused: boolean;
  createdAt: number;
}

// ============================================================
// 窗口管理器
// ============================================================

/** 窗口创建/销毁回调 */
export interface WindowManagerCallbacks {
  /** UI 树需要提交到 KDP（surfaceId → JSON） */
  onCommit?: (surfaceId: string, tree: KdpNode) => void;
  /** 窗口被销毁 */
  onDestroy?: (surfaceId: string) => void;
}

export class WindowManager {
  private windows = new Map<string, WindowInstance>();
  private callbacks: WindowManagerCallbacks;
  private nextId = 1;

  constructor(callbacks: WindowManagerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * 创建窗口并绑定到 Surface
   */
  create(surfaceId: string, controller: WindowController): WindowInstance {
    const id = `win_${this.nextId++}`;
    const instance: WindowInstance = {
      id,
      surfaceId,
      controller,
      interaction: new InteractionState(() => this.requestRedraw(id)),
      focused: false,
      createdAt: Date.now(),
    };

    this.windows.set(id, instance);
    console.log(`[WindowManager] 创建窗口 ${id} (${controller.windowType}) → surface:${surfaceId}`);

    // 首次渲染
    this.requestRedraw(id);
    return instance;
  }

  /**
   * 销毁窗口
   */
  destroy(windowId: string): void {
    const win = this.windows.get(windowId);
    if (!win) return;

    win.controller.dispose?.();
    win.interaction.reset();
    this.windows.delete(windowId);
    this.callbacks.onDestroy?.(win.surfaceId);
    console.log(`[WindowManager] 销毁窗口 ${windowId}`);
  }

  /**
   * 设置焦点窗口（自动取消其他窗口焦点）
   */
  setFocus(windowId: string): void {
    for (const [id, win] of this.windows) {
      const wasFocused = win.focused;
      win.focused = id === windowId;
      if (wasFocused !== win.focused) {
        this.requestRedraw(id);
      }
    }
  }

  /**
   * 分发 KDP 事件到对应窗口
   * 通过 surfaceId 查找窗口，调用控制器的 handleEvent
   */
  dispatchEvent(event: KdpEvent): void {
    const win = this.findBySurface(event.surfaceId);
    if (!win) {
      console.warn(`[WindowManager] 未知 surface: ${event.surfaceId}`);
      return;
    }

    // 交互状态更新
    if (event.type === "pointer_event" && event.data.event_type === 0) {
      // motion → hover 检测（需要 Zig 层命中测试结果）
      const elementId = event.data.hitElementId as string | undefined;
      if (win.interaction.setHover(elementId ?? null)) {
        this.requestRedraw(win.id);
      }
    }

    if (event.type === "focus_event") {
      win.focused = !!event.data.focused;
    }

    // 转发给窗口控制器
    const needsRedraw = win.controller.handleEvent?.(event) ?? false;
    if (needsRedraw) {
      this.requestRedraw(win.id);
    }
  }

  /** 请求重绘指定窗口 */
  requestRedraw(windowId: string): void {
    const win = this.windows.get(windowId);
    if (!win) return;

    const tree = win.controller.buildTree();
    this.callbacks.onCommit?.(win.surfaceId, tree);
  }

  /** 通过 surfaceId 查找窗口 */
  findBySurface(surfaceId: string): WindowInstance | undefined {
    for (const win of this.windows.values()) {
      if (win.surfaceId === surfaceId) return win;
    }
    return undefined;
  }

  /** 获取所有窗口 */
  getAll(): WindowInstance[] {
    return Array.from(this.windows.values());
  }

  /** 获取当前焦点窗口 */
  getFocused(): WindowInstance | undefined {
    for (const win of this.windows.values()) {
      if (win.focused) return win;
    }
    return undefined;
  }
}
