/** @jsxImportSource preact */
import type { ComponentChildren } from "preact";
import { ThemeToggle } from "./ThemeToggle.tsx";

interface Props {
  children: ComponentChildren;
}

export function AuthLayout({ children }: Props) {
  return (
    <div class="auth-screen">
      <header class="auth-top">
        <div class="brand">
          <strong>Bakorin</strong>
          <span>Admin</span>
        </div>
        <ThemeToggle />
      </header>
      <div class="auth-body">{children}</div>
    </div>
  );
}
