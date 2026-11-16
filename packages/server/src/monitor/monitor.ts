import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * In-process monitoring: request ids, JSON request logs, error capture with
 * optional forwarding (Sentry or a webhook), and counters for /metrics.
 * Everything here avoids request bodies, query strings, headers and tokens.
 */

export type RequestLogMode = "json" | "pretty" | "off";

export interface RecentError {
  at: string;
  name: string;
  message: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  source: "request" | "worker";
}

export interface MonitorOptions {
  env: Record<string, string | undefined>;
  appName: () => string;
  version: string;
  commit: string | null;
  /** Override for tests. */
  fetch?: typeof fetch;
  /** Override for tests. */
  log?: (line: string) => void;
}

export interface Monitor {
  readonly startedAt: Date;
  readonly version: string;
  readonly commit: string | null;
  readonly logMode: RequestLogMode;
  readonly errorForwarding: { sentry: boolean; webhook: boolean };
  readonly errorsTotal: number;
  /** True when METRICS_TOKEN is set, so /metrics is served. */
  readonly metricsEnabled: boolean;
  /** Checks an Authorization header against METRICS_TOKEN in constant time. */
  authorizeMetrics(header: string | undefined): boolean;
  recentErrors(): RecentError[];
  middleware(): MiddlewareHandler;
  captureError(error: unknown, info?: Partial<Omit<RecentError, "at" | "name" | "message">>): RecentError;
  metricsText(extra: string[]): string;
  /** Waits for in-flight error forwarding (tests and shutdown). */
  flush(): Promise<void>;
}

const RECENT_LIMIT = 50;
const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const QUIET_PATHS = new Set(["/health", "/healthz", "/ready", "/metrics"]);

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

export function resolveCommit(env: Record<string, string | undefined>): string | null {
  const value =
    env.BAKORIN_COMMIT ?? env.RAILWAY_GIT_COMMIT_SHA ?? env.GIT_COMMIT ?? env.SOURCE_COMMIT ?? env.RENDER_GIT_COMMIT;
  return value ? value.trim().slice(0, 40) : null;
}

export function requestLogMode(env: Record<string, string | undefined>): RequestLogMode {
  const raw = (env.BAKORIN_REQUEST_LOG ?? "").trim().toLowerCase();
  if (raw === "json" || raw === "pretty" || raw === "off") {
    return raw;
  }
  if (raw === "1" || raw === "true" || raw === "on") {
    return "json";
  }
  if (raw === "0" || raw === "false") {
    return "off";
  }
  const production = env.NODE_ENV === "production" || env.BAKORIN_ENV === "production";
  return production ? "json" : "off";
}

/** Removes things that look like emails, bearer tokens, JWTs and long secrets from a message. */
export function scrubMessage(message: string): string {
  return message
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]")
    .replace(/\b[A-Za-z0-9+/_-]{40,}\b/g, "[redacted]")
    .replace(/:\/\/([^:/\s]+):([^@/\s]+)@/g, "://$1:[redacted]@")
    .slice(0, 500);
}

interface SentryTarget {
  url: string;
  auth: string;
}

export function parseSentryDsn(dsn: string, version: string): SentryTarget | null {
  try {
    const url = new URL(dsn);
    const key = url.username;
    const parts = url.pathname.replace(/^\/+/, "").split("/");
    const project = parts.pop();
    if (!key || !project) {
      return null;
    }
    const base = parts.length ? `/${parts.join("/")}` : "";
    return {
      url: `${url.protocol}//${url.host}${base}/api/${project}/envelope/`,
      auth: `Sentry sentry_version=7, sentry_key=${key}, sentry_client=bakorin/${version}`,
    };
  } catch {
    return null;
  }
}

