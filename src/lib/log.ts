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

// A query error's message is the whole failed SQL + params (a bulk body can be
// tens of KB), so cap what we store/log. The root reason lives on err.cause
// (the driver's pg error), which we surface separately.
const MAX_MESSAGE = 2000;
function truncate(s: string, max = MAX_MESSAGE): string {
  return s.length > max ? `${s.slice(0, max)}… [+${s.length - max} chars]` : s;
}

// Drizzle wraps the driver error: its message is the query text, while the
// actual Postgres reason (and its `code`) sit on err.cause. Pull both out so
// error_log rows are diagnosable, not just "Failed query: ...".
function errorDetail(err: unknown): Record<string, unknown> | null {
  if (!(err instanceof Error)) return null;
  const out: Record<string, unknown> = {};
  if (err.stack) out.stack = truncate(err.stack, 4000);
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== null) {
    if (cause instanceof Error) {
      const code = (cause as { code?: unknown }).code;
      out.cause = {
        message: truncate(cause.message),
        ...(typeof code === "string" ? { code } : {}),
      };
    } else {
      out.cause = truncate(String(cause));
    }
  }
  return Object.keys(out).length > 0 ? out : null;
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
  const message = truncate(opts.message ?? errorMessage(err));
  emit("error", source, correlationId, message);
  // Keep the caller's detail and fold in the error's cause/stack under _error,
  // so a passed detail (e.g. { index } from a bulk load) no longer drops the
  // underlying Postgres reason.
  const auto = errorDetail(err);
  let detail: unknown;
  if (opts.detail !== undefined) {
    detail =
      auto == null
        ? opts.detail
        : opts.detail && typeof opts.detail === "object" && !Array.isArray(opts.detail)
          ? { ...(opts.detail as Record<string, unknown>), _error: auto }
          : { detail: opts.detail, _error: auto };
  } else {
    detail = auto;
  }
  try {
    await getDb().insert(errorLog).values({
      correlationId,
      source,
      message,
      detail,
    });
  } catch (insertErr) {
    // The console line above already exists; say the capture failed too.
    emit("warn", source, correlationId, "error_log insert failed", {
      insertError: errorMessage(insertErr),
    });
  }
}
