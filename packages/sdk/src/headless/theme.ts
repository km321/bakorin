/**
 * Brand colors for the components. Bakorin serves the branding section of app.yaml
 * at /branding/theme.css; this maps it onto the --bk-* variables the components use.
 * With no branding section the server answers 404 and the defaults in styles.css apply.
 */
const NAMES = ["accent-fg", "accent-soft", "accent", "focus"] as const;

/** Rewrites Bakorin's theme.css into rules for the component variables. Pure, for tests and caching. */
export function themeFromBrandingCss(css: string): string {
  const rules: string[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = match[1]!.trim();
    const declarations: string[] = [];
    for (const name of NAMES) {
      const value = new RegExp(`(?:^|[;\\s])--${name}:\\s*([^;]+);`).exec(match[2]!)?.[1]?.trim();
      // Only plain color values, so a stylesheet can never smuggle anything else in.
      if (value && /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/.test(value)) {
        declarations.push(`--bk-${name}: ${value};`);
      }
    }
    if (declarations.length && /^[:\w\s,="[\]\-]+$/.test(selector)) {
      rules.push(`${selector} { ${declarations.join(" ")} }`);
    }
  }
  return rules.join("\n");
}

/**
 * Server side: fetches the branding stylesheet from Bakorin (BAKORIN_URL, not the
 * pass through route) and returns CSS for a style tag. Empty when there is no branding.
 */
export async function loadBrandingTheme(
  baseUrl: string,
  fetcher: (input: string) => Promise<Response> = (input) => fetch(input),
): Promise<string> {
  try {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, "")}/branding/theme.css`);
    if (!response.ok) {
      return "";
    }
    return themeFromBrandingCss(await response.text());
  } catch {
    return "";
  }
}
