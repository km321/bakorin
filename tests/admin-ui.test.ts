import { describe, expect, test } from "bun:test";
import { emptyLabel, formatDate, formatDateTime, initials } from "../packages/admin-ui/src/lib/format.ts";
import { parseThemeMode, resolvedTheme } from "../packages/admin-ui/src/lib/theme.ts";
import { boot, client } from "./helpers.ts";

describe("admin theme", () => {
  test("parses stored modes and falls back to system", () => {
    expect(parseThemeMode("light")).toBe("light");
    expect(parseThemeMode("dark")).toBe("dark");
    expect(parseThemeMode("system")).toBe("system");
    expect(parseThemeMode("nope")).toBe("system");
    expect(parseThemeMode(null)).toBe("system");
  });

  test("resolves system against prefers-color-scheme", () => {
    expect(resolvedTheme("light", true)).toBe("light");
    expect(resolvedTheme("dark", false)).toBe("dark");
    expect(resolvedTheme("system", true)).toBe("dark");
    expect(resolvedTheme("system", false)).toBe("light");
  });
});

describe("admin formatters", () => {
  test("initials from one or two words", () => {
    expect(initials("Leads")).toBe("LE");
    expect(initials("Studio Leads")).toBe("SL");
    expect(initials("  ")).toBe("?");
  });

  test("empty copy uses the entity plural", () => {
    expect(emptyLabel("Tasks")).toBe("No tasks yet");
    expect(emptyLabel("Users")).toBe("No users yet");
  });

  test("dates format without throwing", () => {
    expect(formatDate("2020-01-15")).toContain("2020");
    expect(formatDateTime("2020-01-15T12:00:00.000Z").length).toBeGreaterThan(4);
    expect(formatDate(null)).toBe("");
  });
});

describe("admin meta", () => {
  test("includes field descriptions for form hints", async () => {
    const runtime = await boot();
    const http = client(runtime);
    const firstAdmin = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
    });
    expect(firstAdmin.status).toBe(201);
    const session = (await firstAdmin.json()) as { data: { accessToken: string } };
    const meta = await http.fetch("/api/v1/_meta", { headers: { authorization: `Bearer ${session.data.accessToken}` } });
    expect(meta.status).toBe(200);
    const payload = (await meta.json()) as {
      data: { entities: Array<{ fields: Array<{ name: string; description?: string }> }> };
    };
    const users = payload.data.entities.find((entity) => entity.fields.some((field) => field.name === "emailVerified"));
    const verified = users?.fields.find((field) => field.name === "emailVerified");
    expect(verified?.description).toBeTruthy();
    await runtime.close();
  });
});
