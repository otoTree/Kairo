/**
 * 窗口框架构建器
 *
 * 生成所有 Kairo 窗口共享的标题栏 + 控制按钮 + 状态栏 KDP 节点
 */

import type { KdpNode } from "./kdp-node";
import type { KdpColor } from "../tokens";
import {
  BG_BASE,
  BG_SURFACE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  SEMANTIC_ERROR,
  WINDOW,
  BITMAP_SCALE,
} from "../tokens";

export interface WindowFrameOptions {
  /** 窗口标题 */
  title: string;
  /** 窗口宽度 */
  width: number;
  /** 窗口高度 */
  height: number;
  /** 标题栏背景色（默认 BG_SURFACE） */
  titleBarColor?: KdpColor;
  /** 窗口背景色（默认 BG_BASE） */
  backgroundColor?: KdpColor;
  /** 是否显示状态栏 */
  showStatusBar?: boolean;
  /** 状态栏左侧文字 */
  statusLeft?: string;
  /** 状态栏右侧文字 */
  statusRight?: string;
  /** 是否显示最小化/最大化按钮（默认 true） */
  showMinMax?: boolean;
}

/**
 * 构建窗口背景节点
 */
export function buildBackground(opts: WindowFrameOptions): KdpNode {
  return {
    type: "rect",
    id: "bg",
    x: 0,
    y: 0,
    width: opts.width,
    height: opts.height,
    color: opts.backgroundColor ?? [...BG_BASE] as unknown as KdpColor,
  };
}

/**
 * 构建标题栏节点（含标题文字和控制按钮）
 */
export function buildTitleBar(opts: WindowFrameOptions): KdpNode[] {
  const { width, title, showMinMax = true } = opts;
  const barColor = opts.titleBarColor ?? [...BG_SURFACE] as unknown as KdpColor;
  const btnSize = WINDOW.controlButtonSize;
  const btnGap = WINDOW.controlButtonGap;
  const btnTop = WINDOW.controlButtonMarginTop;
  const btnRight = WINDOW.controlButtonMarginRight;

  const nodes: KdpNode[] = [
    // 标题栏背景
    {
      type: "rect",
      id: "titlebar",
      x: 0,
      y: 0,
      width,
      height: WINDOW.titleBarHeight,
      color: barColor,
    },
    // 标题文字
    {
      type: "text",
      id: "title_text",
      x: 12,
      y: 10,
      text: title,
      color: [...TEXT_PRIMARY] as unknown as KdpColor,
      scale: BITMAP_SCALE.body,
    },
  ];

  // 关闭按钮（最右侧）
  const closeX = width - btnRight - btnSize;
  nodes.push(
    {
      type: "rect",
      id: "btn_close",
      x: closeX,
      y: btnTop,
      width: btnSize,
      height: btnSize,
      color: [...TEXT_SECONDARY] as unknown as KdpColor,
      action: "close",
    },
    {
      type: "text",
      id: "btn_close_icon",
      x: closeX + 4,
      y: btnTop + 2,
      text: "x",
      color: [...TEXT_SECONDARY] as unknown as KdpColor,
      scale: BITMAP_SCALE.caption,
    },
  );

  if (showMinMax) {
    // 最大化按钮
    const maxX = closeX - btnSize - btnGap;
    nodes.push({
      type: "rect",
      id: "btn_maximize",
      x: maxX,
      y: btnTop,
      width: btnSize,
      height: btnSize,
      color: [...TEXT_SECONDARY] as unknown as KdpColor,
      action: "maximize",
    });

    // 最小化按钮
    const minX = maxX - btnSize - btnGap;
    nodes.push({
      type: "rect",
      id: "btn_minimize",
      x: minX,
      y: btnTop,
      width: btnSize,
      height: btnSize,
      color: [...TEXT_SECONDARY] as unknown as KdpColor,
      action: "minimize",
    });
  }

  return nodes;
}

/**
 * 构建状态栏节点
 */
export function buildStatusBar(opts: WindowFrameOptions): KdpNode[] {
  if (!opts.showStatusBar) return [];

  const y = opts.height - WINDOW.statusBarHeight;
  const nodes: KdpNode[] = [
    {
      type: "rect",
      id: "statusbar",
      x: 0,
      y,
      width: opts.width,
      height: WINDOW.statusBarHeight,
      color: [...BG_SURFACE] as unknown as KdpColor,
    },
  ];

  if (opts.statusLeft) {
    nodes.push({
      type: "text",
      id: "status_left",
      x: 12,
      y: y + 6,
      text: opts.statusLeft,
      color: [...TEXT_SECONDARY] as unknown as KdpColor,
      scale: BITMAP_SCALE.caption,
    });
  }

  if (opts.statusRight) {
    // 粗略估算右对齐位置（8px 位图字体 × scale 1 × 字符数）
    const textWidth = opts.statusRight.length * 8;
    nodes.push({
      type: "text",
      id: "status_right",
      x: opts.width - textWidth - 12,
      y: y + 6,
      text: opts.statusRight,
      color: [...TEXT_SECONDARY] as unknown as KdpColor,
      scale: BITMAP_SCALE.caption,
    });
  }

  return nodes;
}

/**
 * 构建完整窗口框架（背景 + 标题栏 + 状态栏）
 * 返回节点数组，调用方可在中间插入内容区节点
 */
export function buildWindowFrame(opts: WindowFrameOptions): {
  background: KdpNode;
  titleBar: KdpNode[];
  statusBar: KdpNode[];
  /** 内容区起始 Y 坐标 */
  contentY: number;
  /** 内容区可用高度 */
  contentHeight: number;
} {
  const contentY = WINDOW.titleBarHeight;
  const statusHeight = opts.showStatusBar ? WINDOW.statusBarHeight : 0;
  const contentHeight = opts.height - contentY - statusHeight;

  return {
    background: buildBackground(opts),
    titleBar: buildTitleBar(opts),
    statusBar: buildStatusBar(opts),
    contentY,
    contentHeight,
  };
}
