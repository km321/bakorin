import type { MailMessage, Mailer } from "./types.ts";

export type FetchLike = typeof fetch;

export function createResendMailer(apiKey: string, from: string, fetcher: FetchLike = fetch): Mailer {
  return {
    driver: "resend",
    async send(message: MailMessage) {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Resend ${response.status}: ${body}`);
      }
    },
  };
}
