import { LAST_ACTIVITY_KEY, postSessionMessage } from "./session.ts";

export const DEFAULT_IDLE_WARNING_MS = 60_000;

export interface IdleControllerOptions {
  timeoutMs: number;
  /** Time before sign-out to show a warning. Default 1 minute. No warning when the timeout is this short or shorter. */
  warningMs?: number;
  onWarning?: () => void;
  /** Called when activity resumes after a warning was shown. */
  onWarningCancel?: () => void;
  onIdle: () => void;
  now?: () => number;
  /** Tick interval. Default 1 second. */
  intervalMs?: number;
  /** When false, do not attach window activity listeners (tests). Default true. */
  attachListeners?: boolean;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  addEventListener?: (type: string, listener: EventListener, options?: AddEventListenerOptions) => void;
  removeEventListener?: (type: string, listener: EventListener, options?: AddEventListenerOptions) => void;
  getDocument?: () => { visibilityState?: string } | undefined;
}

export interface IdleController {
  start(): void;
  stop(): void;
  recordActivity(): void;
  tick(): void;
  lastActivityAt(): number;
  /** Apply activity recorded by another tab (localStorage or BroadcastChannel). */
  syncFromStorage(): void;
}

function defaultNow(): number {
  return Date.now();
}

export function warningLeadMs(timeoutMs: number, warningMs = DEFAULT_IDLE_WARNING_MS): number | null {
  if (timeoutMs <= warningMs) {
    return null;
  }
  return warningMs;
}

export function createIdleController(options: IdleControllerOptions): IdleController {
  const timeoutMs = options.timeoutMs;
  const warningMs = warningLeadMs(timeoutMs, options.warningMs ?? DEFAULT_IDLE_WARNING_MS);
  const now = options.now ?? defaultNow;
  const intervalMs = options.intervalMs ?? 1000;
  const attach = options.attachListeners !== false;
  const setIntervalFn = options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearIntervalFn = options.clearInterval ?? ((id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>));
  const add = options.addEventListener ?? ((type, listener, listenerOptions) => {
    const node = type === "visibilitychange" ? document : window;
    node.addEventListener(type, listener, listenerOptions);
  });
  const remove = options.removeEventListener ?? ((type, listener, listenerOptions) => {
    const node = type === "visibilitychange" ? document : window;
    node.removeEventListener(type, listener, listenerOptions);
  });

  let timer: unknown;
  let started = false;
  let warningShown = false;
  let lastWrite = 0;

  function lastActivityAt(): number {
    try {
      const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    } catch {
      // ignore
    }
    return now();
  }

  function writeActivity(at: number, broadcast = true): void {
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
    } catch {
      // ignore
    }
    lastWrite = at;
    if (broadcast) {
      postSessionMessage({ type: "activity", at });
    }
    if (warningShown) {
      warningShown = false;
      options.onWarningCancel?.();
    }
  }

  function recordActivity(): void {
    const at = now();
    // Throttle storage writes to once a second.
    if (at - lastWrite < 1000) {
      return;
    }
    writeActivity(at, true);
  }

  function onPointerOrKey(): void {
    recordActivity();
  }

  function onVisibility(): void {
    const doc = options.getDocument?.() ?? (typeof document !== "undefined" ? document : undefined);
    if (!doc || doc.visibilityState === "visible") {
      // Count returning to the tab as activity, but keep the timer running while hidden.
      writeActivity(now(), true);
    }
  }

  function tick(): void {
    if (!started) {
      return;
    }
    const elapsed = now() - lastActivityAt();
    if (elapsed >= timeoutMs) {
      stop();
      options.onIdle();
      return;
    }
    if (warningMs !== null && !warningShown && timeoutMs - elapsed <= warningMs) {
      warningShown = true;
      options.onWarning?.();
    }
  }

  function start(): void {
    if (started) {
      return;
    }
    started = true;
    warningShown = false;
    writeActivity(now(), true);
    if (attach) {
      add("pointerdown", onPointerOrKey, { capture: true });
      add("pointermove", onPointerOrKey, { capture: true });
      add("keydown", onPointerOrKey, { capture: true });
      add("visibilitychange", onVisibility, { capture: true });
    }
    timer = setIntervalFn(() => tick(), intervalMs);
  }

  function stop(): void {
    if (!started) {
      return;
    }
    started = false;
    if (timer !== undefined) {
      clearIntervalFn(timer);
      timer = undefined;
    }
    if (attach) {
      remove("pointerdown", onPointerOrKey, { capture: true });
      remove("pointermove", onPointerOrKey, { capture: true });
      remove("keydown", onPointerOrKey, { capture: true });
      remove("visibilitychange", onVisibility, { capture: true });
    }
  }

  function syncFromStorage(): void {
    const at = lastActivityAt();
    lastWrite = at;
    const remaining = timeoutMs - (now() - at);
    if (warningShown && (warningMs === null || remaining > warningMs)) {
      warningShown = false;
      options.onWarningCancel?.();
    }
  }

  return {
    start,
    stop,
    recordActivity,
    tick,
    lastActivityAt,
    syncFromStorage,
  };
}

/** Minutes from app.yaml, or null/undefined when the timeout is off. */
export function idleTimeoutMs(minutes: number | null | undefined): number | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 1) {
    return null;
  }
  return Math.floor(minutes) * 60_000;
}
