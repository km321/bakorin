import type { Monitor } from "./monitor.ts";

let installed = false;

/**
 * Last line of defense for the server process. Bun exits on an unhandled
 * rejection by default, which would drop every in-flight request because one
 * background promise failed. With these handlers the error is logged and sent to
 * the error hook (Status page, BAKORIN_ERROR_WEBHOOK), and the server keeps serving.
 * Known paths (after hooks, workers) already catch their own errors; this is for
 * anything that slips through.
 */
export function installProcessSafety(monitor: Monitor, target: NodeJS.Process = process): void {
  if (installed && target === process) {
    return;
  }
  if (target === process) {
    installed = true;
  }
  target.on("unhandledRejection", (reason: unknown) => {
    console.error("[bakorin] unhandled promise rejection (server keeps running)", reason);
    try {
      monitor.captureError(reason, { source: "process" });
    } catch {
      // never throw from the safety net
    }
  });
  target.on("uncaughtException", (error: Error) => {
    console.error("[bakorin] uncaught exception (server keeps running)", error);
    try {
      monitor.captureError(error, { source: "process" });
    } catch {
      // never throw from the safety net
    }
  });
}
