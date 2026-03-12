import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(defaultMeta: Record<string, unknown>): Logger;
}

// ---------------------------------------------------------------------------
// Level gating
// ---------------------------------------------------------------------------

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function currentThreshold(): number {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return LEVELS[env] ?? LEVELS.info;
}

// ---------------------------------------------------------------------------
// Async context
// ---------------------------------------------------------------------------

interface ContextMeta {
  requestId: string;
  pipeline: string;
}

const asyncContext = new AsyncLocalStorage<ContextMeta>();

// ---------------------------------------------------------------------------
// Core write
// ---------------------------------------------------------------------------

function write(
  level: LogLevel,
  message: string,
  extraMeta: Record<string, unknown>,
): void {
  if (LEVELS[level] < currentThreshold()) return;

  const ctx = asyncContext.getStore();

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(ctx ? { requestId: ctx.requestId, pipeline: ctx.pipeline } : {}),
    ...extraMeta,
  };

  const line = JSON.stringify(entry) + "\n";

  if (level === "warn" || level === "error") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------

function createLogger(defaultMeta: Record<string, unknown> = {}): Logger {
  return {
    debug(message: string, meta?: Record<string, unknown>): void {
      write("debug", message, { ...defaultMeta, ...meta });
    },
    info(message: string, meta?: Record<string, unknown>): void {
      write("info", message, { ...defaultMeta, ...meta });
    },
    warn(message: string, meta?: Record<string, unknown>): void {
      write("warn", message, { ...defaultMeta, ...meta });
    },
    error(message: string, meta?: Record<string, unknown>): void {
      write("error", message, { ...defaultMeta, ...meta });
    },
    child(childMeta: Record<string, unknown>): Logger {
      return createLogger({ ...defaultMeta, ...childMeta });
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const logger: Logger = createLogger();

export function withContext<T>(
  meta: { requestId: string; pipeline: string },
  fn: () => Promise<T>,
): Promise<T> {
  return asyncContext.run(meta, fn);
}
