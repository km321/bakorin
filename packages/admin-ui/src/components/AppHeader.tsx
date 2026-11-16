import { initials } from "../lib/format.ts";
import { IconMenu } from "./Icons.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

/** The top bar: navigation toggle, app name, theme, and the signed in user's menu. */
export function AppHeader({
  appName,
  navOpen,
  onToggleNav,
  meLabel,
  role,
  userOpen,
  onToggleUser,
  onSignOut,
}: {
  appName: string | undefined;
  navOpen: boolean;
  onToggleNav: () => void;
  meLabel: string;
  role: unknown;
  userOpen: boolean;
  onToggleUser: () => void;
  onSignOut: () => void;
}) {
  return (
    <header class="header">
      <div class="header-title">
        <button
          class="menu-btn"
          type="button"
          aria-label="Open navigation"
          aria-controls="app-sidebar"
          aria-expanded={navOpen}
          onClick={onToggleNav}
        >
          <IconMenu />
        </button>
        <strong>{appName ?? "Bakorin"}</strong>
      </div>
      <div class="header-actions">
        <ThemeToggle />
        <div class="user-menu">
          <button
            class="user-chip"
            type="button"
            aria-haspopup="menu"
            aria-expanded={userOpen}
            onClick={onToggleUser}
          >
            <span class="nav-mark">{initials(String(meLabel))}</span>
            <span class="user-chip-label">{meLabel}</span>
          </button>
          {userOpen ? (
            <div class="menu-pop" role="menu">
              <p>
                {meLabel}
                {typeof role === "string" ? ` · ${role}` : ""}
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={onSignOut}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
