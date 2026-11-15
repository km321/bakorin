export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "bakorin_theme";

export function parseThemeMode(raw: string | null | undefined): ThemeMode {
  if (raw === "light" || raw === "dark" || raw === "system") {
    return raw;
  }
  return "system";
}

export function resolvedTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  switch (mode) {
    case "light":
      return "light";
    case "dark":
      return "dark";
    case "system":
      return prefersDark ? "dark" : "light";
    default: {
      const _never: never = mode;
      return _never;
    }
  }
}

export function applyTheme(
  mode: ThemeMode,
  root: HTMLElement = document.documentElement,
  prefersDark: boolean = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
): ResolvedTheme {
  const theme = resolvedTheme(mode, prefersDark);
  root.dataset.theme = theme;
  root.dataset.themeMode = mode;
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // private mode
  }
  return theme;
}

export function readStoredThemeMode(): ThemeMode {
  try {
    return parseThemeMode(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}
