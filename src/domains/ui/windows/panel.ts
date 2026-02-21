/**
 * 任务栏 (Panel) Surface 控制器
 *
 * 渲染层：bottom（通过 KDP set_layer(3)）
 * 高度 36px，锚定屏幕底部。
 *
 * 布局：
 *   左侧 — Kairo Logo 按钮（打开启动器）
 *   中间 — 活动窗口列表
 *   右侧 — Agent 状态 + 系统时钟
 */

import type { KdpNode } from "../builders/kdp-node";
import type { KdpEvent, WindowController } from "../window-manager";
import {
  BG_SURFACE,
  BORDER,
  BRAND_BLUE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  SEMANTIC_SUCCESS,
  SPACING,
} from "../tokens";

/** 面板高度（与设计系统窗口标题栏高度一致） */
export const PANEL_HEIGHT = 36;

/** 窗口列表条目 */
export interface PanelWindowEntry {
  id: string;
  title: string;
  appId: string;
  focused: boolean;
}

export interface PanelOptions {
  /** 屏幕宽度 */
  width: number;
  /** 窗口焦点切换回调 */
  onFocusWindow?: (windowId: string) => void;
  /** 启动器切换回调 */
  onLauncherToggle?: () => void;
}

/**
 * 任务栏控制器
 */
export class PanelController implements WindowController {
  readonly windowType = "panel";
  private width: number;
  private windowList: PanelWindowEntry[] = [];
  private agentActive = false;
  private clockText = "00:00";
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private onFocusWindow?: (windowId: string) => void;
  private onLauncherToggle?: () => void;

  constructor(opts: PanelOptions) {
    this.width = opts.width;
    this.onFocusWindow = opts.onFocusWindow;
    this.onLauncherToggle = opts.onLauncherToggle;
    this.updateClock();
    // 每分钟更新时钟
    this.clockTimer = setInterval(() => this.updateClock(), 60_000);
  }

  private updateClock(): void {
    const now = new Date();
    this.clockText = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  /** 更新窗口列表（由 WindowManager 调用） */
  setWindowList(list: PanelWindowEntry[]): void {
    this.windowList = list;
  }

  /** 更新 Agent 状态 */
  setAgentActive(active: boolean): void {
    this.agentActive = active;
  }

  buildTree(): KdpNode {
    const h = PANEL_HEIGHT;
    const children: KdpNode[] = [];

    // 面板背景
    children.push({
      type: "rect",
      id: "panel-bg",
      x: 0, y: 0,
      width: this.width, height: h,
      color: BG_SURFACE,
    });

    // 顶部边框线
    children.push({
      type: "rect",
      id: "panel-border-top",
      x: 0, y: 0,
      width: this.width, height: 1,
      color: BORDER,
    });

    // === 左侧：Kairo Logo 按钮 ===
    children.push({
      type: "rect",
      id: "panel-logo-bg",
      x: SPACING.sm, y: 6,
      width: 24, height: 24,
      color: [0, 0, 0, 0], // 透明背景，hover 时提亮
      action: "launcher_toggle",
    });
    children.push({
      type: "text",
      id: "panel-logo",
      x: SPACING.sm + 4, y: 10,
      text: "<>",
      color: BRAND_BLUE,
      scale: 2,
    });

    // === 中间：活动窗口列表 ===
    let wx = 48; // Logo 按钮右侧起始
    for (const entry of this.windowList) {
      const labelWidth = entry.title.length * 16 + SPACING.lg; // 估算宽度

      // 窗口条目背景（焦点窗口高亮）
      if (entry.focused) {
        children.push({
          type: "rect",
          id: `panel-win-bg-${entry.id}`,
          x: wx, y: 4,
          width: labelWidth, height: h - 8,
          color: [0.118, 0.118, 0.165, 0.6],
        });
        // 焦点下划线
        children.push({
          type: "rect",
          id: `panel-win-underline-${entry.id}`,
          x: wx, y: h - 2,
          width: labelWidth, height: 2,
          color: BRAND_BLUE,
        });
      }

      children.push({
        type: "text",
        id: `panel-win-${entry.id}`,
        x: wx + SPACING.sm, y: 10,
        text: entry.title,
        color: entry.focused ? TEXT_PRIMARY : TEXT_SECONDARY,
        scale: 2,
        action: `focus_window:${entry.id}`,
      });

      wx += labelWidth + SPACING.sm;
    }

    // === 右侧：Agent 状态 + 时钟 ===
    const rightX = this.width - 80;

    // Agent 状态指示器
    children.push({
      type: "rect",
      id: "panel-agent-dot",
      x: rightX, y: 14,
      width: 8, height: 8,
      color: this.agentActive ? SEMANTIC_SUCCESS : TEXT_SECONDARY,
      radius: 4,
    });

    // 时钟
    children.push({
      type: "text",
      id: "panel-clock",
      x: rightX + 16, y: 14,
      text: this.clockText,
      color: TEXT_SECONDARY,
      scale: 1,
    });

    return { type: "root", children };
  }

  handleEvent(event: KdpEvent): boolean {
    if (event.type === "user_action") {
      const action = event.data.action_type as string;
      if (action === "click") {
        const elementId = event.data.element_id as string;
        if (elementId === "panel-logo-bg") {
          // 触发启动器切换
          this.onLauncherToggle?.();
          return false;
        }
        if (elementId?.startsWith("panel-win-")) {
          // 3.4: 切换窗口焦点
          const winId = elementId.replace("panel-win-", "");
          this.onFocusWindow?.(winId);
          return false;
        }
      }
    }
    return false;
  }

  dispose(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }
}
