import { createHash } from "node:crypto";
import { shortError } from "../webhooks/dispatcher.ts";
import { redactToken, renderAuthEmail, sealMail, type AuthEmailKind, type AuthMailContext } from "./auth.ts";
import { deliverMailById, enqueueMail } from "./outbox.ts";
import { renderAccountEmail } from "./templates.ts";
import { emailBrand } from "../branding/assets.ts";

export interface QueueAuthEmailInput {
  to: string;
  token: string;
  link: string;
}

/**
 * Queues a verify, reset, or invite email in the mail outbox and starts a first
 * attempt in the background. The request never waits on the provider, and errors
 * are only logged, so API responses (and their timing) do not depend on delivery
 * and cannot reveal whether an account exists.
 */
export async function queueAuthEmail(
  ctx: AuthMailContext,
  kind: AuthEmailKind,
  input: QueueAuthEmailInput,
): Promise<string | null> {
  try {
    const data = {
      appName: ctx.ast.appName,
      appUrl: ctx.ast.runtime.appUrl,
      link: input.link,
      email: input.to,
      brand: emailBrand(ctx.ast),
    };
    let rendered: { subject: string; html: string; text: string };
    try {
      rendered = renderAuthEmail(ctx.projectDir, kind, data);
    } catch (error) {
      console.error(`[bakorin:mail] mail/_auth/${kind} failed to render, using the default`, shortError(String(error)));
      rendered = renderAccountEmail(kind, { appName: data.appName, link: data.link, brand: data.brand });
    }
    const sealed = sealMail(ctx.ast.runtime.jwtSecret, {
      html: rendered.html,
      text: rendered.text,
      meta: { purpose: kind, token: input.token, link: input.link },
    });
    const tokenId = createHash("sha256").update(input.token).digest("hex").slice(0, 32);
    const result = await enqueueMail(ctx.db, {
      source: "auth",
      purpose: kind,
      idempotencyKey: `auth:${kind}:${tokenId}`,
      template: `_auth/${kind}`,
      event: `auth.${kind}`,
      to: [input.to],
      literalAddresses: true,
      data: {},
      sealed,
      render: () => ({
        subject: rendered.subject,
        html: redactToken(rendered.html, input.token),
        text: redactToken(rendered.text, input.token),
      }),
    });
    if (result.error) {
      console.error(`[bakorin:mail] ${kind} email not queued: ${result.error}`);
      return result.id;
    }
    const secrets = [ctx.ast.runtime.jwtSecret, ctx.ast.runtime.jwtSecretPrevious];
    void deliverMailById(ctx.db, ctx.mailer, result.id, { secrets }).catch(() => {
      // The worker retries with backoff.
    });
    return result.id;
  } catch (error) {
    console.error("[bakorin:mail] could not queue account email", shortError(String(error)));
    return null;
  }
}
