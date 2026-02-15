import type { Logger, LogEntry, LogLevel, TraceContext } from './types';

// Simple color map for development console output
const COLORS = {
  debug: '\x1b[34m', // Blue
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

export interface LoggerOptions {
  level?: LogLevel;
  format?: 'json' | 'pretty';
  component?: string;
}

export class KairoLogger implements Logger {
  private context: Partial<LogEntry> = {};
  private minLevel: number = 0;
  private format: 'json' | 'pretty';
  private static listeners: ((entry: LogEntry) => void)[] = [];

  public static addListener(listener: (entry: LogEntry) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  private static LEVEL_VALUES: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(options: LoggerOptions = {}, context: Partial<LogEntry> = {}) {
    this.context = { 
      component: options.component || 'App',
      ...context 
    };
    this.minLevel = KairoLogger.LEVEL_VALUES[options.level || 'info'];
    this.format = options.format || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty');
  }

  private shouldLog(level: LogLevel): boolean {
    return KairoLogger.LEVEL_VALUES[level] >= this.minLevel;
  }

  private output(level: LogLevel, msg: string, meta: object = {}, error?: unknown) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      ts: Date.now(),
      level,
      msg,
      component: this.context.component || 'App',
      ...this.context,
      ...meta,
    };

    if (error) {
      const errObj: any = error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        } : { message: String(error) };
      
      (entry as any).error = errObj;
    }

    if (this.format === 'json') {
      console.log(JSON.stringify(entry));
    } else {
      this.prettyPrint(entry);
    }

    KairoLogger.listeners.forEach(l => {
      try {
        l(entry);
      } catch (e) {
        console.error('Error in log listener:', e);
      }
    });
  }

  private prettyPrint(entry: LogEntry) {
    const { ts, level, msg, component, traceId, spanId, ...rest } = entry;
    const error = (rest as any).error;
    if (error) delete (rest as any).error;

    const isoString = new Date(ts).toISOString();
    const timePart = isoString.split('T')[1];
    const time = timePart ? timePart.slice(0, -1) : isoString;
    
    const levelColor = COLORS[level];
    const reset = COLORS.reset;
    const dim = COLORS.dim;

    let traceInfo = '';
    if (traceId) {
      traceInfo = ` ${dim}[${traceId.slice(0, 6)}]${reset}`;
    }

    const componentStr = component ? ` [${component}]` : '';
    
    console.log(
      `${dim}${time}${reset} ${levelColor}${level.toUpperCase().padEnd(5)}${reset}${componentStr}${traceInfo} ${msg}`
    );

    if (Object.keys(rest).length > 0) {
      console.log(`${dim}${JSON.stringify(rest)}${reset}`);
    }

    if (error) {
      console.log(error);
    }
  }

  debug(msg: string, meta?: object) {
    this.output('debug', msg, meta);
  }

  info(msg: string, meta?: object) {
    this.output('info', msg, meta);
  }

  warn(msg: string, meta?: object) {
    this.output('warn', msg, meta);
  }

  error(msg: string, error?: unknown, meta?: object) {
    this.output('error', msg, meta, error);
  }

  child(meta: object): Logger {
    return new KairoLogger(
      { 
        level: Object.keys(KairoLogger.LEVEL_VALUES).find(k => KairoLogger.LEVEL_VALUES[k as LogLevel] === this.minLevel) as LogLevel,
        format: this.format,
      }, 
      { ...this.context, ...meta }
    );
  }

  withContext(ctx: TraceContext): Logger {
    return this.child({
      traceId: ctx.traceId,
      spanId: ctx.spanId,
    });
  }
}

// Global default logger
export const rootLogger = new KairoLogger({ 
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  component: 'Root'
});
