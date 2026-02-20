/**
 * Kairo 终端窗口
 *
 * 通过 KDP 协议渲染的终端模拟器 UI。
 * 将 shell 输出转换为 KDP UI 树节点，支持 ANSI 颜色解析和增量更新。
 */

import type { KdpNode } from "../builders/kdp-node";
import type { KdpColor } from "../tokens";
import {
  BG_BASE,
  BG_SURFACE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  BRAND_BLUE,
  SEMANTIC_SUCCESS,
  ACCENT_TEAL,
  BITMAP_SCALE,
  WINDOW,
  TERM_COLORS,
} from "../tokens";

// ============================================================
// 终端窗口常量
// ============================================================

const TERM_WIDTH = 800;
const TERM_HEIGHT = 500;
const TAB_BAR_HEIGHT = 28;
const CONTENT_Y = WINDOW.titleBarHeight + TAB_BAR_HEIGHT;
const CONTENT_HEIGHT = TERM_HEIGHT - CONTENT_Y - WINDOW.statusBarHeight;

/** 位图字体参数：8px 宽 × scale */
const CHAR_WIDTH = 8 * BITMAP_SCALE.mono;  // 16px
const LINE_HEIGHT = 18;
const CONTENT_PADDING_X = 12;
const CONTENT_PADDING_Y = 8;

/** 可见行数 */
const VISIBLE_LINES = Math.floor(
  (CONTENT_HEIGHT - 2 * CONTENT_PADDING_Y) / LINE_HEIGHT,
);

// ============================================================
// ANSI 颜色映射
// ============================================================

/** 标准 16 色 ANSI → KDP RGBA 映射 */
const ANSI_COLOR_MAP: KdpColor[] = [
  TERM_COLORS.black,
  TERM_COLORS.red,
  TERM_COLORS.green,
  TERM_COLORS.yellow,
  TERM_COLORS.blue,
  TERM_COLORS.magenta,
  TERM_COLORS.cyan,
  TERM_COLORS.white,
  TERM_COLORS.brightBlack,
  TERM_COLORS.brightRed,
  TERM_COLORS.brightGreen,
  TERM_COLORS.brightYellow,
  TERM_COLORS.brightBlue,
  TERM_COLORS.brightMagenta,
  TERM_COLORS.brightCyan,
  TERM_COLORS.brightWhite,
];

/** 文本片段（带颜色属性） */
interface TextSpan {
  text: string;
  fg: KdpColor;
}

/** 终端行 */
interface TermLine {
  spans: TextSpan[];
  dirty: boolean;
}

// ============================================================
// ANSI 解析器（简化版，支持 SGR 颜色）
// ============================================================

/**
 * 解析包含 ANSI 转义序列的文本，返回带颜色的文本片段
 */
function parseAnsiLine(raw: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let currentFg: KdpColor = [...TERM_COLORS.foreground] as unknown as KdpColor;
  let pos = 0;
  let buffer = "";

  while (pos < raw.length) {
    // 检测 ESC[
    if (raw[pos] === "\x1b" && raw[pos + 1] === "[") {
      // 先保存当前缓冲区
      if (buffer) {
        spans.push({ text: buffer, fg: currentFg });
        buffer = "";
      }
      // 解析 SGR 参数
      pos += 2;
      let params = "";
      while (pos < raw.length && raw[pos] !== "m") {
        params += raw[pos];
        pos++;
      }
      pos++; // 跳过 'm'

      // 处理 SGR 参数
      const codes = params.split(";").map(Number);
      for (const code of codes) {
        if (code === 0) {
          currentFg = [...TERM_COLORS.foreground] as unknown as KdpColor;
        } else if (code >= 30 && code <= 37) {
          currentFg = [...ANSI_COLOR_MAP[code - 30]] as unknown as KdpColor;
        } else if (code >= 90 && code <= 97) {
          currentFg = [...ANSI_COLOR_MAP[code - 90 + 8]] as unknown as KdpColor;
        }
      }
    } else {
      buffer += raw[pos];
      pos++;
    }
  }

  if (buffer) {
    spans.push({ text: buffer, fg: currentFg });
  }

  return spans.length > 0 ? spans : [{ text: "", fg: [...TERM_COLORS.foreground] as unknown as KdpColor }];
}

// ============================================================
// 终端状态
// ============================================================

export interface TerminalTab {
  id: string;
  label: string;
  shellType: string;
}

export interface TerminalState {
  /** 所有行（含滚动缓冲区） */
  lines: TermLine[];
  /** 当前滚动偏移（0 = 最底部） */
  scrollOffset: number;
  /** 光标列位置 */
  cursorCol: number;
  /** 光标行位置（相对于 lines 数组） */
  cursorRow: number;
  /** 光标是否可见（闪烁状态） */
  cursorVisible: boolean;
  /** 标签页列表 */
  tabs: TerminalTab[];
  /** 当前活跃标签索引 */
  activeTab: number;
  /** 是否已连接 */
  connected: boolean;
  /** 当前工作目录 */
  cwd: string;
  /** 编码 */
  encoding: string;
}

