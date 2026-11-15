import { recipientList, type MailMessage, type Mailer } from "./types.ts";

export type FetchLike = typeof fetch;

export function createResendMailer(apiKey: string, from: string, fetcher: FetchLike = fetch): Mailer {
  return {
    driver: "resend",
    async send(message: MailMessage) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      };
      if (message.idempotencyKey) {
        headers["idempotency-key"] = message.idempotencyKey.slice(0, 256);
      }
      const body: Record<string, unknown> = {
        from,
        to: recipientList(message.to),
        subject: message.subject,
        html: message.html,
        text: message.text,
      };
      if (message.cc && message.cc.length > 0) {
        body.cc = message.cc;
      }
      if (message.bcc && message.bcc.length > 0) {
        body.bcc = message.bcc;
      }
      if (message.replyTo) {
        body.reply_to = message.replyTo;
      }
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Resend ${response.status}: ${body}`);
      }
    },
  };
}
