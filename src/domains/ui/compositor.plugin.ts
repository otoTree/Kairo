import type { Plugin } from "../../core/plugin";
import type { EventBus } from "../events/types";
import type { RenderCommitEvent, SignalEvent, SurfaceState } from "./types";

export class CompositorPlugin implements Plugin {
  name = "compositor";
  private surfaces: Map<string, SurfaceState> = new Map();
  private eventBus?: EventBus;

  async setup(app: any) {
    this.eventBus = app.events;
    
    // Subscribe to render commits from Agents
    this.eventBus?.subscribe("kairo.agent.render.commit", this.handleRenderCommit.bind(this));

    // Subscribe to UI signals (from Frontend/Shell)
    // In a real Wayland setup, this might come from a different source, but here we treat them as events
    this.eventBus?.subscribe("kairo.ui.signal", this.handleSignal.bind(this));
    
    app.compositor = this;
  }

  private handleRenderCommit(event: any) {
    const payload = event.data as RenderCommitEvent["data"];
    const { surfaceId, tree } = payload;
    
    let surface = this.surfaces.get(surfaceId);
    if (!surface) {
      surface = {
        id: surfaceId,
        agentId: event.source, // Assuming source is the agent ID
        title: "Agent Window", // Default title
        visible: true,
        tree: tree,
      };
      this.surfaces.set(surfaceId, surface);
    } else {
      surface.tree = tree;
      // In a real implementation, we might do diffing here or just replace
    }

    console.log(`[Compositor] Surface ${surfaceId} updated by ${event.source}`);
  }

  private handleSignal(event: any) {
    const payload = event.data as SignalEvent["data"];
    console.log(`[Compositor] Signal received: ${payload.signal} -> ${payload.slot}`);
    
    // The signal is already on the bus, so Agents listening to it will pick it up.
    // We might want to add some validation or routing logic here if needed.
  }

  public getSurface(id: string): SurfaceState | undefined {
    return this.surfaces.get(id);
  }

  public getAllSurfaces(): SurfaceState[] {
    return Array.from(this.surfaces.values());
  }
}
