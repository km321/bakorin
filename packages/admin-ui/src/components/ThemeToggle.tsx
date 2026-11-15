/** @jsxImportSource preact */
import { applyTheme, parseThemeMode, readStoredThemeMode, type ThemeMode } from "../lib/theme.ts";
import { useState } from "preact/hooks";

const MODES: Array<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredThemeMode());

  function choose(next: ThemeMode) {
    setMode(next);
    applyTheme(next);
  }

  return (
    <div class="theme-toggle" role="radiogroup" aria-label="Color theme">
      {MODES.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={mode === item.value}
          onClick={() => choose(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function syncSystemTheme(): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (parseThemeMode(localStorage.getItem("bakorin_theme")) === "system") {
      applyTheme("system");
    }
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
