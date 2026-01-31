import type { EventBus, KairoEvent } from "../events";

export type Observation =
  | { type: "user_message"; text: string; ts: number }
  | { type: "system_event"; name: string; payload?: unknown; ts: number }
  | { type: "action_result"; action: any; result: any; ts: number };

export interface ObservationBus {
  publish(obs: Observation): void;
  snapshot(): { observations: Observation[]; ts: number };
  subscribe(listener: () => void): () => void;
}

export class LegacyObservationBusAdapter implements ObservationBus {
  private buffer: Observation[] = [];
  private listeners: (() => void)[] = [];
  private agentId: string = "default"; // Default agent ID

  constructor(private globalBus: EventBus) {
    // Subscribe to legacy events to maintain buffer for snapshot()
    // and notify listeners
    this.globalBus.subscribe("kairo.legacy.*", (event: KairoEvent<Observation>) => {
      this.buffer.push(event.data);
      this.notify();
    });
  }

  publish(obs: Observation) {
    // Map Observation to KairoEvent
    this.globalBus.publish({
      type: `kairo.legacy.${obs.type}`,
      source: `agent:${this.agentId}`,
      data: obs,
    }).catch(err => {
        console.error("[LegacyAdapter] Failed to publish event:", err);
    });
  }

  snapshot() {
    const observations = [...this.buffer];
    this.buffer = []; // Clear buffer after snapshot
    return {
      observations,
      ts: Date.now(),
    };
  }

  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}
