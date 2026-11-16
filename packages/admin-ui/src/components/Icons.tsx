import type { ComponentChildren, JSX } from "preact";

function Svg({ children, ...rest }: { children: ComponentChildren } & JSX.SVGAttributes<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export function IconSearch() {
  return (
    <Svg>
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" stroke-width="1.25" />
      <path d="M10.2 10.2 13.5 13.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
    </Svg>
  );
}

export function IconFiles() {
  return (
    <Svg>
      <path d="M4 2.5h5l3 3v8H4z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" />
      <path d="M9 2.5v3h3M6 9h4M6 11h3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
    </Svg>
  );
}

export function IconBackup() {
  return (
    <Svg>
      <rect x="3" y="2.5" width="10" height="11" rx="1.5" stroke="currentColor" stroke-width="1.25" />
      <path d="M6 8h4M8 6v4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
    </Svg>
  );
}

export function IconStatus() {
  return (
    <Svg>
      <path
        d="M2 8.5h2.5l1.5-4 3 7 1.5-3H14"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </Svg>
  );
}

export function IconAudit() {
  return (
    <Svg>
      <path d="M3.5 3.5h9v9h-9z" stroke="currentColor" stroke-width="1.25" />
      <path d="M6 6.5h4M6 9h3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
    </Svg>
  );
}

export function IconDocs() {
  return (
    <Svg>
      <path d="M5 2.5h4.5L12.5 6v7.5H5z" stroke="currentColor" stroke-width="1.25" />
      <path d="M9.5 2.5V6H12.5" stroke="currentColor" stroke-width="1.25" />
    </Svg>
  );
}

export function IconSchema() {
  return (
    <Svg>
      <rect x="2.5" y="2.5" width="5.2" height="4.5" rx="0.8" stroke="currentColor" stroke-width="1.25" />
      <rect x="8.3" y="9" width="5.2" height="4.5" rx="0.8" stroke="currentColor" stroke-width="1.25" />
      <path d="M5.1 7v2.2h3.2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
    </Svg>
  );
}

export function IconWebhook() {
  return (
    <Svg>
      <circle cx="4.5" cy="8" r="1.7" stroke="currentColor" stroke-width="1.25" />
      <circle cx="11.5" cy="4.5" r="1.7" stroke="currentColor" stroke-width="1.25" />
      <circle cx="11.5" cy="11.5" r="1.7" stroke="currentColor" stroke-width="1.25" />
      <path d="M6.1 7.2 9.8 5.4M6.1 8.8 9.8 10.6" stroke="currentColor" stroke-width="1.25" />
    </Svg>
  );
}

export function IconMail() {
  return (
    <Svg>
      <rect x="2.5" y="3.75" width="11" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.25" />
      <path d="m3 4.75 5 3.75 5-3.75" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" />
    </Svg>
  );
}

export function IconMenu() {
  return (
    <Svg>
      <path d="M3 5h10M3 8h10M3 11h10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
    </Svg>
  );
}
