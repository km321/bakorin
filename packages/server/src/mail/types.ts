export type MailDriver = "log" | "smtp" | "resend";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  meta?: {
    purpose: "reset" | "verify" | "invite";
    token?: string;
    link?: string;
  };
}

export interface Mailer {
  driver: MailDriver;
  send(message: MailMessage): Promise<void>;
}
