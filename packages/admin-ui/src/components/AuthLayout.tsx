/** @jsxImportSource preact */
import type { ComponentChildren } from "preact";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { Brand } from "./Brand.tsx";

interface Props {
  children: ComponentChildren;
}

export function AuthLayout({ children }: Props) {
  return (
    <div class="auth-screen">
      <header class="auth-top">
        <Brand sub="Admin" />
        <ThemeToggle />
      </header>
      <div class="auth-body">{children}</div>
    </div>
  );
}
