import { v4 as uuidv4 } from 'uuid';

export interface KairoEvent<T = unknown> {
  // Unique identifier for the event
  id: string;
  // Standard type URN (e.g. "kairo.agent.thought", "kairo.tool.exec")
  type: string;
  // Event source (e.g. "agent:default", "tool:fs")
  source: string;
  // Data spec version
  specversion: "1.0";
  // Timestamp (ISO 8601)
  time: string;
  // Actual payload data
  data: T;
  // Correlation ID, for Request/Response pattern
  correlationId?: string;
  // Causation ID (ID of the event that caused this one)
  causationId?: string;
}

export type EventHandler<T = any> = (event: KairoEvent<T>) => void | Promise<void>;

export interface EventBus {
  // Publish an event to the bus
  publish<T>(event: Omit<KairoEvent<T>, "id" | "time" | "specversion">): Promise<string>;

  // Dispatch an existing event (e.g. received from network)
  dispatch(event: KairoEvent): Promise<void>;

  // Subscribe to a topic pattern (e.g. "agent.*.thought")
  subscribe(pattern: string, handler: EventHandler): () => void;
}

function matchTopic(pattern: string, topic: string): boolean {
    if (pattern === '>') return true;
    
    const patternParts = pattern.split('.');
    const topicParts = topic.split('.');
  
    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i];
      
      if (p === '>') {
        return true; // > matches the rest
      }
      
      if (i >= topicParts.length) {
        return false; // Pattern is longer than topic
      }
      
      const t = topicParts[i];
      
      if (p !== '*' && p !== t) {
        return false; // Mismatch
      }
    }
    
    // If pattern ended without '>', it must be same length as topic
    return patternParts.length === topicParts.length;
}

export class InMemoryEventBus implements EventBus {
    private subscribers: { pattern: string; handler: EventHandler }[] = [];

    async publish<T>(eventPayload: Omit<KairoEvent<T>, "id" | "time" | "specversion">): Promise<string> {
        const event: KairoEvent<T> = {
            ...eventPayload,
            id: uuidv4(),
            time: new Date().toISOString(),
            specversion: "1.0",
        };
        await this.dispatch(event);
        return event.id;
    }

    async dispatch(event: KairoEvent): Promise<void> {
        const promises = this.subscribers.map(async (sub) => {
            if (matchTopic(sub.pattern, event.type)) {
                try {
                    await sub.handler(event);
                } catch (e) {
                    console.error(`Error in event handler for pattern ${sub.pattern}:`, e);
                }
            }
        });

        await Promise.all(promises);
    }

    subscribe(pattern: string, handler: EventHandler): () => void {
        const subscription = { pattern, handler };
        this.subscribers.push(subscription);
        
        return () => {
            this.subscribers = this.subscribers.filter(s => s !== subscription);
        };
    }
}

// Singleton instance for global usage if needed, though dependency injection/context is better in React
export const globalBus = new InMemoryEventBus();
