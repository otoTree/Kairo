export interface RenderNode {
  type: ComponentType;
  id?: string;
  props: Record<string, any>;
  signals?: Record<string, string>; // Signal -> Slot ID
  children?: RenderNode[];
}

/**
 * 支持的 UI 组件类型
 * - 容器：Column, Row, List, Modal
 * - 基础：Text, Button, TextInput, Image, Chart
 */
export type ComponentType =
  | 'Column'
  | 'Row'
  | 'Text'
  | 'Button'
  | 'TextInput'
  | 'List'
  | 'Image'
  | 'Chart'
  | 'Modal'
  | string; // 允许自定义扩展

export interface RenderCommitEvent {
  type: "kairo.agent.render.commit";
  data: {
    surfaceId: string;
    tree: RenderNode;
  };
}

export interface SignalEvent {
  type: "kairo.ui.signal";
  source: "user";
  data: {
    surfaceId: string;
    signal: string; // e.g., "clicked", "textChanged"
    slot: string;   // e.g., "deploy_service"
    args: any[];
  };
}

/**
 * KDP user_action 事件 — 从 Wayland 合成器回传的用户交互
 */
export interface UserActionEvent {
  type: "kairo.ui.user_action";
  source: "kdp";
  data: {
    surfaceId: string;
    elementId: string;
    actionType: "click" | "submit" | "hover";
    payload: Record<string, any>;
  };
}

export interface SurfaceState {
  id: string;
  agentId: string;
  title: string;
  visible: boolean;
  tree?: RenderNode;
  geometry?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Protocol Definition for communication with Compositor
export type KairoDisplayProtocol = RenderCommitEvent | SignalEvent | UserActionEvent;
