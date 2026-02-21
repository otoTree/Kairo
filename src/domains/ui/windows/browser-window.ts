/**
 * Chrome 浏览器窗口控制器
 *
 * KDP 原生浏览器界面，包含地址栏和内容区域。
 * 初始页面显示 Google 搜索风格的简化界面。
 */

import type { KdpNode } from "../builders/kdp-node";
import type { KdpColor } from "../tokens";
import type { KdpEvent, WindowController } from "../window-manager";
import { buildWindowFrame } from "../builders/window";
import {
  BG_BASE,
  BG_SURFACE,
  BG_ELEVATED,
  BRAND_BLUE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  BORDER,
  BITMAP_SCALE,
  SPACING,
  RADIUS,
} from "../tokens";

const BROWSER_WIDTH = 900;
const BROWSER_HEIGHT = 600;

/** 地址栏高度 */
const TOOLBAR_H = 36;

export class BrowserWindowController implements WindowController {
  readonly windowType = "browser";
  private url = "https://www.google.com";
  private pageTitle = "Google";

  buildTree(): KdpNode {
    const c = (color: KdpColor) => [...color] as unknown as KdpColor;
    const frame = buildWindowFrame({
      title: `Chrome - ${this.pageTitle}`,
      width: BROWSER_WIDTH,
      height: BROWSER_HEIGHT,
      showStatusBar: false,
      showMinMax: true,
    });

    const toolbarY = frame.contentY;
    const contentY = toolbarY + TOOLBAR_H;
    const contentH = BROWSER_HEIGHT - contentY;

    // Google 搜索页面居中位置
    const centerX = Math.floor(BROWSER_WIDTH / 2);
    const logoY = contentY + 80;
    const searchY = logoY + 60;

    const children: KdpNode[] = [
      frame.background,
      ...frame.titleBar,

      // 工具栏背景
      {
        type: "rect", id: "toolbar-bg",
        x: 0, y: toolbarY,
        width: BROWSER_WIDTH, height: TOOLBAR_H,
        color: c(BG_SURFACE),
      },
      // 工具栏底部边框
      {
        type: "rect", id: "toolbar-border",
        x: 0, y: toolbarY + TOOLBAR_H - 1,
        width: BROWSER_WIDTH, height: 1,
        color: c(BORDER),
      },
      // 后退按钮
      {
        type: "text", id: "btn-back",
        x: 12, y: toolbarY + 10,
        text: "<",
        color: c(TEXT_SECONDARY),
        scale: BITMAP_SCALE.body,
      },
      // 前进按钮
      {
        type: "text", id: "btn-forward",
        x: 32, y: toolbarY + 10,
        text: ">",
        color: c(TEXT_TERTIARY),
        scale: BITMAP_SCALE.body,
      },
      // 刷新按钮
      {
        type: "text", id: "btn-refresh",
        x: 52, y: toolbarY + 10,
        text: "O",
        color: c(TEXT_SECONDARY),
        scale: BITMAP_SCALE.body,
      },
      // 地址栏
      {
        type: "input", id: "address-bar",
        x: 76, y: toolbarY + 6,
        width: BROWSER_WIDTH - 88, height: 24,
        value: this.url,
        placeholder: "输入网址...",
      },

      // === 内容区域：Google 搜索页面 ===
      // 内容背景
      {
        type: "rect", id: "content-bg",
        x: 0, y: contentY,
        width: BROWSER_WIDTH, height: contentH,
        color: c(BG_BASE),
      },
      // Google Logo
      {
        type: "text", id: "google-logo",
        x: centerX - 80, y: logoY,
        text: "Google",
        color: c(TEXT_PRIMARY),
        scale: BITMAP_SCALE.display,
      },
      // 搜索框
      {
        type: "rect", id: "search-box-bg",
        x: centerX - 240, y: searchY,
        width: 480, height: 36,
        color: c(BG_ELEVATED),
        radius: RADIUS.xl,
        border_width: 1,
        border_color: c(BORDER),
      },
      {
        type: "text", id: "search-icon",
        x: centerX - 224, y: searchY + 10,
        text: "?",
        color: c(TEXT_TERTIARY),
        scale: BITMAP_SCALE.body,
      },
      {
        type: "input", id: "search-input",
        x: centerX - 200, y: searchY + 6,
        width: 400, height: 24,
        placeholder: "Google 搜索或输入网址",
      },

      // 快捷链接
      ...this.buildQuickLinks(centerX, searchY + 60),
    ];

    return { type: "root", children };
  }

  /** 构建快捷链接卡片 */
  private buildQuickLinks(centerX: number, startY: number): KdpNode[] {
    const c = (color: KdpColor) => [...color] as unknown as KdpColor;
    const links = [
      { id: "github", label: "GitHub", icon: "<>" },
      { id: "youtube", label: "YouTube", icon: "|>" },
      { id: "twitter", label: "Twitter", icon: "#" },
      { id: "docs", label: "Docs", icon: "[]" },
    ];
    const cardW = 80;
    const cardH = 72;
    const gap = 16;
    const totalW = links.length * cardW + (links.length - 1) * gap;
    const startX = centerX - Math.floor(totalW / 2);
    const nodes: KdpNode[] = [];

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const x = startX + i * (cardW + gap);
      nodes.push(
        {
          type: "rect", id: `quick-${link.id}`,
          x, y: startY,
          width: cardW, height: cardH,
          color: c(BG_ELEVATED),
          radius: RADIUS.md,
        },
        {
          type: "text", id: `quick-icon-${link.id}`,
          x: x + 24, y: startY + 12,
          text: link.icon,
          color: c(BRAND_BLUE),
          scale: BITMAP_SCALE.title,
        },
        {
          type: "text", id: `quick-label-${link.id}`,
          x: x + 8, y: startY + 52,
          text: link.label,
          color: c(TEXT_SECONDARY),
          scale: BITMAP_SCALE.caption,
        },
      );
    }
    return nodes;
  }

  handleEvent(event: KdpEvent): boolean {
    if (event.type === "user_action") {
      const elementId = event.data.element_id as string;
      const actionType = event.data.action_type as string;

      // 地址栏提交
      if (elementId === "address-bar" && actionType === "submit") {
        this.url = (event.data.payload as string) || this.url;
        this.pageTitle = this.url.replace(/^https?:\/\//, "").split("/")[0];
        return true;
      }
    }
    return false;
  }
}
