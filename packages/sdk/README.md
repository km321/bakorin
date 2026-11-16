# @bakorin/sdk

Typed client for a Bakorin API. Generate `bakorin.gen.ts` with `bakorin typegen`, then:

```ts
import { createClient } from "@bakorin/sdk";
import type { BakorinEntities } from "./bakorin.gen.ts";

const api = createClient<BakorinEntities>({
  baseUrl: "http://127.0.0.1:4371",
  getAccessToken: () => localStorage.getItem("access"),
  getRefreshToken: () => localStorage.getItem("refresh"),
  setTokens: (tokens) => {
    localStorage.setItem("access", tokens.accessToken);
    localStorage.setItem("refresh", tokens.refreshToken);
  },
});

await api.signup({ email: "you@studio.test", password: "password123", name: "You" });
// signup answers { ok, status: "check_email", requiresVerification, message } and never signs in
await api.login({ email: "you@studio.test", password: "password123" });
await api.forgotPassword({ email: "you@studio.test" });
await api.resetPassword({ token, password: "new-password-1" });
await api.verifyEmail({ token });
await api.acceptInvite({ token, password: "password123" });
```

## Connect a front end

`@bakorin/sdk/next` and `@bakorin/sdk/astro` store tokens in `bakorin_access` / `bakorin_refresh` cookies. Refresh is mutexed so parallel 401s share one rotation.

```ts
import { createNextClient } from "@bakorin/sdk/next";
import { cookies } from "next/headers";

const api = createNextClient({
  baseUrl: process.env.BAKORIN_URL ?? "http://127.0.0.1:4371",
  cookies: await cookies(),
});
```

```ts
import { createAstroClient } from "@bakorin/sdk/astro";

const api = createAstroClient({
  baseUrl: import.meta.env.BAKORIN_URL ?? "http://127.0.0.1:4371",
  cookies: Astro.cookies,
});
```

This package is published on the npm `beta` tag. See `PUBLISHING.md` in the repo root. Do not `npm publish` until you intend a public beta.

## Components and helpers

| Import | What it has |
|---|---|
| `@bakorin/sdk/headless` | Auth state, collections with pagination and optimistic writes, live lists, uploads with progress, and form helpers. No framework |
| `@bakorin/sdk/react` | `SignInForm`, `SignUpForm`, `UserMenu`, `Gate`, `DataTable`, `RecordForm`, `FileUpload`, `LiveList`, and hooks |
| `@bakorin/sdk/astro/*.astro` | The same components for Astro. Server rendered, enhanced in the browser, and working without JavaScript |
| `@bakorin/sdk/styles.css` | Default styles built on `--bk-*` CSS variables |

`requireAuth` (Astro) and `authMiddleware` and `requireUser` (Next.js) protect pages on the server. See the components docs on the website for details.

## License

MIT. Copyright (c) 2026 Melton Studios. See `LICENSE`.
