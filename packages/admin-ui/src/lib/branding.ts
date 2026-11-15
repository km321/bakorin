export interface AdminBranding {
  name: string;
  logo: string | null;
}

/**
 * The server adds <meta name="bakorin-branding"> to the admin page when app.yaml
 * has a branding section. Without it the admin keeps the default Bakorin look.
 */
export function readBranding(doc: Document | undefined = typeof document === "undefined" ? undefined : document): AdminBranding | null {
  const raw = doc?.querySelector('meta[name="bakorin-branding"]')?.getAttribute("content");
  let value: AdminBranding | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<AdminBranding> | null;
      if (parsed && typeof parsed.name === "string" && parsed.name) {
        value = { name: parsed.name, logo: typeof parsed.logo === "string" && parsed.logo.startsWith("/branding/") ? parsed.logo : null };
      }
    } catch {
      value = null;
    }
  }
  return value;
}
