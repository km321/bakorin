/** Rewrites Bakorin's theme.css into rules for the component variables. Pure, for tests and caching. */
export declare function themeFromBrandingCss(css: string): string;
/**
 * Server side: fetches the branding stylesheet from Bakorin (BAKORIN_URL, not the
 * pass through route) and returns CSS for a style tag. Empty when there is no branding.
 */
export declare function loadBrandingTheme(baseUrl: string, fetcher?: (input: string) => Promise<Response>): Promise<string>;
