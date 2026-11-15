/** @jsxImportSource preact */
import { readBranding } from "../lib/branding.ts";

interface Props {
  sub: string;
}

/** Product mark used in the sidebar and on sign-in screens. */
export function Brand({ sub }: Props) {
  const branding = readBranding();
  if (!branding) {
    return (
      <div class="brand">
        <strong>Bakorin</strong>
        <span>{sub}</span>
      </div>
    );
  }
  return (
    <div class="brand brand-custom">
      {branding.logo ? <img class="brand-logo" src={branding.logo} alt="" /> : null}
      <div class="brand-text">
        <strong>{branding.name}</strong>
        <span>{sub}</span>
      </div>
    </div>
  );
}
