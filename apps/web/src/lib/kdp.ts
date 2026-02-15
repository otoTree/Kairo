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

export interface SurfaceState {
  id: string;
  tree?: RenderNode;
  visible: boolean;
  geometry: { x: number; y: number; width: number; height: number };
}
