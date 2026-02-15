export interface RenderNode {
  type: string; // e.g., "Button", "Row", "Column", "Text", "TextInput"
  id?: string;
  props: Record<string, any>;
  signals?: Record<string, string>; // Signal -> Slot ID
  children?: RenderNode[];
}

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
export type KairoDisplayProtocol = RenderCommitEvent | SignalEvent;
