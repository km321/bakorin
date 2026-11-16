import { describe, expect, test } from "bun:test";
import { emptyLabel, fileKind, formatDate, formatDateTime, formatSize, initials, isPreviewImage } from "../packages/admin-ui/src/lib/format.ts";
import { changedValues } from "../packages/admin-ui/src/lib/record-form.ts";
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

describe("admin record editor", () => {
  const fields = [
    { name: "name", type: "text", required: true, secret: false },
    { name: "brief", type: "file", required: false, secret: false },
    { name: "password", type: "password", required: true, secret: true },
    { name: "tagIds", type: "relation", required: false, secret: false, relation: { to: "tags", many: true } },
  ];

  test("an edit sends only the fields that changed, never id, timestamps or $expand", () => {
    const record = {
      id: "r1",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      name: "Store",
      brief: null,
      tagIds: ["t1"],
      $expand: { brief: null },
    };
    const values = { ...record, name: "Store", brief: "file-1", password: "", tagIds: ["t1"] };
    expect(changedValues(fields, values, record)).toEqual({ brief: "file-1" });
    expect(changedValues(fields, { ...values, brief: null, tagIds: ["t1", "t2"] }, record)).toEqual({ tagIds: ["t1", "t2"] });
    expect(changedValues(fields, { ...values, brief: null, password: "new-password-1" }, record)).toEqual({ password: "new-password-1" });
  });

  test("date fields show the stored calendar day in every time zone", () => {
    // 2027-01-22 used to be read as UTC midnight, so the list showed Jan 21 west of UTC.
    expect(formatDate("2027-01-22")).toBe(new Date(2027, 0, 22).toLocaleDateString(undefined, { dateStyle: "medium" }));
  });

  test("file labels", () => {
    expect(formatSize(45)).toBe("45 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(fileKind("application/pdf")).toBe("PDF");
    expect(fileKind("image/png")).toBe("PNG");
    expect(fileKind("text/plain; charset=utf-8")).toBe("Text");
    expect(isPreviewImage("image/png")).toBe(true);
    expect(isPreviewImage("image/svg+xml")).toBe(false);
  });
});
