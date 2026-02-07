import mitt, { type Emitter } from "mitt";
import type { EventBus, EventHandler, EventFilter, EventStore, KairoEvent } from "./types";

// Helper to generate UUID
function uuid() {
  return crypto.randomUUID();
}

type WildcardSubscription = {
  pattern: string;
  handler: EventHandler;
  regex: RegExp;
};

export class InMemoryGlobalBus implements EventBus {
  private emitter: Emitter<Record<string, KairoEvent>>;
  private wildcardSubscriptions: WildcardSubscription[] = [];
  
  constructor(private store: EventStore) {
    this.emitter = mitt();
    
    // Hook into all events to handle wildcard subscriptions and persistence
    this.emitter.on("*", (type, event) => {
      // 1. Persist to store
      // We don't await here to not block the event loop, but we might want to catch errors
      this.store.append(event).catch(err => {
        console.error("[EventBus] Failed to persist event:", err);
      });

      // 2. Dispatch to wildcard subscribers
      this.dispatchToWildcards(type, event);
    });
  }

  async publish<T>(payload: Omit<KairoEvent<T>, "id" | "time" | "specversion">): Promise<string> {
    // console.log('[EventBus] Publishing:', payload.type);
    const event: KairoEvent<T> = {
      ...payload,
      id: uuid(),
      time: new Date().toISOString(),
      specversion: "1.0",
    };

    // Emit to exact matches
    this.emitter.emit(event.type, event);
    
    // Note: 'mitt' * handler is triggered automatically by emit if we used the correct type definition
    // But mitt's typescript types are a bit tricky with '*'. 
    // If we look at mitt source, `emit` triggers `*` handlers.
    
    return event.id;
  }

  subscribe(pattern: string, handler: EventHandler): () => void {
    if (pattern.includes("*") || pattern.includes(">")) {
      return this.subscribeWildcard(pattern, handler);
    } else {
      this.emitter.on(pattern, handler);
      return () => {
        this.emitter.off(pattern, handler);
      };
    }
  }

  private subscribeWildcard(pattern: string, handler: EventHandler): () => void {
    // Convert pattern to Regex
    // 'agent.*.thought' -> /^agent\.[^.]+\.thought$/
    // 'agent.>' -> /^agent\..+$/
    
    let regexStr = pattern
      .replace(/\./g, "\\.") // Escape dots
      .replace(/\*/g, "[^.]+") // * matches one segment
      .replace(/>/g, ".+"); // > matches rest
      
    const regex = new RegExp(`^${regexStr}$`);
    
    const subscription: WildcardSubscription = { pattern, handler, regex };
    this.wildcardSubscriptions.push(subscription);
    
    return () => {
      this.wildcardSubscriptions = this.wildcardSubscriptions.filter(s => s !== subscription);
    };
  }

  private dispatchToWildcards(type: string, event: KairoEvent) {
    for (const sub of this.wildcardSubscriptions) {
      if (sub.regex.test(type)) {
        try {
          sub.handler(event);
        } catch (e) {
          console.error(`[EventBus] Error in wildcard handler for ${sub.pattern}:`, e);
        }
      }
    }
  }

  async request<T, R>(topic: string, data: T, timeout: number = 5000): Promise<R> {
    const correlationId = uuid();
    
    return new Promise<R>(async (resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Request timeout: ${topic} (id=${correlationId})`));
      }, timeout);

      // Listen for ANY event with matching correlationId
      // We use a wildcard handler on '*' to catch everything
      const responseHandler = (type: string, event: KairoEvent) => {
        if (event.correlationId === correlationId && event.source !== "request-originator") {
          // Found it!
          // Assume the data is R
          cleanup();
          resolve(event.data as R);
        }
      };

      const cleanup = () => {
        this.emitter.off("*", responseHandler);
        clearTimeout(timer);
      };

      this.emitter.on("*", responseHandler);

      try {
        await this.publish({
          type: topic,
          source: "request-originator", // Or passed in?
          data,
          correlationId
        });
      } catch (e) {
        cleanup();
        reject(e);
      }
    });
  }

  async replay(filter: EventFilter): Promise<KairoEvent[]> {
    return this.store.query(filter);
  }
}
