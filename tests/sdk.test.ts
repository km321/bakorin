import { describe, expect, test } from "bun:test";
import { createClient } from "@bakorin/sdk";
import { boot } from "./helpers.ts";
import { clearLoggedMail, getLoggedMail, resetRateLimit } from "@bakorin/server";

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
    const session = await api.signup({ email: "sdk@example.com", password: "password123", name: "Sdk" });
    expect(session.user.role).toBe("user");
    expect(session.accessToken).toBeTruthy();
    await api.forgotPassword({ email: "sdk@example.com" });
    const resetToken = getLoggedMail().filter((item) => item.meta?.purpose === "reset").at(-1)?.meta?.token;
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
    const inviteToken = getLoggedMail().filter((item) => item.meta?.purpose === "invite").at(-1)?.meta?.token;
    const accepted = await api.acceptInvite({ token: inviteToken!, password: "invite-pass-1" });
    expect(accepted.user.email).toBe("invited@example.com");
    await runtime.close();
  });
});
