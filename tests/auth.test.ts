import { describe, expect, test } from "bun:test";
import { boot, client } from "./helpers.ts";
import { resetRateLimit } from "@bakorin/server";

describe("auth", () => {
  test("signup login refresh and reuse detection", async () => {
    resetRateLimit();
    const runtime = await boot();
    const api = client(runtime);
    const signup = await api.fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "pat@example.com", password: "password123", name: "Pat" }),
    });
    expect(signup.status).toBe(201);
    const first = await signup.json();
    expect(first.data.user.password).toBeUndefined();
    expect(first.data.accessToken).toBeTruthy();

    const login = await api.fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "pat@example.com", password: "password123" }),
    });
    expect(login.status).toBe(200);
    const session = await login.json();
    const refresh1 = session.data.refreshToken as string;

    const rotated = await api.fetch("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: refresh1 }),
    });
    expect(rotated.status).toBe(200);
    const rotatedJson = await rotated.json();
    expect(rotatedJson.data.refreshToken).not.toBe(refresh1);

    const reuse = await api.fetch("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: refresh1 }),
    });
    expect(reuse.status).toBe(401);

    const reuseAgain = await api.fetch("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: rotatedJson.data.refreshToken }),
    });
    expect(reuseAgain.status).toBe(401);

    await runtime.close();
  });

  test("rate limits login", async () => {
    resetRateLimit();
    const runtime = await boot();
    const api = client(runtime);
    let last = 200;
    for (let i = 0; i < 12; i += 1) {
      const response = await api.fetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "nobody@example.com", password: "password123" }),
      });
      last = response.status;
    }
    expect(last).toBe(429);
    await runtime.close();
  });
});
