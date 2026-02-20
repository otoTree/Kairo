/**
 * Kairo 品牌窗口
 *
 * 系统启动后的第一个可见界面，包含品牌标识、快速入口和系统状态面板。
 * 生成 KDP JSON UI 树，通过 commit_ui_tree() 提交给 Zig 合成器渲染。
 */

import type { KdpNode } from "../builders/kdp-node";
import type { KdpColor } from "../tokens";
import {
  BG_BASE,
  BG_ELEVATED,
  BRAND_BLUE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  BORDER,
  SEMANTIC_SUCCESS,
  SEMANTIC_WARNING,
  BITMAP_SCALE,
} from "../tokens";

// ============================================================
// 品牌窗口常量
// ============================================================

const BRAND_WIDTH = 480;
const BRAND_HEIGHT = 560;

/** Agent 状态枚举 */
export type AgentStatus = "ready" | "busy" | "offline";

/** 品牌窗口所需的系统状态数据 */
export interface BrandWindowState {
  agentStatus: AgentStatus;
  memoryUsedMB: number;
  memoryTotalMB: number;
  uptimeSeconds: number;
  version: string;
}

// ============================================================
// 辅助函数
// ============================================================

/** 格式化运行时间为 HH:MM:SS */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** 格式化内存为 GB（保留一位小数） */
function formatMemoryGB(mb: number): string {
  return (mb / 1024).toFixed(1);
}

/** Agent 状态对应的显示文字 */
function agentStatusText(status: AgentStatus): string {
  const map: Record<AgentStatus, string> = {
    ready: "就绪",
    busy: "忙碌",
    offline: "离线",
  };
  return map[status];
}

/** Agent 状态对应的指示灯颜色 */
function agentStatusColor(status: AgentStatus): KdpColor {
  const map: Record<AgentStatus, KdpColor> = {
    ready: SEMANTIC_SUCCESS,
    busy: SEMANTIC_WARNING,
    offline: TEXT_TERTIARY,
  };
  return map[status];
}

// ============================================================
// UI 树构建
// ============================================================

/**
 * 构建品牌窗口完整 KDP UI 树
 */
