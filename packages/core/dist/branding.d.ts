/**
 * Optional white-labeling for the admin, the /docs page, and system emails.
 * Pure: no file access. The server checks that logo and favicon files exist.
 *
 * Colors are adjusted so every pairing the admin, docs, and emails use meets
 * WCAG 2.2 AA (4.5:1 for text, 3:1 for focus rings), and each adjustment is
 * reported as a warning.
 */
export declare const BRANDING_DIR = "branding";
export declare const BRANDING_LOGO_EXTENSIONS: readonly ["svg", "png", "jpg", "jpeg", "webp"];
export declare const BRANDING_FAVICON_EXTENSIONS: readonly ["svg", "png", "ico"];
export declare const BRANDING_MAX_FILE_BYTES: number;
export interface BrandingPalette {
    /** Links, primary buttons, active states. 4.5:1 or better on every surface. */
    accent: string;
    /** Text on an accent background. */
    accentFg: string;
    /** Selected rows and nav items. Text, muted text and accent stay 4.5:1 on it. */
    accentSoft: string;
    /** Focus rings. 3:1 or better on every surface. */
    focus: string;
}
export interface BrandingAST {
    name?: string;
    /** As written in app.yaml (normalized to #rrggbb). */
    primaryColor?: string;
    accentColor?: string;
    /** Project-relative paths like branding/logo.svg. */
    logo?: string;
    favicon?: string;
    light?: BrandingPalette;
    dark?: BrandingPalette;
    /** Colors for HTML email on a white background. */
    email?: {
        primary: string;
        primaryFg: string;
    };
    warnings: string[];
}
/** Surfaces used by the admin (app.css) and the docs page (page.css). */
export declare const BRANDING_SURFACES: {
    readonly light: {
        readonly text: "#1c1917";
        readonly muted: "#57534e";
        readonly surfaces: readonly ["#f4f1ec", "#ebe6dd", "#fffcf8", "#efe8dc", "#f7f3ec", "#ffffff"];
        readonly raised: "#fffcf8";
    };
    readonly dark: {
        readonly text: "#f3eee6";
        readonly muted: "#b7b0a6";
        readonly surfaces: readonly ["#111315", "#0d0f12", "#181c20", "#1e242a", "#15191d", "#12161a"];
        readonly raised: "#181c20";
    };
};
export declare function isHexColor(value: string): boolean;
export declare function normalizeHex(value: string): string;
export declare function relativeLuminance(hex: string): number;
export declare function contrastRatio(a: string, b: string): number;
/**
 * Moves the color's lightness (keeping hue and saturation) until it reaches
 * `target` contrast against every surface. Darkens on light themes, lightens on dark.
 */
export declare function ensureContrast(color: string, surfaces: readonly string[], target: number, direction: "darken" | "lighten"): string;
export interface RawBranding {
    name?: string;
    primaryColor?: string;
    accentColor?: string;
    logo?: string;
    favicon?: string;
}
export declare function normalizeBrandingPath(value: string): string;
export declare function compileBranding(raw: RawBranding | undefined): BrandingAST | undefined;
/** Display name for the admin, docs, and emails. */
export declare function brandName(appName: string, branding: BrandingAST | undefined): string;
/** Stylesheet for the admin and /docs. Empty when there are no brand colors. */
export declare function brandingCss(branding: BrandingAST | undefined): string;
