// src/headless/theme.ts
var NAMES = ["accent-fg", "accent-soft", "accent", "focus"];
function themeFromBrandingCss2(css) {
  const rules = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = match[1].trim();
    const declarations = [];
    for (const name of NAMES) {
      const value = new RegExp(`(?:^|[;\\s])--${name}:\\s*([^;]+);`).exec(match[2])?.[1]?.trim();
      if (value && /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/.test(value)) {
        declarations.push(`--bk-${name}: ${value};`);
      }
    }
    if (declarations.length && /^[:\w\s,="[\]\-]+$/.test(selector)) {
      rules.push(`${selector} { ${declarations.join(" ")} }`);
    }
  }
  return rules.join(`
`);
}
async function loadBrandingTheme2(baseUrl, fetcher = (input) => fetch(input)) {
  try {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, "")}/branding/theme.css`);
    if (!response.ok) {
      return "";
    }
    return themeFromBrandingCss2(await response.text());
  } catch {
    return "";
  }
}

export { themeFromBrandingCss2, loadBrandingTheme2 };
