/**
 * 桌面图标控制器
 *
 * 渲染层：background（与壁纸同层）
 * 在桌面左侧按列排列可点击的应用图标，类似 Windows 桌面快捷方式。
 */

import type { KdpNode } from "../builders/kdp-node";
import type { KdpEvent, WindowController } from "../window-manager";
import {
  BG_ELEVATED,
  BRAND_BLUE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  BITMAP_SCALE,
  SPACING,
  RADIUS,
} from "../tokens";
import { PREINSTALLED_APPS, type AppEntry } from "../apps";

/** 图标尺寸与间距 */
const ICON_SIZE = 64;
const ICON_GAP_V = 16;
const ICON_GAP_H = 16;
const LABEL_HEIGHT = 20;
const CELL_W = ICON_SIZE + ICON_GAP_H;
const CELL_H = ICON_SIZE + LABEL_HEIGHT + ICON_GAP_V;

/** 桌面图标起始偏移 */
const START_X = 24;
const START_Y = 24;

/** 每列最大图标数（根据屏幕高度动态计算） */
const DEFAULT_MAX_ROWS = 6;

export interface DesktopIconsOptions {
  /** 屏幕宽度 */
  width: number;
  /** 屏幕高度（减去任务栏） */
  height: number;
}

/**
 * 桌面图标控制器
 */
export class DesktopIconsController implements WindowController {
  readonly windowType = "desktop-icons";
  private width: number;
  private height: number;
  private apps: AppEntry[];
  /** 应用启动回调 */
  onLaunchApp?: (appId: string) => void;

  constructor(opts: DesktopIconsOptions) {
    this.width = opts.width;
    this.height = opts.height;
    // 排除品牌窗口，只显示用户可启动的应用
    this.apps = PREINSTALLED_APPS.filter(a => a.id !== "brand");
  }

  /** 更新屏幕尺寸 */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  buildTree(): KdpNode {
    const children: KdpNode[] = [];
    // 计算每列最多放几个图标（留出任务栏 36px 空间）
    const maxRows = Math.max(1, Math.floor((this.height - START_Y - 36) / CELL_H));

    for (let i = 0; i < this.apps.length; i++) {
      const app = this.apps[i];
      const col = Math.floor(i / maxRows);
      const row = i % maxRows;
      const x = START_X + col * (CELL_W + ICON_GAP_H);
      const y = START_Y + row * CELL_H;

      // 图标背景（透明，hover 时可提亮）
      children.push({
        type: "rect",
        id: `desktop-icon-${app.id}`,
        x, y,
        width: ICON_SIZE, height: ICON_SIZE,
        color: BG_ELEVATED,
        radius: RADIUS.md,
        action: `launch:${app.id}`,
      });

      // 图标文字符号
      children.push({
        type: "text",
        id: `desktop-icon-symbol-${app.id}`,
        x: x + 16, y: y + 16,
        text: app.icon,
        color: BRAND_BLUE,
        scale: BITMAP_SCALE.display,
      });

      // 应用名称
      children.push({
        type: "text",
        id: `desktop-icon-label-${app.id}`,
        x: x + 4, y: y + ICON_SIZE + 4,
        text: app.name,
        color: TEXT_PRIMARY,
        scale: BITMAP_SCALE.caption,
      });
    }

    return { type: "root", children };
  }

  handleEvent(event: KdpEvent): boolean {
    if (event.type === "user_action") {
      const elementId = event.data.element_id as string;
      const actionType = event.data.action_type as string;

      if (actionType === "click" && elementId?.startsWith("desktop-icon-")) {
        // 从 element id 提取 appId
        const appId = elementId.replace("desktop-icon-", "");
        if (this.apps.some(a => a.id === appId)) {
          console.log(`[DesktopIcons] 启动应用: ${appId}`);
          this.onLaunchApp?.(appId);
          return true;
        }
      }
    }
    return false;
  }
}
