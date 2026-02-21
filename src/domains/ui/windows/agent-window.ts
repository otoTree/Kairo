/**
 * Agent 助手窗口控制器
 *
 * KDP 原生 Agent 聊天界面，包含消息列表和输入框。
 * 支持发送消息并显示 Agent 回复。
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
  ACCENT_TEAL,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  BORDER,
  SEMANTIC_SUCCESS,
  BITMAP_SCALE,
  SPACING,
  RADIUS,
} from "../tokens";

const AGENT_WIDTH = 600;
const AGENT_HEIGHT = 500;

/** 输入区域高度 */
const INPUT_AREA_H = 48;

/** 聊天消息 */
interface ChatMessage {
  role: "user" | "agent";
  text: string;
}

export class AgentWindowController implements WindowController {
  readonly windowType = "agent";
  private messages: ChatMessage[] = [
    { role: "agent", text: "你好！我是 Kairo Agent。" },
    { role: "agent", text: "有什么可以帮助你的吗？" },
  ];
  private scrollOffset = 0;

  buildTree(): KdpNode {
    const c = (color: KdpColor) => [...color] as unknown as KdpColor;
    const frame = buildWindowFrame({
      title: "Kairo Agent",
      width: AGENT_WIDTH,
      height: AGENT_HEIGHT,
      showStatusBar: true,
      statusLeft: "Agent 就绪",
      statusRight: "Kairo v0.1.0",
      showMinMax: true,
    });

    const msgAreaY = frame.contentY;
    const msgAreaH = frame.contentHeight - INPUT_AREA_H;
    const inputY = AGENT_HEIGHT - INPUT_AREA_H - (frame.statusBar.length > 0 ? 28 : 0);

    const children: KdpNode[] = [
      frame.background,
      ...frame.titleBar,
      ...frame.statusBar,

      // 消息区域背景
      {
        type: "rect", id: "msg-area-bg",
        x: 0, y: msgAreaY,
        width: AGENT_WIDTH, height: msgAreaH,
        color: c(BG_BASE),
      },

      // 渲染消息列表
      ...this.buildMessages(msgAreaY, msgAreaH),

      // 输入区域分隔线
      {
        type: "rect", id: "input-divider",
        x: 0, y: inputY,
        width: AGENT_WIDTH, height: 1,
        color: c(BORDER),
      },
      // 输入区域背景
      {
        type: "rect", id: "input-area-bg",
        x: 0, y: inputY + 1,
        width: AGENT_WIDTH, height: INPUT_AREA_H - 1,
        color: c(BG_SURFACE),
      },
      // Agent 状态指示灯
      {
        type: "rect", id: "agent-status-dot",
        x: 12, y: inputY + 18,
        width: 8, height: 8,
        color: c(SEMANTIC_SUCCESS),
        radius: 4,
      },
      // 输入框
      {
        type: "input", id: "chat-input",
        x: 28, y: inputY + 8,
        width: AGENT_WIDTH - 100, height: 28,
        placeholder: "输入消息...",
      },
      // 发送按钮
      {
        type: "rect", id: "btn-send",
        x: AGENT_WIDTH - 64, y: inputY + 8,
        width: 52, height: 28,
        color: c(BRAND_BLUE),
        radius: RADIUS.sm,
        action: "send",
      },
      {
        type: "text", id: "btn-send-text",
        x: AGENT_WIDTH - 52, y: inputY + 14,
        text: "发送",
        color: c(TEXT_PRIMARY),
        scale: BITMAP_SCALE.caption,
      },
    ];

    return { type: "root", children };
  }

  /** 构建消息气泡列表 */
  private buildMessages(areaY: number, areaH: number): KdpNode[] {
    const c = (color: KdpColor) => [...color] as unknown as KdpColor;
    const nodes: KdpNode[] = [];
    let y = areaY + SPACING.md;
    const maxW = AGENT_WIDTH - 2 * SPACING.lg;

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      const isUser = msg.role === "user";
      // 估算文字宽度（8px 位图 × scale 2 × 字符数）
      const textW = Math.min(msg.text.length * 16, maxW - 40);
      const bubbleW = textW + 24;
      const bubbleH = 32;
      const bubbleX = isUser
        ? AGENT_WIDTH - SPACING.lg - bubbleW
        : SPACING.lg;

      // 气泡背景
      nodes.push({
        type: "rect",
        id: `msg-bubble-${i}`,
        x: bubbleX, y,
        width: bubbleW, height: bubbleH,
        color: isUser ? c(BRAND_BLUE) : c(BG_ELEVATED),
        radius: RADIUS.md,
      });

      // 消息文字
      nodes.push({
        type: "text",
        id: `msg-text-${i}`,
        x: bubbleX + 12, y: y + 8,
        text: msg.text,
        color: isUser ? c(TEXT_PRIMARY) : c(ACCENT_TEAL),
        scale: BITMAP_SCALE.body,
      });

      y += bubbleH + SPACING.sm;
    }

    return nodes;
  }

  handleEvent(event: KdpEvent): boolean {
    if (event.type === "user_action") {
      const elementId = event.data.element_id as string;
      const actionType = event.data.action_type as string;

      // 发送按钮点击
      if (elementId === "btn-send" && actionType === "click") {
        return this.sendMessage();
      }

      // 输入框提交（回车）
      if (elementId === "chat-input" && actionType === "submit") {
        const text = (event.data.payload as string)?.trim();
        if (text) {
          this.messages.push({ role: "user", text });
          // 模拟 Agent 回复
          this.messages.push({
            role: "agent",
            text: `收到: "${text}"。我正在处理...`,
          });
          return true;
        }
      }
    }
    return false;
  }

  /** 发送消息（占位实现） */
  private sendMessage(): boolean {
    // 实际实现中会从输入框获取文字并发送到 Agent 运行时
    this.messages.push({ role: "agent", text: "请在输入框中输入消息后按回车发送。" });
    return true;
  }
}
