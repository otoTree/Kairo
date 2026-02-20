/**
 * KDP UI 树节点类型定义
 *
 * 与 Zig 层 UIElement 结构体一一对应，
 * 用于 TypeScript 侧构建 JSON UI 树后通过 commit_ui_tree() 提交
 */

import type { KdpColor } from "../tokens";

/** KDP 原生节点类型 */
export type KdpNodeType = "root" | "rect" | "text" | "scroll" | "image" | "input" | "clip";

/** KDP UI 树节点 */
export interface KdpNode {
  type: KdpNodeType;
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: KdpColor;
  text?: string;
  scale?: number;
  action?: string;
  children?: KdpNode[];
  /** scroll 节点：内容总高度（超出部分可滚动） */
  scroll_height?: number;
  /** scroll 节点：当前滚动偏移 */
  scroll_offset?: number;
  /** image 节点：图片数据路径或 base64 */
  src?: string;
  /** input 节点：占位符文字 */
  placeholder?: string;
  /** input 节点：当前值 */
  value?: string;
  /** input 节点：是否获得焦点 */
  focused?: boolean;
  /** 圆角半径 */
  radius?: number;
  /** 边框宽度 */
  border_width?: number;
  /** 边框颜色 */
  border_color?: KdpColor;
}