export function buildBrandWindowTree(state: BrandWindowState): KdpNode {
  const c = (color: KdpColor) => [...color] as unknown as KdpColor;

  return {
    type: "root",
    children: [
      // 背景
      {
        type: "rect", id: "bg",
        x: 0, y: 0, width: BRAND_WIDTH, height: BRAND_HEIGHT,
        color: c(BG_BASE),
      },
      // 标题栏（透明，品牌窗口不需要标题栏文字）
      {
        type: "rect", id: "titlebar",
        x: 0, y: 0, width: BRAND_WIDTH, height: 36,
        color: [0.0, 0.0, 0.0, 0.0],
      },
      // 关闭按钮
      {
        type: "rect", id: "btn_close",
        x: 452, y: 10, width: 16, height: 16,
        color: c(TEXT_SECONDARY),
        action: "close",
      },
      // Logo（菱形符号）
      {
        type: "text", id: "logo",
        x: 220, y: 180,
        text: "<>",
        color: c(BRAND_BLUE),
        scale: BITMAP_SCALE.display,
      },
      // 品牌名
      {
        type: "text", id: "brand_name",
        x: 184, y: 228,
        text: "K A I R O",
        color: c(TEXT_PRIMARY),
        scale: BITMAP_SCALE.display,
      },
      // 副标题
      {
        type: "text", id: "subtitle",
        x: 176, y: 268,
        text: "Agent-Native OS",
        color: c(TEXT_SECONDARY),
        scale: BITMAP_SCALE.body,
      },
      // 分隔线
      {
        type: "rect", id: "divider",
        x: 180, y: 300, width: 120, height: 1,
        color: c(BORDER),
      },
      // 终端快速入口卡片
      {
        type: "rect", id: "card_terminal",
        x: 88, y: 324, width: 140, height: 72,
        color: c(BG_ELEVATED),
        action: "launch_terminal",
      },
      {
        type: "text", id: "card_terminal_icon",
        x: 100, y: 340,
        text: ">_",
        color: c(BRAND_BLUE),
        scale: BITMAP_SCALE.body,
      },
      {
        type: "text", id: "card_terminal_label",
        x: 100, y: 368,
        text: "终端",
        color: c(TEXT_PRIMARY),
        scale: BITMAP_SCALE.body,
      },
      // 文件快速入口卡片
      {
        type: "rect", id: "card_files",
        x: 252, y: 324, width: 140, height: 72,
        color: c(BG_ELEVATED),
        action: "launch_files",
      },
      {
        type: "text", id: "card_files_icon",
        x: 264, y: 340,
        text: "[]",
        color: c(BRAND_BLUE),
        scale: BITMAP_SCALE.body,
      },
      {
        type: "text", id: "card_files_label",
        x: 264, y: 368,
        text: "文件",
        color: c(TEXT_PRIMARY),
        scale: BITMAP_SCALE.body,
      },
      // 系统状态面板
      {
        type: "rect", id: "status_panel",
        x: 100, y: 420, width: 280, height: 96,
        color: c(BG_ELEVATED),
      },
      {
        type: "text", id: "status_title",
        x: 112, y: 432,
        text: "系统状态",
        color: c(TEXT_SECONDARY),
        scale: BITMAP_SCALE.caption,
      },
      // Agent 状态（动态）
      {
        type: "text", id: "status_agent",
        x: 112, y: 452,
        text: `Agent: ${agentStatusText(state.agentStatus)}`,
        color: c(TEXT_PRIMARY),
        scale: BITMAP_SCALE.body,
      },
      // 内存状态（动态）
      {
        type: "text", id: "status_memory",
        x: 112, y: 474,
        text: `内存: ${formatMemoryGB(state.memoryUsedMB)} GB / ${formatMemoryGB(state.memoryTotalMB)} GB`,
        color: c(TEXT_PRIMARY),
        scale: BITMAP_SCALE.body,
      },
      // 运行时间（动态）
      {
        type: "text", id: "status_uptime",
        x: 112, y: 496,
        text: `运行时间: ${formatUptime(state.uptimeSeconds)}`,
        color: c(TEXT_PRIMARY),
        scale: BITMAP_SCALE.body,
      },
      // 版本号
      {
        type: "text", id: "version",
        x: 196, y: 536,
        text: state.version,
        color: c(TEXT_TERTIARY),
        scale: BITMAP_SCALE.caption,
      },
    ],
  };
}

/**
 * 默认初始状态
 */
export function getDefaultBrandState(): BrandWindowState {
  return {
    agentStatus: "ready",
    memoryUsedMB: 0,
    memoryTotalMB: 0,
    uptimeSeconds: 0,
    version: "v0.1.0-alpha",
  };
}

// ============================================================
// 品牌窗口控制器
// ============================================================

import os from "node:os";
import type { SystemMonitor } from "../../kernel/system-info";

/** UI 树提交回调 */
export type CommitCallback = (tree: KdpNode) => void;

/**
 * 品牌窗口控制器
 *
 * 管理系统状态采集和 UI 树定时刷新。
 * 每 2 秒从 SystemMonitor 获取最新指标，重建 UI 树并通过回调提交。
 */
export class BrandWindowController {
  private state: BrandWindowState;
  private timer: Timer | null = null;
  private startTime: number;

  constructor(
    private systemMonitor: SystemMonitor,
    private onCommit: CommitCallback,
  ) {
    this.state = getDefaultBrandState();
    this.startTime = Date.now();
  }

  /** 启动定时刷新（每 2 秒） */
  start() {
    // 立即执行一次
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 2000);
  }

  /** 停止定时刷新 */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 更新 Agent 状态 */
  setAgentStatus(status: AgentStatus) {
    this.state.agentStatus = status;
  }

  /** 采集系统状态并重建 UI 树 */
  private async refresh() {
    try {
      const metrics = await this.systemMonitor.getMetrics();
      this.state.memoryUsedMB = metrics.memory.used;
      this.state.memoryTotalMB = metrics.memory.total;
    } catch {
      // 采集失败时保持上次数据
    }

    // 运行时间从控制器启动时开始计算
    this.state.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const tree = buildBrandWindowTree(this.state);
    this.onCommit(tree);
  }
}
