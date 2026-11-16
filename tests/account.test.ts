import { describe, expect, test } from "bun:test";
import { boot, client, MINI_YAML, waitForLoggedToken, signupAndLogin } from "./helpers.ts";
import { clearLoggedMail, getLoggedMail, resetRateLimit } from "@bakorin/server";

async function signup(runtime: Awaited<ReturnType<typeof boot>>, email: string) {
  const response = await signupAndLogin(client(runtime), {
    method: "POST",
    body: JSON.stringify({ email, password: "password123", name: email }),
  });
  return (await response.json()).data as { accessToken: string; refreshToken: string; user: { id: string } };
}

async function promoteAdmin(runtime: Awaited<ReturnType<typeof boot>>, email: string) {
  const session = await signup(runtime, email);
  await runtime.db.updateTable("users").set({ role: "admin" }).where("id", "=", session.user.id).execute();
  const login = await client(runtime).fetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123" }),
  });
  return (await login.json()).data as { accessToken: string };
}

function lastToken(purpose: "reset" | "verify" | "invite"): Promise<string> {
  return waitForLoggedToken(purpose);
}

describe("account email flows", () => {
  test("rate limits forgot-password", async () => {
    resetRateLimit();
    const runtime = await boot();
    let last = 200;
    for (let i = 0; i < 6; i += 1) {
      const response = await client(runtime).fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: "missing@example.com" }),
      });
      last = response.status;
    }
    expect(last).toBe(429);
    await runtime.close();
  });

  test("forgot-password always 200, reset is single-use and revokes sessions", async () => {
    resetRateLimit();
    clearLoggedMail();
    const runtime = await boot();
    const user = await signup(runtime, "resetme@example.com");
    const missing = await client(runtime).fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    expect(missing.status).toBe(200);
    const forgot = await client(runtime).fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "resetme@example.com" }),
    });
    expect(forgot.status).toBe(200);
    const token = await lastToken("reset");
    expect(getLoggedMail().at(-1)?.meta?.link).toContain("/reset-password?token=");
    const reset = await client(runtime).fetch("/api/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "brand-new-1" }),
    });
    expect(reset.status).toBe(200);
    const reuse = await client(runtime).fetch("/api/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "brand-new-2" }),
    });
    expect(reuse.status).toBe(400);
    const stale = await client(runtime).fetch("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: user.refreshToken }),
    });
    expect(stale.status).toBe(401);
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "resetme@example.com", password: "brand-new-1" }),
    });
    expect(login.status).toBe(200);
    await runtime.close();
  });

  test("expired reset tokens are rejected", async () => {
    resetRateLimit();
    clearLoggedMail();
    const runtime = await boot();
    await signup(runtime, "expire@example.com");
    await client(runtime).fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "expire@example.com" }),
    });
    const token = await lastToken("reset");
    await runtime.db.updateTable("_bakorin_auth_tokens").set({ expires_at: new Date(0).toISOString() }).execute();
    const reset = await client(runtime).fetch("/api/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "too-late-99" }),
    });
    expect(reset.status).toBe(400);
    await runtime.close();
  });

  test("signup sends verification and requireVerifiedEmail blocks login", async () => {
    resetRateLimit();
    clearLoggedMail();
    const yaml = MINI_YAML.replace("auth:\n  entity: users\n  adminRole: admin", "auth:\n  entity: users\n  adminRole: admin\n  requireVerifiedEmail: true");
    const runtime = await boot(yaml);
    const signupResponse = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "verify@example.com", password: "password123", name: "Verify" }),
    });
    expect(signupResponse.status).toBe(202);
    const created = await signupResponse.json();
    expect(created.data.accessToken).toBeUndefined();
    expect(created.data.requiresVerification).toBe(true);
    const blocked = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "verify@example.com", password: "password123" }),
    });
    expect(blocked.status).toBe(403);
    const token = await lastToken("verify");
    const verify = await client(runtime).fetch("/api/v1/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    expect(verify.status).toBe(200);
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "verify@example.com", password: "password123" }),
    });
    expect(login.status).toBe(200);
    await runtime.close();
  });

  test("admin invite sets role and accept-invite creates a session", async () => {
    resetRateLimit();
    clearLoggedMail();
    const runtime = await boot();
    const admin = await promoteAdmin(runtime, "inviter@example.com");
    const anon = await client(runtime).fetch("/api/v1/auth/invites", {
      method: "POST",
      body: JSON.stringify({ email: "new@example.com", role: "admin" }),
    });
    expect(anon.status).toBe(401);
    const userInvite = await client(runtime, (await signup(runtime, "peer@example.com")).accessToken).fetch(
      "/api/v1/auth/invites",
      { method: "POST", body: JSON.stringify({ email: "new@example.com", role: "admin" }) },
    );
    expect(userInvite.status).toBe(403);
    const invited = await client(runtime, admin.accessToken).fetch("/api/v1/auth/invites", {
      method: "POST",
      body: JSON.stringify({ email: "new@example.com", role: "admin", name: "New Admin" }),
    });
    expect(invited.status).toBe(201);
    expect((await invited.json()).data.role).toBe("admin");
    const token = await lastToken("invite");
    const accepted = await client(runtime).fetch("/api/v1/auth/accept-invite", {
      method: "POST",
      body: JSON.stringify({ token, password: "invite-pass-1" }),
    });
    expect(accepted.status).toBe(200);
    const session = await accepted.json();
    expect(session.data.user.role).toBe("admin");
    expect(session.data.accessToken).toBeTruthy();
    const backups = await client(runtime, session.data.accessToken as string).fetch("/api/v1/backups");
    expect(backups.status).toBe(200);
    await runtime.close();
  });
});
