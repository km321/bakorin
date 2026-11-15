export type AccountEmailKind = "reset" | "verify" | "invite";

export interface AccountEmail {
  subject: string;
  text: string;
  html: string;
}

/** Branding for system emails. Without it the emails are exactly the unbranded defaults. */
export interface AccountEmailBrand {
  name: string;
  primary?: string;
  primaryFg?: string;
  logoUrl?: string;
}

export function renderAccountEmail(
  kind: AccountEmailKind,
  options: { appName: string; link: string; brand?: AccountEmailBrand },
): AccountEmail {
  const { link, brand } = options;
  const appName = brand?.name ?? options.appName;
  const wrapHtml = (name: string, heading: string, body: string) =>
    brand ? wrapBrandedHtml(brand, heading, body, link) : wrapPlainHtml(name, heading, body);
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

function wrapPlainHtml(appName: string, heading: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #666;">${escapeHtml(appName)}</p>
    <h1 style="font-size: 20px;">${escapeHtml(heading)}</h1>
    ${body}
  </body>
</html>`;
}

const BUTTON_LABEL: Record<string, string> = {
  "Reset your password": "Choose a new password",
  "Verify your email": "Verify email",
  "You are invited": "Set your password",
};

function wrapBrandedHtml(brand: AccountEmailBrand, heading: string, body: string, link: string): string {
  const primary = brand.primary ?? "#111111";
  const primaryFg = brand.primaryFg ?? "#ffffff";
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" style="display: block; max-height: 40px; max-width: 200px; border: 0;" />`
    : `<p style="margin: 0; font-size: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${primary};">${escapeHtml(brand.name)}</p>`;
  const styledBody = body.replaceAll("<a href=", `<a style="color: ${primary};" href=`);
  const button = `<p style="margin: 24px 0;"><a href="${escapeHtml(link)}" style="display: inline-block; padding: 12px 20px; border-radius: 6px; background: ${primary}; color: ${primaryFg}; font-weight: 600; text-decoration: none;">${escapeHtml(BUTTON_LABEL[heading] ?? "Open link")}</a></p>`;
  return `<!doctype html>
<html>
  <body style="margin: 0; padding: 24px; background: #f4f4f5; font-family: sans-serif; line-height: 1.5; color: #111;">
    <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-top: 4px solid ${primary}; border-radius: 8px; padding: 28px;">
      ${logo}
      <h1 style="font-size: 20px; margin: 20px 0 12px;">${escapeHtml(heading)}</h1>
      ${button}
      ${styledBody}
      <p style="margin-top: 28px; font-size: 12px; color: #52525b;">Sent by ${escapeHtml(brand.name)}</p>
    </div>
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
