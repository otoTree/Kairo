/**
 * 文本节点构建器
 *
 * 按字号层级（display/title/heading/body/caption/mono）快速生成 KDP text 节点，
 * 自动映射 BITMAP_SCALE 和默认颜色。
 */

import type { KdpNode } from "./kdp-node";
import type { KdpColor } from "../tokens";
import {
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  BITMAP_SCALE,
  FONT,
} from "../tokens";

/** 排版层级名称 */
export type TypographyLevel = keyof typeof FONT;

export interface TextNodeOptions {
  /** 节点 ID */
  id: string;
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
  /** 文本内容 */
  text: string;
  /** 文字颜色（默认 TEXT_PRIMARY） */
  color?: KdpColor;
  /** 点击 action */
  action?: string;
}

/** 颜色克隆辅助 */
const c = (color: KdpColor) => [...color] as unknown as KdpColor;

/**
 * 按排版层级创建文本节点
 */
export function buildText(level: TypographyLevel, opts: TextNodeOptions): KdpNode {
  return {
    type: "text",
    id: opts.id,
    x: opts.x,
    y: opts.y,
    text: opts.text,
    color: c(opts.color ?? TEXT_PRIMARY),
    scale: BITMAP_SCALE[level],
    ...(opts.action ? { action: opts.action } : {}),
  };
}

/** 快捷：主要文字（body 层级） */
export const textBody = (opts: TextNodeOptions) => buildText("body", opts);

/** 快捷：次要文字（caption 层级，默认 TEXT_SECONDARY） */
export const textCaption = (opts: TextNodeOptions) =>
  buildText("caption", { ...opts, color: opts.color ?? TEXT_SECONDARY });

/** 快捷：标题文字（title 层级） */
export const textTitle = (opts: TextNodeOptions) => buildText("title", opts);

/** 快捷：大标题（display 层级） */
export const textDisplay = (opts: TextNodeOptions) => buildText("display", opts);

/** 快捷：等宽文字（mono 层级） */
export const textMono = (opts: TextNodeOptions) => buildText("mono", opts);

/**
 * 估算文本渲染宽度（8px 位图字体 × scale）
 * 用于右对齐等布局计算
 */
export function measureText(text: string, level: TypographyLevel): number {
  return text.length * 8 * BITMAP_SCALE[level];
}

/**
 * 计算右对齐 X 坐标
 */
export function rightAlignX(text: string, level: TypographyLevel, containerRight: number, paddingRight = 12): number {
  return containerRight - measureText(text, level) - paddingRight;
}
