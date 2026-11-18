---
"@bakorin/core": patch
"@bakorin/server": patch
---

The admin UI renews access tokens automatically, revokes the refresh token on every sign-out, and can sign out after an optional idle timeout (`runtime.admin.idleTimeoutMinutes`).
