export type MailDriver = "log" | "smtp" | "resend";

export interface MailMessage {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Stable key for providers that deduplicate sends (Resend Idempotency-Key, SMTP Message-ID). */
  idempotencyKey?: string;
  meta?: {
    purpose: "reset" | "verify" | "invite" | "existing" | "mail";
    token?: string;
    link?: string;
  };
}

export interface Mailer {
  driver: MailDriver;
  send(message: MailMessage): Promise<void>;
}

export function recipientList(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
