/**
 * Optional white-labeling for the admin, the /docs page, and system emails.
 * Pure: no file access. The server checks that logo and favicon files exist.
 *
 * Colors are adjusted so every pairing the admin, docs, and emails use meets
 * WCAG 2.2 AA (4.5:1 for text, 3:1 for focus rings), and each adjustment is
 * reported as a warning.
 */

export const BRANDING_DIR = "branding";
export const BRANDING_LOGO_EXTENSIONS = ["svg", "png", "jpg", "jpeg", "webp"] as const;
export const BRANDING_FAVICON_EXTENSIONS = ["svg", "png", "ico"] as const;
export const BRANDING_MAX_FILE_BYTES = 1024 * 1024;

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
  email?: { primary: string; primaryFg: string };
  warnings: string[];
}

/** Surfaces used by the admin (app.css) and the docs page (page.css). */
export const BRANDING_SURFACES = {
  light: {
    text: "#1c1917",
    muted: "#57534e",
    surfaces: ["#f4f1ec", "#ebe6dd", "#fffcf8", "#efe8dc", "#f7f3ec", "#ffffff"],
    raised: "#fffcf8",
  },
  dark: {
    text: "#f3eee6",
    muted: "#b7b0a6",
    surfaces: ["#111315", "#0d0f12", "#181c20", "#1e242a", "#15191d", "#12161a"],
    raised: "#181c20",
  },
} as const;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

export function normalizeHex(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!HEX.test(raw)) {
    throw new Error(`${value} is not a hex color like #0f766e`);
  }
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return raw;
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const value = normalizeHex(hex);
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((part) => Math.round(Math.min(255, Math.max(0, part))).toString(16).padStart(2, "0")).join("")}`;
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    h = (bn - rn) / d + 2;
  } else {
    h = (rn - gn) / d + 4;
  }
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) {
    return [l * 255, l * 255, l * 255];
  }
  const hue = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

function minContrast(color: string, surfaces: readonly string[]): number {
  return Math.min(...surfaces.map((surface) => contrastRatio(color, surface)));
}

/**
 * Moves the color's lightness (keeping hue and saturation) until it reaches
 * `target` contrast against every surface. Darkens on light themes, lightens on dark.
 */
export function ensureContrast(
  color: string,
  surfaces: readonly string[],
  target: number,
  direction: "darken" | "lighten",
): string {
  const start = normalizeHex(color);
  if (minContrast(start, surfaces) >= target) {
    return start;
  }
  const [h, s, l] = rgbToHsl(toRgb(start));
  for (let step = 1; step <= 100; step += 1) {
    const nextL = direction === "darken" ? l - (l * step) / 100 : l + ((1 - l) * step) / 100;
    const candidate = toHex(hslToRgb([h, s, nextL]));
    if (minContrast(candidate, surfaces) >= target) {
      return candidate;
    }
  }
  return direction === "darken" ? "#000000" : "#ffffff";
}

function mix(a: string, b: string, amount: number): string {
  const ra = toRgb(a);
  const rb = toRgb(b);
  return toHex([0, 1, 2].map((i) => ra[i]! * amount + rb[i]! * (1 - amount)) as Rgb);
}

function bestForeground(background: string): string {
  const light = "#ffffff";
  const dark = "#111111";
  return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
}

function fmt(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

function palette(
  primary: string,
  accent: string | undefined,
  theme: "light" | "dark",
  warnings: string[],
  labels: { primary: string; accent: string },
): BrandingPalette {
  const spec = BRANDING_SURFACES[theme];
  const direction = theme === "light" ? "darken" : "lighten";
  const accentColor = ensureContrast(primary, spec.surfaces, 4.5, direction);
  if (accentColor !== primary) {
    warnings.push(
      `${labels.primary} ${primary} is ${fmt(minContrast(primary, spec.surfaces))} against the ${theme} theme, below the 4.5:1 WCAG AA minimum for text. Using ${accentColor} (${fmt(minContrast(accentColor, spec.surfaces))}) in ${theme} mode.`,
    );
  }
  const focus = accent ? ensureContrast(accent, spec.surfaces, 3, direction) : accentColor;
  if (accent && focus !== accent) {
    warnings.push(
      `${labels.accent} ${accent} is ${fmt(minContrast(accent, spec.surfaces))} against the ${theme} theme, below the 3:1 minimum for focus rings. Using ${focus} in ${theme} mode.`,
    );
  }
  let accentSoft: string = spec.raised;
  for (const amount of [0.16, 0.12, 0.08, 0.05, 0.03]) {
    const candidate = mix(accentColor, spec.raised, amount);
    if (
      contrastRatio(spec.text, candidate) >= 4.5 &&
      contrastRatio(spec.muted, candidate) >= 4.5 &&
      contrastRatio(accentColor, candidate) >= 4.5
    ) {
      accentSoft = candidate;
      break;
    }
  }
  return { accent: accentColor, accentFg: bestForeground(accentColor), accentSoft, focus };
}

export interface RawBranding {
  name?: string;
  primaryColor?: string;
  accentColor?: string;
  logo?: string;
  favicon?: string;
}

export function normalizeBrandingPath(value: string): string {
  return value.trim().replace(/^\.\//, "");
}

export function compileBranding(raw: RawBranding | undefined): BrandingAST | undefined {
  if (!raw) {
    return undefined;
  }
  const warnings: string[] = [];
  const out: BrandingAST = { warnings };
  const name = raw.name?.trim();
  if (name) {
    out.name = name;
  }
  if (raw.logo) {
    out.logo = normalizeBrandingPath(raw.logo);
  }
  if (raw.favicon) {
    out.favicon = normalizeBrandingPath(raw.favicon);
  }
  if (raw.primaryColor || raw.accentColor) {
    const primary = normalizeHex(raw.primaryColor ?? raw.accentColor!);
    const accent = raw.accentColor ? normalizeHex(raw.accentColor) : undefined;
    if (raw.primaryColor) {
      out.primaryColor = primary;
    }
    if (accent) {
      out.accentColor = accent;
    }
    const labels = {
      primary: raw.primaryColor ? "branding.primaryColor" : "branding.accentColor",
      accent: "branding.accentColor",
    };
    out.light = palette(primary, accent, "light", warnings, labels);
    out.dark = palette(primary, accent, "dark", warnings, labels);
    const emailPrimary = ensureContrast(primary, ["#ffffff"], 4.5, "darken");
    out.email = { primary: emailPrimary, primaryFg: bestForeground(emailPrimary) };
  }
  return out;
}

/** Display name for the admin, docs, and emails. */
export function brandName(appName: string, branding: BrandingAST | undefined): string {
  return branding?.name ?? appName;
}

function cssVars(p: BrandingPalette, prefix: string): string {
  return [
    `${prefix}accent: ${p.accent};`,
    `${prefix}accent-fg: ${p.accentFg};`,
    `${prefix}accent-soft: ${p.accentSoft};`,
    `${prefix}focus: ${p.focus};`,
  ].join(" ");
}

/** Stylesheet for the admin and /docs. Empty when there are no brand colors. */
export function brandingCss(branding: BrandingAST | undefined): string {
  if (!branding?.light || !branding.dark) {
    return "";
  }
  return [
    "/* Generated from the branding section of app.yaml. */",
    `:root, :root[data-theme="light"] { ${cssVars(branding.light, "--")} ${cssVars(branding.light, "--docs-")} }`,
    `:root[data-theme="dark"] { ${cssVars(branding.dark, "--")} ${cssVars(branding.dark, "--docs-")} }`,
    "",
  ].join("\n");
}
