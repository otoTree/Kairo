export interface TraceContext {
  traceId: string;
  spanId: string;
  parentId?: string;
  sampled?: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
  component: string;
  traceId?: string;
  spanId?: string;
  // Additional structured data
  [key: string]: any;
}

export interface Logger {
  debug(msg: string, meta?: object): void;
  info(msg: string, meta?: object): void;
  warn(msg: string, meta?: object): void;
  error(msg: string, error?: Error | unknown, meta?: object): void;
  
  // Create a child logger with additional context (e.g. component name)
  child(meta: object): Logger;
  
  // Create a logger with trace context
  withContext(ctx: TraceContext): Logger;
}

export interface LogFilter {
  fromTime?: number;
  toTime?: number;
  level?: LogLevel;
  component?: string;
  traceId?: string;
  limit?: number;
}
