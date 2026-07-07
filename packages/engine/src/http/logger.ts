import { AsyncLocalStorage } from "node:async_hooks";

const MAX_VALUE_LENGTH = 200;

export interface RequestLogContext {
  readonly request_id: string;
  readonly route: string;
}

const requestContext = new AsyncLocalStorage<RequestLogContext>();

// Runs fn with request_id/route bound so any logger.log() call anywhere in
// the async call tree (including deep engine code) picks them up without
// threading a logger instance through every function signature.
export function runWithRequestContext<T>(
  context: RequestLogContext,
  fn: () => T
): T {
  return requestContext.run(context, fn);
}

// Field allowlist for the structured logger. This is the enforcement point
// that keeps raw story/query text (or anything else unvetted) from riding
// along on a log line: unknown keys are dropped, not passed through.
export const LOG_FIELD_ALLOWLIST: ReadonlySet<string> = new Set([
  "request_id",
  "route",
  "method",
  "status",
  "reason",
  "latency_ms",
  "retry_after_sec",
  "ip_hash",
  "allowed",
  "degraded",
  "dropped_field_count",
  "dropped_why_count",
  "dropped_result_count",
  "unknown_candidate_count"
]);

export interface Logger {
  log(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(
  write: (line: string) => void = (line) => console.log(line)
): Logger {
  return {
    log(event, fields = {}) {
      const context = requestContext.getStore();
      const candidate = { ...context, ...fields };
      const safe: Record<string, unknown> = {};
      let droppedCount = 0;

      for (const [key, value] of Object.entries(candidate)) {
        if (!LOG_FIELD_ALLOWLIST.has(key)) {
          droppedCount += 1;
          continue;
        }

        safe[key] = capValue(value);
      }

      if (droppedCount > 0) {
        safe.dropped_field_count = droppedCount;
      }

      write(
        JSON.stringify({ event, ts: new Date().toISOString(), ...safe })
      );
    }
  };
}

function capValue(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_VALUE_LENGTH) {
    return `${value.slice(0, MAX_VALUE_LENGTH)}...`;
  }

  return value;
}

// Shared default instance for call sites that don't need a custom sink
// (tests inject their own via createLogger).
export const logger: Logger = createLogger();
