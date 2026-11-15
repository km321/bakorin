import type { MailMessage, Mailer } from "./types.ts";

const mailbox: MailMessage[] = [];

export function getLoggedMail(): MailMessage[] {
  return [...mailbox];
}

export function clearLoggedMail(): void {
  mailbox.length = 0;
}

export function createLogMailer(): Mailer {
  return {
    driver: "log",
    async send(message: MailMessage) {
      mailbox.push(message);
      const link = message.meta?.link ?? "";
      console.log(`[bakorin:mail] to=${message.to} subject=${message.subject}${link ? ` link=${link}` : ""}`);
    },
  };
}
