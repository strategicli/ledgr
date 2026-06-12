// Structured logging + error capture (rule 9: observable and debuggable).
//
// One JSON line per event on stdout/stderr (Vercel's log drain picks these
// up as-is): { ts, level, source, correlationId, message, ...fields }.
// A correlation id is minted per logger (one per request/job) so every line
// of one run greps together; routes echo it in error responses so a user
// report can be matched to its log lines and error_log row.
//
// captureError is the no-silent-failures hook: it logs AND best-effort
// inserts into the error_log table, which /health surfaces. It never
// throws — error capture failing must not turn a logged failure into a
// crash (and when the DB itself is down, the console line still exists).

import { errorLog } from "@/db/schema";
import { getDb } from "@/db";

export function isDebugMode(): boolean {
  return process.env.DEBUG_MODE === "true";
}

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function emit(
  level: Level,
  source: string,
  correlationId: string,
  message: string,
  fields?: Fields
) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    source,
    correlationId,
    message,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export type Logger = {
  correlationId: string;
  info: (message: string, fields?: Fields) => void;
  warn: (message: string, fields?: Fields) => void;
  error: (message: string, fields?: Fields) => void;
};

export function createLogger(
  source: string,
  correlationId: string = crypto.randomUUID()
): Logger {
  return {
    correlationId,
    info: (message, fields) => emit("info", source, correlationId, message, fields),
    warn: (message, fields) => emit("warn", source, correlationId, message, fields),
    error: (message, fields) => emit("error", source, correlationId, message, fields),
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Log an error and record it in error_log. detail lands in the jsonb column
// (stack traces, item lists); /health shows counts always and messages only
// in debug mode. Never throws.
export async function captureError(
  source: string,
  err: unknown,
  opts: { correlationId?: string; message?: string; detail?: unknown } = {}
): Promise<void> {
  const correlationId = opts.correlationId ?? crypto.randomUUID();
  const message = opts.message ?? errorMessage(err);
  emit("error", source, correlationId, message);
  try {
    await getDb()
      .insert(errorLog)
      .values({
        correlationId,
        source,
        message,
        detail:
          opts.detail !== undefined
            ? opts.detail
            : err instanceof Error && err.stack
              ? { stack: err.stack }
              : null,
      });
  } catch (insertErr) {
    // The console line above already exists; say the capture failed too.
    emit("warn", source, correlationId, "error_log insert failed", {
      insertError: errorMessage(insertErr),
    });
  }
}
