export interface KairoEventMap {
  [key: string]: unknown;
}

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
  // Trace ID (global unique ID for the entire request chain)
  traceId?: string;
  // Span ID (unique ID for the current processing unit)
  spanId?: string;
}

export type EventHandler<T = any> = (event: KairoEvent<T>) => void | Promise<void>;

export interface EventFilter {
  fromTime?: number;
  toTime?: number;
  types?: string[];
  sources?: string[];
  limit?: number;
}

export interface EventBus {
  // Publish an event to the bus
  publish<T>(event: Omit<KairoEvent<T>, "id" | "time" | "specversion">): Promise<string>;

  // Subscribe to a topic pattern (e.g. "agent.*.thought")
  subscribe(pattern: string, handler: EventHandler): () => void;

  // Request/Response pattern (wraps publish + subscribe)
  request<T, R>(topic: string, data: T, timeout?: number): Promise<R>;

  // Replay events from history (for building Agent context)
  replay(filter: EventFilter): Promise<KairoEvent[]>;
}

export interface EventStore {
  append(event: KairoEvent): Promise<void>;
  query(filter: EventFilter): Promise<KairoEvent[]>;
}

/**
 * 取消事件：用于中断正在执行的事件链
 */
export interface CancelEventData {
  targetCorrelationId: string;
  reason?: string;
}

export type CancelEvent = KairoEvent<CancelEventData>;
