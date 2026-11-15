import { createLogMailer } from "./log.ts";
import { createResendMailer } from "./resend.ts";
import { createSmtpMailer } from "./smtp.ts";
import type { Mailer } from "./types.ts";

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name];
  return value && value !== "" ? value : undefined;
}

export function mailFrom(env: Record<string, string | undefined>, appName: string): string {
  return readEnv(env, "MAIL_FROM") ?? `${appName} <noreply@localhost>`;
}

export function createMailer(env: Record<string, string | undefined>, from: string): Mailer {
  const driver = (readEnv(env, "MAIL_DRIVER") ?? "log").toLowerCase();
  switch (driver) {
    case "log":
      return createLogMailer();
    case "smtp": {
      const host = readEnv(env, "SMTP_HOST");
      if (!host) {
        throw new Error("SMTP_HOST is required when MAIL_DRIVER=smtp");
      }
      const port = Number(readEnv(env, "SMTP_PORT") ?? "587");
      const secure = ["true", "1", "yes"].includes((readEnv(env, "SMTP_SECURE") ?? "").toLowerCase()) || port === 465;
      return createSmtpMailer({
        host,
        port: Number.isFinite(port) && port > 0 ? port : 587,
        user: readEnv(env, "SMTP_USER"),
        pass: readEnv(env, "SMTP_PASS"),
        secure,
        from,
      });
    }
    case "resend": {
      const key = readEnv(env, "RESEND_API_KEY");
      if (!key) {
        throw new Error("RESEND_API_KEY is required when MAIL_DRIVER=resend");
      }
      return createResendMailer(key, from);
    }
    default:
      throw new Error(`unknown MAIL_DRIVER ${driver}; expected log, smtp, or resend`);
  }
}