// ============================================================
// UI 树构建
// ============================================================

/**
 * 构建终端窗口完整 KDP UI 树
 */
export function buildTerminalWindowTree(state: TerminalState): KdpNode {
  const c = (color: KdpColor) => [...color] as unknown as KdpColor;
  const children: KdpNode[] = [];

  // 背景
  children.push({
    type: "rect", id: "bg",
    x: 0, y: 0, width: TERM_WIDTH, height: TERM_HEIGHT,
    color: c(BG_BASE),
  });

  // 标题栏
  children.push({
    type: "rect", id: "titlebar",
    x: 0, y: 0, width: TERM_WIDTH, height: WINDOW.titleBarHeight,
    color: c(BG_SURFACE),
  });

  // 连接指示灯
  children.push({
    type: "rect", id: "indicator",
    x: 12, y: 14, width: 8, height: 8,
    color: c(state.connected ? SEMANTIC_SUCCESS : TEXT_SECONDARY),
  });

  // 标题文字
  const activeTab = state.tabs[state.activeTab];
  children.push({
    type: "text", id: "title",
    x: 28, y: 10,
    text: `kairo-terminal: ${state.cwd}`,
    color: c(TEXT_PRIMARY),
    scale: BITMAP_SCALE.body,
  });

  // 关闭按钮
  children.push({
    type: "rect", id: "btn_close",
    x: TERM_WIDTH - 28, y: 10, width: 16, height: 16,
    color: c(TEXT_SECONDARY),
    action: "close",
  });

  // 标签栏
  children.push({
    type: "rect", id: "tab_bar",
    x: 0, y: WINDOW.titleBarHeight, width: TERM_WIDTH, height: TAB_BAR_HEIGHT,
    color: [0.086, 0.086, 0.118, 0.9],
  });

  // 标签项
  let tabX = 12;
  for (let i = 0; i < state.tabs.length; i++) {
    const tab = state.tabs[i];
    const isActive = i === state.activeTab;

    children.push({
      type: "text", id: `tab_${i}`,
      x: tabX, y: WINDOW.titleBarHeight + 6,
      text: tab.label,
      color: c(isActive ? TEXT_PRIMARY : TEXT_SECONDARY),
      scale: BITMAP_SCALE.body,
      action: `switch_tab_${i}`,
    });

    if (isActive) {
      const labelWidth = tab.label.length * CHAR_WIDTH;
      children.push({
        type: "rect", id: `tab_indicator_${i}`,
        x: tabX, y: WINDOW.titleBarHeight + TAB_BAR_HEIGHT - 2,
        width: labelWidth, height: 2,
        color: c(BRAND_BLUE),
      });
    }

    tabX += tab.label.length * CHAR_WIDTH + 16;
  }

  // 内容区背景
  children.push({
    type: "rect", id: "content_area",
    x: 0, y: CONTENT_Y, width: TERM_WIDTH, height: CONTENT_HEIGHT,
    color: c(BG_BASE),
  });

  // 渲染可见行
  const totalLines = state.lines.length;
  const startLine = Math.max(0, totalLines - VISIBLE_LINES - state.scrollOffset);
  const endLine = Math.min(totalLines, startLine + VISIBLE_LINES);

  for (let i = startLine; i < endLine; i++) {
    const line = state.lines[i];
    const lineY = CONTENT_Y + CONTENT_PADDING_Y + (i - startLine) * LINE_HEIGHT;
    let charX = CONTENT_PADDING_X;

    for (let s = 0; s < line.spans.length; s++) {
      const span = line.spans[s];
      if (!span.text) continue;

      children.push({
        type: "text", id: `line_${i}_span_${s}`,
        x: charX, y: lineY,
        text: span.text,
        color: span.fg,
        scale: BITMAP_SCALE.mono,
      });

      charX += span.text.length * CHAR_WIDTH;
    }
  }

  // 光标
  if (state.cursorVisible) {
    const cursorLineIndex = state.cursorRow - startLine;
    if (cursorLineIndex >= 0 && cursorLineIndex < VISIBLE_LINES) {
      children.push({
        type: "rect", id: "cursor",
        x: CONTENT_PADDING_X + state.cursorCol * CHAR_WIDTH,
        y: CONTENT_Y + CONTENT_PADDING_Y + cursorLineIndex * LINE_HEIGHT,
        width: 2, height: LINE_HEIGHT - 2,
        color: c(BRAND_BLUE),
      });
    }
  }

  // 状态栏
  const statusY = TERM_HEIGHT - WINDOW.statusBarHeight;
  children.push({
    type: "rect", id: "statusbar",
    x: 0, y: statusY, width: TERM_WIDTH, height: WINDOW.statusBarHeight,
    color: c(BG_SURFACE),
  });

  children.push({
    type: "text", id: "status_shell",
    x: 12, y: statusY + 6,
    text: `${activeTab?.shellType ?? "zsh"}  ${state.encoding}  LF`,
    color: c(TEXT_SECONDARY),
    scale: BITMAP_SCALE.caption,
  });

  const posText = `Ln ${state.cursorRow + 1}, Col ${state.cursorCol + 1}`;
  children.push({
    type: "text", id: "status_pos",
    x: TERM_WIDTH - posText.length * 8 - 12,
    y: statusY + 6,
    text: posText,
    color: c(TEXT_SECONDARY),
    scale: BITMAP_SCALE.caption,
  });

  return { type: "root", children };
}

