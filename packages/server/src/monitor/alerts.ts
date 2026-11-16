import type { AppContext } from "../context.ts";
import { acquireLease, instanceHolder, releaseLease } from "../db/leases.ts";
import { MAIL_OUTBOX_TABLE, metaGet, metaSet, WEBHOOK_OUTBOX_TABLE } from "../db/system.ts";
import type { Monitor } from "./monitor.ts";
import { backupStatus } from "./status.ts";

/**
 * Optional alerts. Each condition alerts once when it starts and once when it
 * clears, so a stuck queue does not send an email every check. State lives in
 * _bakorin_meta so restarts and multiple instances agree; a lease makes sure
 * only one instance checks at a time.
 */

export type AlertCondition = "queue_failed" | "backup_overdue";

export interface AlertFinding {
  condition: AlertCondition;
  summary: string;
}

const STATE_KEY = "alert_state";

async function failedCount(ctx: AppContext, table: string): Promise<number> {
  const row = (await ctx.db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll().as("n"))
    .where("status", "=", "failed")
    .executeTakeFirst()) as { n: number | string } | undefined;
  return Number(row?.n ?? 0);
}

export async function findAlerts(ctx: AppContext, monitor: Monitor): Promise<AlertFinding[]> {
  const findings: AlertFinding[] = [];
  const mail = await failedCount(ctx, MAIL_OUTBOX_TABLE);
  const webhooks = await failedCount(ctx, WEBHOOK_OUTBOX_TABLE);
  if (mail + webhooks > 0) {
    const parts = [mail ? `${mail} email${mail === 1 ? "" : "s"}` : "", webhooks ? `${webhooks} webhook${webhooks === 1 ? "" : "s"}` : ""];
    findings.push({
      condition: "queue_failed",
      summary: `${parts.filter(Boolean).join(" and ")} failed after all retries. Open Status in the admin to retry or discard them.`,
    });
  }
  const backups = await backupStatus(ctx.ast, ctx.db, monitor.startedAt);
  if (ctx.ast.runtime.alerts.backupMaxAgeHours && backups.overdue) {
    findings.push({
      condition: "backup_overdue",
      summary: backups.lastAt
        ? `No backup since ${backups.lastAt}, more than ${backups.maxAgeHours} hours ago.`
        : `No backup has been taken in the ${backups.maxAgeHours} hours since the server started.`,
    });
  }
  return findings;
}

export interface AlertDelivery {
  fetch?: typeof fetch;
}

async function notify(ctx: AppContext, kind: "started" | "cleared", finding: AlertFinding, options: AlertDelivery): Promise<void> {
  const alerts = ctx.ast.runtime.alerts;
  const app = ctx.ast.appName;
  const title =
    kind === "started"
      ? `${app}: ${finding.condition === "queue_failed" ? "deliveries are failing" : "backups are overdue"}`
      : `${app}: resolved, ${finding.condition === "queue_failed" ? "no failed deliveries" : "backups are current"}`;
  const statusUrl = `${ctx.ast.runtime.appUrl.replace(/\/+$/, "")}/admin/#status`;
  const text = `${kind === "started" ? finding.summary : "This alert has cleared."}\n\nStatus: ${statusUrl}\n`;
  if (alerts.email.length > 0) {
    try {
      await ctx.mail.send({
        to: alerts.email,
        subject: title,
        text,
        idempotencyKey: `alert:${finding.condition}:${kind}:${Date.now()}`,
      });
    } catch (error) {
      console.error("[bakorin] could not queue alert email", error instanceof Error ? error.message : error);
    }
  }
  if (alerts.webhook) {
    try {
      await (options.fetch ?? fetch)(alerts.webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: `bakorin.alert.${kind}`,
          app,
          condition: finding.condition,
          summary: kind === "started" ? finding.summary : "cleared",
          status: statusUrl,
          at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      console.error("[bakorin] alert webhook did not answer");
    }
  }
}

/** One check: compares current findings with what was already sent. Returns what was sent. */
export async function checkAlerts(
  ctx: AppContext,
  monitor: Monitor,
  options: AlertDelivery = {},
): Promise<Array<{ kind: "started" | "cleared"; condition: AlertCondition }>> {
  const alerts = ctx.ast.runtime.alerts;
  if (alerts.email.length === 0 && !alerts.webhook) {
    return [];
  }
  const raw = await metaGet(ctx.db, STATE_KEY);
  const state = (raw ? JSON.parse(raw) : {}) as Partial<Record<AlertCondition, string>>;
  const findings = await findAlerts(ctx, monitor);
  const sent: Array<{ kind: "started" | "cleared"; condition: AlertCondition }> = [];
  for (const finding of findings) {
    if (!state[finding.condition]) {
      await notify(ctx, "started", finding, options);
      state[finding.condition] = new Date().toISOString();
      sent.push({ kind: "started", condition: finding.condition });
    }
  }
  for (const condition of Object.keys(state) as AlertCondition[]) {
    if (!findings.some((finding) => finding.condition === condition)) {
      await notify(ctx, "cleared", { condition, summary: "" }, options);
      delete state[condition];
      sent.push({ kind: "cleared", condition });
    }
  }
  if (sent.length > 0) {
    await metaSet(ctx.db, STATE_KEY, JSON.stringify(state));
  }
  return sent;
}

export function startAlertWorker(ctx: AppContext, monitor: Monitor): () => void {
  const alerts = ctx.ast.runtime.alerts;
  if (alerts.email.length === 0 && !alerts.webhook) {
    return () => undefined;
  }
  const holder = instanceHolder();
  const everyMs = alerts.checkIntervalMinutes * 60 * 1000;
  const timer = setInterval(() => {
    void (async () => {
      try {
        if (!(await acquireLease(ctx.db, "alerts", holder, everyMs))) {
          return;
        }
        await checkAlerts(ctx, monitor);
      } catch (error) {
        console.error("[bakorin] alert check failed", error instanceof Error ? error.message : error);
      }
    })();
  }, everyMs);
  return () => {
    clearInterval(timer);
    void releaseLease(ctx.db, "alerts", holder);
  };
}
