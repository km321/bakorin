export type AccountEmailKind = "reset" | "verify" | "invite";

export interface AccountEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderAccountEmail(
  kind: AccountEmailKind,
  options: { appName: string; link: string },
): AccountEmail {
  const { appName, link } = options;
  switch (kind) {
    case "reset":
      return {
        subject: `Reset your ${appName} password`,
        text: `Reset your ${appName} password.\n\n${link}\n\nThis link expires in 1 hour. If you did not ask for a reset, ignore this email.`,
        html: wrapHtml(
          appName,
          "Reset your password",
          `<p>Use this link to choose a new password. It expires in 1 hour.</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>If you did not ask for a reset, you can ignore this email.</p>`,
        ),
      };
    case "verify":
      return {
        subject: `Verify your ${appName} email`,
        text: `Confirm your ${appName} email.\n\n${link}\n\nThis link expires in 24 hours.`,
        html: wrapHtml(
          appName,
          "Verify your email",
          `<p>Confirm this address to finish setting up your ${escapeHtml(appName)} account. This link expires in 24 hours.</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
        ),
      };
    case "invite":
      return {
        subject: `You are invited to ${appName}`,
        text: `You have been invited to ${appName}. Set your password:\n\n${link}\n\nThis link expires in 7 days.`,
        html: wrapHtml(
          appName,
          "You are invited",
          `<p>An admin invited you to ${escapeHtml(appName)}. Set a password with this link. It expires in 7 days.</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
        ),
      };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function wrapHtml(appName: string, heading: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #666;">${escapeHtml(appName)}</p>
    <h1 style="font-size: 20px;">${escapeHtml(heading)}</h1>
    ${body}
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