export function createMonitor(options: MonitorOptions): Monitor {
  const startedAt = new Date();
  const logMode = requestLogMode(options.env);
  const doFetch = options.fetch ?? fetch;
  const log = options.log ?? ((line: string) => console.log(line));
  const sentry = options.env.SENTRY_DSN ? parseSentryDsn(options.env.SENTRY_DSN, options.version) : null;
  if (options.env.SENTRY_DSN && !sentry) {
    console.warn("[bakorin] SENTRY_DSN is set but not a valid DSN; error forwarding to Sentry is off");
  }
  const errorWebhook = options.env.ERROR_WEBHOOK_URL?.trim() || null;
  const environment = options.env.BAKORIN_ENV ?? options.env.NODE_ENV ?? "development";
  const metricsToken = options.env.METRICS_TOKEN?.trim() || null;
  const recent: RecentError[] = [];
  const requestCounts = new Map<string, number>();
  const bucketCounts = new Array<number>(BUCKETS.length).fill(0);
  let durationSum = 0;
  let durationCount = 0;
  let errorsTotal = 0;
  const inFlight = new Set<Promise<unknown>>();

  function track(promise: Promise<unknown>): void {
    const wrapped = promise.catch(() => undefined).finally(() => inFlight.delete(wrapped));
    inFlight.add(wrapped);
  }

  function post(url: string, body: string, headers: Record<string, string>): Promise<unknown> {
    return doFetch(url, { method: "POST", body, headers, signal: AbortSignal.timeout(5000) });
  }

  function forward(entry: RecentError, stack: string | undefined): void {
    if (sentry) {
      const eventId = crypto.randomUUID().replaceAll("-", "");
      const event = {
        event_id: eventId,
        timestamp: entry.at,
        platform: "javascript",
        level: "error",
        logger: "bakorin",
        release: options.commit ? `${options.version}+${options.commit.slice(0, 12)}` : options.version,
        environment,
        server_name: options.appName(),
        tags: {
          ...(entry.requestId ? { request_id: entry.requestId } : {}),
          ...(entry.method ? { method: entry.method } : {}),
          ...(entry.status ? { status: String(entry.status) } : {}),
          source: entry.source,
        },
        ...(entry.path ? { transaction: `${entry.method ?? ""} ${entry.path}`.trim() } : {}),
        exception: {
          values: [{ type: entry.name, value: entry.message, ...(stack ? { stacktrace: { frames: stackFrames(stack) } } : {}) }],
        },
      };
      const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
      track(post(sentry.url, body, { "content-type": "application/x-sentry-envelope", "x-sentry-auth": sentry.auth }));
    }
    if (errorWebhook) {
      track(
        post(
          errorWebhook,
          JSON.stringify({
            type: "bakorin.error",
            app: options.appName(),
            version: options.version,
            commit: options.commit,
            environment,
            ...entry,
          }),
          { "content-type": "application/json" },
        ),
      );
    }
  }

  const monitor: Monitor = {
    startedAt,
    version: options.version,
    commit: options.commit,
    logMode,
    errorForwarding: { sentry: Boolean(sentry), webhook: Boolean(errorWebhook) },
    get errorsTotal() {
      return errorsTotal;
    },
    metricsEnabled: Boolean(metricsToken),
    authorizeMetrics(header) {
      if (!metricsToken || !header?.startsWith("Bearer ")) {
        return false;
      }
      const given = Buffer.from(header.slice(7).trim());
      const expected = Buffer.from(metricsToken);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
    recentErrors() {
      return [...recent].reverse();
    },
    captureError(error, info = {}) {
      const name = error instanceof Error ? error.name : "Error";
      const message = scrubMessage(error instanceof Error ? error.message : String(error));
      const entry: RecentError = { at: new Date().toISOString(), name, message, source: info.source ?? "request", ...info };
      recent.push(entry);
      if (recent.length > RECENT_LIMIT) {
        recent.shift();
      }
      errorsTotal += 1;
      forward(entry, error instanceof Error ? error.stack : undefined);
      return entry;
    },
    middleware() {
      return async (c, next) => {
        const incoming = c.req.header("x-request-id");
        const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
        c.set("requestId", requestId);
        const started = performance.now();
        try {
          await next();
        } finally {
          const durationMs = performance.now() - started;
          const status = c.res?.status ?? 500;
          c.res?.headers.set("X-Request-Id", requestId);
          const method = c.req.method;
          const key = `${method} ${status}`;
          requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
          const seconds = durationMs / 1000;
          durationSum += seconds;
          durationCount += 1;
          for (let i = 0; i < BUCKETS.length; i += 1) {
            if (seconds <= BUCKETS[i]!) {
              bucketCounts[i]! += 1;
            }
          }
          const path = new URL(c.req.url).pathname;
          if (logMode !== "off" && (!QUIET_PATHS.has(path) || status >= 500)) {
            const userId = c.get("actor")?.id ?? null;
            const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
            if (logMode === "json") {
              log(
                JSON.stringify({
                  ts: new Date().toISOString(),
                  level,
                  msg: "request",
                  requestId,
                  method,
                  path,
                  status,
                  durationMs: Math.round(durationMs * 10) / 10,
                  userId,
                }),
              );
            } else {
              log(`${method} ${path} ${status} ${durationMs.toFixed(1)}ms${userId ? ` user=${userId}` : ""} id=${requestId}`);
            }
          }
        }
      };
    },
    metricsText(extra) {
      const lines: string[] = [];
      lines.push("# HELP bakorin_up 1 when the server is running.", "# TYPE bakorin_up gauge", "bakorin_up 1");
      lines.push(
        "# HELP bakorin_info Build information.",
        "# TYPE bakorin_info gauge",
        `bakorin_info{version="${label(options.version)}",commit="${label(options.commit ?? "")}"} 1`,
      );
      lines.push(
        "# HELP bakorin_uptime_seconds Seconds since the server started.",
        "# TYPE bakorin_uptime_seconds gauge",
        `bakorin_uptime_seconds ${Math.round((Date.now() - startedAt.getTime()) / 1000)}`,
      );
      lines.push("# HELP bakorin_http_requests_total HTTP requests by method and status.", "# TYPE bakorin_http_requests_total counter");
      for (const [key, count] of [...requestCounts.entries()].sort()) {
        const [method, status] = key.split(" ");
        lines.push(`bakorin_http_requests_total{method="${label(method ?? "")}",status="${label(status ?? "")}"} ${count}`);
      }
      lines.push(
        "# HELP bakorin_http_request_duration_seconds Request duration.",
        "# TYPE bakorin_http_request_duration_seconds histogram",
      );
      BUCKETS.forEach((bucket, index) => {
        lines.push(`bakorin_http_request_duration_seconds_bucket{le="${bucket}"} ${bucketCounts[index]}`);
      });
      lines.push(`bakorin_http_request_duration_seconds_bucket{le="+Inf"} ${durationCount}`);
      lines.push(`bakorin_http_request_duration_seconds_sum ${durationSum.toFixed(6)}`);
      lines.push(`bakorin_http_request_duration_seconds_count ${durationCount}`);
      lines.push(
        "# HELP bakorin_errors_total Unhandled errors captured since start.",
        "# TYPE bakorin_errors_total counter",
        `bakorin_errors_total ${errorsTotal}`,
      );
      lines.push(...extra);
      return `${lines.join("\n")}\n`;
    },
    async flush() {
      await Promise.all([...inFlight]);
    },
  };
  return monitor;
}

function label(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ");
}

function stackFrames(stack: string): Array<{ function?: string; filename?: string; lineno?: number; colno?: number }> {
  const frames = stack
    .split("\n")
    .slice(1)
    .map((line) => /at (?:(.+?) )?\(?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({
      ...(match[1] ? { function: match[1] } : {}),
      filename: match[2],
      lineno: Number(match[3]),
      colno: Number(match[4]),
    }));
  // Sentry expects the oldest frame first.
  return frames.reverse().slice(-30);
}
