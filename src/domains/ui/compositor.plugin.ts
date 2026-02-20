import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import type { EventBus } from "../events/types";
import type { RenderCommitEvent, SignalEvent, SurfaceState, UserActionEvent } from "./types";
import { diffTree, type PatchOp } from "./ui-diff";
import type { AgentPlugin } from "../agent/agent.plugin";

export class CompositorPlugin implements Plugin {
  name = "compositor";
  private surfaces: Map<string, SurfaceState> = new Map();
  private eventBus?: EventBus;
  private app?: Application;

  async setup(app: Application) {
    this.app = app;
    app.registerService("compositor", this);
  }

  async start() {
    if (!this.app) return;

    try {
      const agent = this.app.getService<AgentPlugin>("agent");
      this.eventBus = agent.globalBus;
    } catch {
      console.warn("[Compositor] AgentPlugin not found, using app.events fallback");
      this.eventBus = (this.app as any).events;
    }

    if (!this.eventBus) return;

    // 订阅 Agent 渲染提交
    this.eventBus.subscribe("kairo.agent.render.commit", this.handleRenderCommit.bind(this));

    // 订阅 UI 信号（来自前端/Shell）
    this.eventBus.subscribe("kairo.ui.signal", this.handleSignal.bind(this));

    // 订阅 KDP user_action 事件（来自 Wayland 合成器）
    this.eventBus.subscribe("kairo.ui.user_action", this.handleUserAction.bind(this));

    console.log("[Compositor] Started with signal routing and UI diff");
  }

  /**
   * 处理 Agent 渲染提交：使用 UI diff 算法减少重绘
   */
  private handleRenderCommit(event: any) {
    const payload = event.data as RenderCommitEvent["data"];
    const { surfaceId, tree } = payload;

    let surface = this.surfaces.get(surfaceId);
    if (!surface) {
      surface = {
        id: surfaceId,
        agentId: event.source,
        title: "Agent Window",
        visible: true,
        tree: tree,
      };
      this.surfaces.set(surfaceId, surface);
      console.log(`[Compositor] Surface ${surfaceId} created by ${event.source}`);
    } else {
      // UI diff：对比新旧树，仅更新变化节点
      const patches = diffTree(surface.tree, tree);
      if (patches.length === 0) {
        console.log(`[Compositor] Surface ${surfaceId}: no changes detected`);
        return;
      }

      surface.tree = tree;
      console.log(`[Compositor] Surface ${surfaceId} updated (${patches.length} patches)`);

      // 发布 diff 事件，供前端增量更新
      this.eventBus?.publish({
        type: 'kairo.ui.diff',
        source: 'compositor',
        data: { surfaceId, patches },
      });
    }
  }

  /**
   * 处理 UI 信号：路由到对应 Agent
   */
  private handleSignal(event: any) {
    const payload = event.data as SignalEvent["data"];
    const { surfaceId, signal, slot, args } = payload;

    // 根据 surfaceId 查找对应的 agentId
    const surface = this.surfaces.get(surfaceId);
    if (!surface) {
      console.warn(`[Compositor] Signal for unknown surface: ${surfaceId}`);
      return;
    }

    // 验证 slot 是否存在于 UI 树中
    if (surface.tree && !this.findSlotInTree(surface.tree, slot)) {
      console.warn(`[Compositor] Slot '${slot}' not found in surface ${surfaceId}`);
    }

    // 定向路由到对应 Agent
    this.eventBus?.publish({
      type: `kairo.agent.${surface.agentId}.ui.signal`,
      source: 'compositor',
      data: { surfaceId, signal, slot, args, agentId: surface.agentId },
    });

    console.log(`[Compositor] Signal ${signal}→${slot} routed to agent:${surface.agentId}`);
  }

  /**
   * 处理 KDP user_action 事件：从 Wayland 合成器回传的用户交互
   */
  private handleUserAction(event: any) {
    const payload = event.data as UserActionEvent["data"];
    const { surfaceId, elementId, actionType } = payload;

    const surface = this.surfaces.get(surfaceId);
    if (!surface) {
      console.warn(`[Compositor] user_action for unknown surface: ${surfaceId}`);
      return;
    }

    // 转换为标准 UI 信号并路由到 Agent
    this.eventBus?.publish({
      type: `kairo.agent.${surface.agentId}.ui.signal`,
      source: 'kdp',
      data: {
        surfaceId,
        signal: actionType,
        slot: elementId,
        args: [payload.payload],
        agentId: surface.agentId,
      },
    });

    console.log(`[Compositor] KDP user_action: ${actionType} on ${elementId} → agent:${surface.agentId}`);
  }

  /**
   * 在 UI 树中查找指定 slot（信号目标）
   */
  private findSlotInTree(node: any, slot: string): boolean {
    if (node.signals) {
      for (const value of Object.values(node.signals)) {
        if (value === slot) return true;
      }
    }
    if (node.id === slot) return true;
    if (node.children) {
      for (const child of node.children) {
        if (this.findSlotInTree(child, slot)) return true;
      }
    }
    return false;
  }

  public getSurface(id: string): SurfaceState | undefined {
    return this.surfaces.get(id);
  }

  public getAllSurfaces(): SurfaceState[] {
    return Array.from(this.surfaces.values());
  }
}
