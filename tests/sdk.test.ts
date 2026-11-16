import { describe, expect, test } from "bun:test";
import { createClient } from "@bakorin/sdk";
import { boot, waitForLoggedToken } from "./helpers.ts";
import { clearLoggedMail, resetRateLimit } from "@bakorin/server";

describe("sdk account methods", () => {
  test("signup forgot reset verify and accept invite", async () => {
    resetRateLimit();
    clearLoggedMail();
    const runtime = await boot();
    const api = createClient({
      baseUrl: "http://bakorin.test",
      fetch: (input, init) => {
        const url = new URL(String(input));
        return runtime.app.request(`${url.pathname}${url.search}`, init);
      },
    });
    const started = await api.signup({ email: "sdk@example.com", password: "password123", name: "Sdk" });
    expect(started).toMatchObject({ ok: true, status: "check_email" });
    expect(started).not.toHaveProperty("accessToken");
    const session = await api.login({ email: "sdk@example.com", password: "password123" });
    expect(session.user.role).toBe("user");
    expect(session.accessToken).toBeTruthy();
    await api.forgotPassword({ email: "sdk@example.com" });
    const resetToken = await waitForLoggedToken("reset");
    expect(resetToken).toBeTruthy();
    await api.resetPassword({ token: resetToken!, password: "sdk-reset-99" });
    const login = await api.login({ email: "sdk@example.com", password: "sdk-reset-99" });
    expect(login.accessToken).toBeTruthy();

    await runtime.db.updateTable("users").set({ role: "admin" }).where("id", "=", session.user.id).execute();
    const adminLogin = await api.login({ email: "sdk@example.com", password: "sdk-reset-99" });
    const admin = createClient({
      baseUrl: "http://bakorin.test",
      getAccessToken: () => adminLogin.accessToken,
      fetch: (input, init) => {
        const url = new URL(String(input));
        return runtime.app.request(`${url.pathname}${url.search}`, init);
      },
    });
    await admin.invite({ email: "invited@example.com", name: "Invited", role: "user" });
    const inviteToken = await waitForLoggedToken("invite");
    const accepted = await api.acceptInvite({ token: inviteToken!, password: "invite-pass-1" });
    expect(accepted.user.email).toBe("invited@example.com");
    await runtime.close();
  });
});
