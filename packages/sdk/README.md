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
