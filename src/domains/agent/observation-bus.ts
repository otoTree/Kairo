export type Observation =
  | { type: "user_message"; text: string; ts: number }
  | { type: "system_event"; name: string; payload?: unknown; ts: number }
  | { type: "action_result"; action: any; result: any; ts: number };

export interface ObservationBus {
  publish(obs: Observation): void;
  snapshot(): { observations: Observation[]; ts: number };
  subscribe(listener: () => void): () => void;
}

export class InMemoryObservationBus implements ObservationBus {
  private buffer: Observation[] = [];
  private listeners: (() => void)[] = [];

  publish(obs: Observation) {
    this.buffer.push(obs);
    this.notify();
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
