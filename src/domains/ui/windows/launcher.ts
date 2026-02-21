/**
 * 应用启动器 (Launcher) Surface 控制器
 *
 * 渲染层：overlay（通过 KDP set_layer(1)，始终置顶）
 * 尺寸：480×520px，屏幕居中
 * 触发：Super 键 / 点击面板 Logo
 */

import type { KdpNode } from "../builders/kdp-node";
import type { KdpEvent, WindowController } from "../window-manager";
import {
  BG_ELEVATED,
  BG_SURFACE,
  BG_OVERLAY,
  BORDER,
  BRAND_BLUE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  SPACING,
  RADIUS,
} from "../tokens";
import { PREINSTALLED_APPS, groupByCategory, type AppEntry } from "../apps";

/** 启动器尺寸 */
const LAUNCHER_W = 480;
const LAUNCHER_H = 520;

/** 应用卡片尺寸 */
const CARD_W = 120;
const CARD_H = 96;
const CARD_GAP = SPACING.lg;
const CARD_PADDING = SPACING.md;
const CARDS_PER_ROW = 3;

export interface LauncherOptions {
  /** 屏幕宽度（用于居中计算） */
  screenWidth: number;
  /** 屏幕高度 */
  screenHeight: number;
}

/**
 * 应用启动器控制器
 */
export class LauncherController implements WindowController {
  readonly windowType = "launcher";
  private visible = false;
  private searchText = "";
  private apps: AppEntry[] = PREINSTALLED_APPS;
  private screenWidth: number;
  private screenHeight: number;
  /** 应用启动回调 */
  onLaunchApp?: (appId: string) => void;

  constructor(opts: LauncherOptions) {
    this.screenWidth = opts.screenWidth;
    this.screenHeight = opts.screenHeight;
  }

  /** 切换显示/隐藏 */
  toggle(): boolean {
    this.visible = !this.visible;
    return true; // 需要重绘
  }

  isVisible(): boolean {
    return this.visible;
  }

  hide(): boolean {
    if (!this.visible) return false;
    this.visible = false;
    this.searchText = "";
    return true;
  }

  buildTree(): KdpNode {
    if (!this.visible) {
      // 隐藏时返回空树
      return { type: "root", children: [] };
    }

    // 居中位置
    const ox = Math.floor((this.screenWidth - LAUNCHER_W) / 2);
    const oy = Math.floor((this.screenHeight - LAUNCHER_H) / 2);

    const children: KdpNode[] = [];

    // 半透明遮罩（全屏）
    children.push({
      type: "rect",
      id: "launcher-backdrop",
      x: 0, y: 0,
      width: this.screenWidth,
      height: this.screenHeight,
      color: [0.051, 0.051, 0.071, 0.5],
      action: "launcher_close",
    });

    // 启动器面板背景
    children.push({
      type: "rect",
      id: "launcher-bg",
      x: ox, y: oy,
      width: LAUNCHER_W, height: LAUNCHER_H,
      color: BG_ELEVATED,
      radius: RADIUS.lg,
      border_width: 1,
      border_color: BORDER,
    });

    // 搜索框
    children.push({
      type: "input",
      id: "launcher-search",
      x: ox + SPACING.lg, y: oy + SPACING.lg,
      width: LAUNCHER_W - 2 * SPACING.lg, height: 32,
      placeholder: "搜索应用...",
      value: this.searchText || undefined,
      focused: true,
    });

    // 分割线
    children.push({
      type: "rect",
      id: "launcher-divider",
      x: ox, y: oy + 60,
      width: LAUNCHER_W, height: 1,
      color: BORDER,
    });

    // 过滤应用
    const filtered = this.searchText
      ? this.apps.filter(a =>
          a.name.toLowerCase().includes(this.searchText.toLowerCase()) ||
          a.id.toLowerCase().includes(this.searchText.toLowerCase()))
      : this.apps;

    // 按分类渲染应用卡片
    const groups = groupByCategory(filtered);
    let cy = oy + 72; // 搜索框下方起始 Y

    for (const [category, apps] of groups) {
      // 分类标题
      children.push({
        type: "text",
        id: `launcher-cat-${category}`,
        x: ox + SPACING.lg, y: cy,
        text: category,
        color: TEXT_TERTIARY,
        scale: 1,
      });
      cy += 20;

      // 卡片网格
      for (let i = 0; i < apps.length; i++) {
        const app = apps[i];
        const col = i % CARDS_PER_ROW;
        const row = Math.floor(i / CARDS_PER_ROW);
        const cx = ox + SPACING.lg + col * (CARD_W + CARD_GAP);
        const cardY = cy + row * (CARD_H + CARD_GAP);

        // 卡片背景
        children.push({
          type: "rect",
          id: `launcher-card-${app.id}`,
          x: cx, y: cardY,
          width: CARD_W, height: CARD_H,
          color: BG_SURFACE,
          radius: RADIUS.md,
          action: `launch:${app.id}`,
        });

        // 图标
        children.push({
          type: "text",
          id: `launcher-icon-${app.id}`,
          x: cx + CARD_PADDING, y: cardY + CARD_PADDING,
          text: app.icon,
          color: BRAND_BLUE,
          scale: 4,
        });

        // 名称
        children.push({
          type: "text",
          id: `launcher-name-${app.id}`,
          x: cx + CARD_PADDING, y: cardY + CARD_H - 20,
          text: app.name,
          color: TEXT_SECONDARY,
          scale: 1,
        });
      }

      const rows = Math.ceil(apps.length / CARDS_PER_ROW);
      cy += rows * (CARD_H + CARD_GAP) + SPACING.sm;
    }

    return { type: "root", children };
  }

  handleEvent(event: KdpEvent): boolean {
    if (!this.visible) return false;

    if (event.type === "user_action") {
      const elementId = event.data.element_id as string;
      const actionType = event.data.action_type as string;

      if (actionType === "click") {
        if (elementId === "launcher-backdrop") {
          return this.hide();
        }
        if (elementId?.startsWith("launcher-card-")) {
          const appId = elementId.replace("launcher-card-", "");
          console.log(`[Launcher] 启动应用: ${appId}`);
          this.onLaunchApp?.(appId);
          return this.hide();
        }
      }

      // 搜索框输入
      if (elementId === "launcher-search" && actionType === "submit") {
        this.searchText = (event.data.payload as string) || "";
        return true;
      }
    }

    if (event.type === "key_event") {
      const key = event.data.key as number;
      const state = event.data.state as number;
      if (state === 1 && key === 1) {
        // Escape 键关闭
        return this.hide();
      }
    }

    return false;
  }
}