// ============================================================
// 终端窗口控制器
// ============================================================

/** UI 树提交回调 */
export type CommitCallback = (tree: KdpNode) => void;

/**
 * 终端窗口控制器
 *
 * 管理终端状态、处理输出数据、控制光标闪烁和更新频率。
 */
export class TerminalWindowController {
  private state: TerminalState;
  private cursorTimer: Timer | null = null;
  private pendingUpdate = false;
  private updateTimer: Timer | null = null;
  private lastUpdateTime = 0;

  constructor(private onCommit: CommitCallback) {
    this.state = {
      lines: [{ spans: [{ text: "", fg: [...TERM_COLORS.foreground] as unknown as KdpColor }], dirty: true }],
      scrollOffset: 0,
      cursorCol: 0,
      cursorRow: 0,
      cursorVisible: true,
      tabs: [{ id: "default", label: "Shell", shellType: "zsh" }],
      activeTab: 0,
      connected: true,
      cwd: "~",
      encoding: "UTF-8",
    };
  }

  /** 启动光标闪烁定时器 */
  start() {
    this.cursorTimer = setInterval(() => {
      this.state.cursorVisible = !this.state.cursorVisible;
      this.scheduleUpdate();
    }, 800);
    this.commit();
  }

  /** 停止所有定时器 */
  stop() {
    if (this.cursorTimer) clearInterval(this.cursorTimer);
    if (this.updateTimer) clearTimeout(this.updateTimer);
  }

  /**
   * 接收 shell 输出数据
   * 解析 ANSI 转义序列并追加到终端缓冲区
   */
  appendOutput(data: string) {
    const rawLines = data.split("\n");

    for (let i = 0; i < rawLines.length; i++) {
      const parsed = parseAnsiLine(rawLines[i]);

      if (i === 0 && this.state.lines.length > 0) {
        // 追加到当前行
        const lastLine = this.state.lines[this.state.lines.length - 1];
        lastLine.spans.push(...parsed);
        lastLine.dirty = true;
      } else {
        // 新行
        this.state.lines.push({ spans: parsed, dirty: true });
      }
    }

    // 更新光标位置
    this.state.cursorRow = this.state.lines.length - 1;
    const lastLine = this.state.lines[this.state.cursorRow];
    this.state.cursorCol = lastLine.spans.reduce((acc, s) => acc + s.text.length, 0);

    // 限制滚动缓冲区（最多 10000 行）
    if (this.state.lines.length > 10000) {
      this.state.lines.splice(0, this.state.lines.length - 10000);
      this.state.cursorRow = this.state.lines.length - 1;
    }

    this.scheduleUpdate();
  }

  /** 处理键盘输入（返回需要发送给 PTY 的数据） */
  handleKeyInput(key: string): string | null {
    // 重置光标闪烁
    this.state.cursorVisible = true;
    return key;
  }

  /** 更新频率控制：合并 16ms 内的更新，高频时降级到 50ms */
  private scheduleUpdate() {
    if (this.pendingUpdate) return;
    this.pendingUpdate = true;

    const now = Date.now();
    const elapsed = now - this.lastUpdateTime;
    // 高频输出时降级到 50ms
    const delay = elapsed < 50 ? 50 : 16;

    this.updateTimer = setTimeout(() => {
      this.pendingUpdate = false;
      this.lastUpdateTime = Date.now();
      this.commit();
    }, delay);
  }

  private commit() {
    const tree = buildTerminalWindowTree(this.state);
    this.onCommit(tree);

    // 清除脏标记
    for (const line of this.state.lines) {
      line.dirty = false;
    }
  }
}

/**
 * 创建默认终端状态
 */
export function getDefaultTerminalState(): TerminalState {
  return {
    lines: [{
      spans: [{
        text: "kairo@agent:~$ ",
        fg: [...ACCENT_TEAL] as unknown as KdpColor,
      }],
      dirty: true,
    }],
    scrollOffset: 0,
    cursorCol: 15,
    cursorRow: 0,
    cursorVisible: true,
    tabs: [{ id: "default", label: "Shell", shellType: "zsh" }],
    activeTab: 0,
    connected: true,
    cwd: "~",
    encoding: "UTF-8",
  };
}
