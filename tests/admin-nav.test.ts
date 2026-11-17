import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { compileAppYaml, SchemaError } from "@bakorin/core";
import { emptyEntity, emptyField, importAppYaml, toAppYaml, validateConfig } from "../packages/core/src/builder.ts";
import type { MetaEntity } from "../packages/admin-ui/src/lib/api.ts";
import { filterNav, firstNavEntity, navGroups, navMark } from "../packages/admin-ui/src/lib/nav.ts";
import { boot, client, MINI_YAML, signupAndLogin } from "./helpers.ts";

const ENV = { env: { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" } };

/** MINI_YAML with admin: settings on users and items, plus three more entities. */
function groupedYaml(): string {
  return MINI_YAML.replace(
    "  users:\n    auth: true\n",
    "  users:\n    auth: true\n    admin: { group: People, order: 1, icon: US }\n",
  )
    .replace("  items:\n    fields:", "  items:\n    admin: { group: Content, order: 2 }\n    fields:")
    .concat(`
  posts:
    admin: { group: Content, order: 1, icon: "✍" }
    fields:
      title: { type: text, required: true }
  notes:
    fields:
      body: { type: text }
  secrets:
    admin: { hidden: true }
    fields:
      label: { type: text }
`);
}

function meta(name: string, admin?: MetaEntity["admin"], plural = name[0]!.toUpperCase() + name.slice(1)): MetaEntity {
  return { name, label: plural, plural, display: "id", fields: [], ...(admin ? { admin } : {}) };
}

describe("app.yaml admin:", () => {
  test("compiles group, order, icon, and hidden onto the entity", () => {
    const ast = compileAppYaml(groupedYaml(), ENV);
    expect(ast.entityMap.users!.admin).toEqual({ group: "People", order: 1, icon: "US" });
    expect(ast.entityMap.posts!.admin).toEqual({ group: "Content", order: 1, icon: "✍" });
    expect(ast.entityMap.secrets!.admin).toEqual({ hidden: true });
    expect(ast.entityMap.notes!.admin).toBeUndefined();
  });

  test("projects without admin: compile exactly as before", () => {
    const ast = compileAppYaml(MINI_YAML, ENV);
    expect(ast.entities.every((entity) => !("admin" in entity))).toBe(true);
  });

  test("rejects unknown keys, long icons, and fractional order", () => {
    const bad = (admin: string) => () => compileAppYaml(MINI_YAML.replace("  items:\n    fields:", `  items:\n    admin: ${admin}\n    fields:`), ENV);
    expect(bad("{ group: Content, colour: red }")).toThrow(SchemaError);
    expect(bad("{ icon: ABC }")).toThrow(/1 or 2 characters/);
    expect(bad("{ order: 1.5 }")).toThrow(SchemaError);
    expect(bad("{ group: '' }")).toThrow(SchemaError);
    expect(bad("{ hidden: yes please }")).toThrow(SchemaError);
  });

  test("_meta sends admin settings only for entities that set them", async () => {
    const runtime = await boot(groupedYaml());
    const http = client(runtime);
    const first = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
    });
    expect(first.status).toBe(201);
    const token = ((await first.json()) as { data: { accessToken: string } }).data.accessToken;
    const body = ((await (await http.fetch("/api/v1/_meta", { headers: { authorization: `Bearer ${token}` } })).json()) as { data: { entities: MetaEntity[] } }).data;
    const byName = Object.fromEntries(body.entities.map((entity) => [entity.name, entity]));
    expect(byName.items!.admin).toEqual({ group: "Content", order: 2 });
    expect(byName.secrets!.admin).toEqual({ hidden: true });
    expect("admin" in byName.notes!).toBe(false);
    await runtime.close();
  });
});

describe("admin sidebar order", () => {
  test("no admin settings: one plain list in app.yaml order", () => {
    const list = [meta("users"), meta("tasks"), meta("clients")];
    expect(navGroups(list)).toEqual([{ group: null, items: list }]);
    expect(firstNavEntity(list)).toBe("users");
  });

  test("ungrouped first, then groups in first appearance order, ordered inside", () => {
    const list = [
      meta("orders", { group: "Commerce", order: 2 }),
      meta("notes"),
      meta("products", { group: "Commerce", order: 1 }),
      meta("posts", { group: "Content" }),
      meta("pages", { group: "Content", order: 5 }),
      meta("refunds", { group: "Commerce" }),
      meta("archive", { hidden: true }),
      meta("users", { order: -1 }),
    ];
    const groups = navGroups(list);
    expect(groups.map((block) => [block.group, block.items.map((item) => item.name)])).toEqual([
      [null, ["users", "notes"]],
      ["Commerce", ["products", "orders", "refunds"]],
      ["Content", ["pages", "posts"]],
    ]);
    expect(firstNavEntity(list)).toBe("users");
    expect(firstNavEntity([meta("archive", { hidden: true })])).toBe("archive");
  });

  test("filter matches plural, name, or group, and drops empty groups", () => {
    const groups = navGroups([meta("orders", { group: "Commerce" }), meta("posts", { group: "Content" }), meta("pages", { group: "Content" })]);
    expect(filterNav(groups, "PO").map((block) => block.items.map((item) => item.name))).toEqual([["posts"]]);
    expect(filterNav(groups, "commerce").map((block) => block.group)).toEqual(["Commerce"]);
    expect(filterNav(groups, "zzz")).toEqual([]);
    expect(filterNav(groups, "  ")).toBe(groups);
  });

  test("badge uses admin.icon, else initials", () => {
    expect(navMark(meta("posts", { icon: "✍" }))).toBe("✍");
    expect(navMark(meta("posts", {}, "Blog Posts"))).toBe("BP");
  });
});

describe("config builder admin fields", () => {
  test("round-trips admin: and leaves it out when empty", () => {
    const yaml = groupedYaml();
    const { config } = importAppYaml(yaml);
    const posts = config.entities.find((entity) => entity.name === "posts")!;
    expect(posts.admin).toEqual({ group: "Content", order: "1", icon: "✍", hidden: false });
    const result = validateConfig(config);
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const again = importAppYaml(result.yaml).config;
    expect(again.entities.map((entity) => entity.admin)).toEqual(config.entities.map((entity) => entity.admin));
    const notes = (Bun.YAML.parse(toAppYaml(config)) as { entities: Record<string, Record<string, unknown>> }).entities.notes!;
    expect("admin" in notes).toBe(false);
  });

  test("flags a bad order and a long icon on the right controls", () => {
    const { config } = importAppYaml(MINI_YAML);
    const entity = emptyEntity("things");
    entity.fields.push(emptyField("title", "text"));
    entity.admin = { group: "Stuff", order: "first", icon: "ABC", hidden: false };
    config.entities.push(entity);
    const i = config.entities.length - 1;
    const targets = validateConfig(config).issues.map((issue) => issue.target);
    expect(targets).toContain(`entities.${i}.admin.order`);
    expect(targets).toContain(`entities.${i}.admin.icon`);
  });
});

const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(
  (path): path is string => Boolean(path && existsSync(path)),
);

/** Many types, so the list is longer than the window and the filter box shows. */
function longYaml(): string {
  const groups = ["Content", "Commerce", "Support"];
  let extra = "";
  for (let i = 1; i <= 24; i += 1) {
    const group = groups[i % 3]!;
    extra += `\n  type${String(i).padStart(2, "0")}:\n    plural: Type ${String(i).padStart(2, "0")}\n    admin: { group: ${group} }\n    fields:\n      title: { type: text }\n`;
  }
  return MINI_YAML + extra;
}

describe.skipIf(!CHROME)("admin UI: sidebar", () => {
  test(
    "scrolls on its own, collapses groups (remembered), filters, and keeps the current item in view",
    async () => {
      const { chromium } = await import("playwright");
      const runtime = await boot(longYaml());
      const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => runtime.app.fetch(request) });
      const base = `http://127.0.0.1:${server.port}`;
      const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
      try {
        const signup = await signupAndLogin(client(runtime), {
          method: "POST",
          body: JSON.stringify({ email: "admin@example.com", password: "password123", name: "Admin" }),
        });
        const adminId = (await signup.json()).data.user.id as string;
        await runtime.db.updateTable("users").set({ role: "admin" }).where("id", "=", adminId).execute();
        const context = await browser.newContext({ viewport: { width: 1200, height: 640 } });
        const page = await context.newPage();
        await page.goto(`${base}/admin/`);
        await page.fill("input[type=email]", "admin@example.com");
        await page.fill("input[type=password]", "password123");
        await page.click("button[type=submit]");
        await page.locator('[data-nav="type01"]').waitFor();

        // The list scrolls inside the sidebar; the brand and API docs stay put.
        const sizes = await page.evaluate(() => {
          const nav = document.querySelector(".nav-scroll")!;
          const sidebar = document.querySelector(".sidebar")!;
          return { scroll: nav.scrollHeight, client: nav.clientHeight, sidebar: sidebar.getBoundingClientRect().height, win: innerHeight, overflow: getComputedStyle(nav).overflowY };
        });
        expect(sizes.scroll).toBeGreaterThan(sizes.client);
        expect(sizes.overflow).toBe("auto");
        expect(Math.round(sizes.sidebar)).toBe(sizes.win);
        const docsTop = async () => (await page.locator('[data-nav="docs"]').boundingBox())!.y;
        const before = await docsTop();
        await page.locator(".nav-scroll").evaluate((nav) => nav.scrollTo(0, nav.scrollHeight));
        expect(await docsTop()).toBe(before);
        await page.mouse.wheel(0, 2000);
        expect(await page.locator(".brand").boundingBox().then((box) => box!.y)).toBeGreaterThanOrEqual(0);

        // Opening a type far down the list keeps it in view and marks it current.
        await page.locator(".nav-scroll").evaluate((nav) => nav.scrollTo(0, 0));
        await page.locator('[data-nav="type24"]').click();
        await page.locator('.nav [data-nav="type24"][aria-current="page"]').waitFor();
        await page.locator('[data-nav="status"]').click();
        await page.locator('[data-nav="type23"]').scrollIntoViewIfNeeded();
        await page.locator('[data-nav="type23"]').click();
        await page.locator(".nav-scroll").evaluate((nav) => nav.scrollTo(0, 0));
        await page.locator('[data-nav="status"]').click();
        await page.locator('[data-nav="status"]').waitFor();
        const inView = await page.locator('[data-nav="status"]').evaluate((el) => {
          const nav = el.closest(".nav-scroll")!.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          return box.top >= nav.top && box.bottom <= nav.bottom;
        });
        expect(inView).toBe(true);

        // Collapse a group; it stays collapsed after a reload.
        const toggle = page.locator('.nav-group[data-group="Support"] .nav-group-toggle');
        await toggle.click();
        await page.locator('.nav-group[data-group="Support"] .nav-group-toggle[aria-expanded="false"]').waitFor();
        await page.locator('[data-nav="type02"]').waitFor({ state: "hidden" });
        await page.reload();
        await page.locator('[data-nav="type01"]').waitFor();
        await page.locator('.nav-group[data-group="Support"] .nav-group-toggle[aria-expanded="false"]').waitFor();
        const saved = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("bakorin.admin.nav.collapsed"))?.[1]);
        expect(saved).toBe('["Support"]');

        // The filter finds types in collapsed groups too, and Enter opens the first match.
        const filter = page.getByRole("searchbox", { name: "Filter data types" });
        await filter.fill("type 02");
        await page.locator('[data-nav="type02"]').waitFor();
        await page.locator('[data-nav="type01"]').waitFor({ state: "detached" });
        await filter.press("Enter");
        await page.locator('.nav [data-nav="type02"][aria-current="page"]').waitFor();
        await filter.fill("nothing like this");
        await page.getByText("No data types match").waitFor();
        await filter.press("Escape");
        await page.locator('[data-nav="type01"]').waitFor();

        // Phone width: the menu opens the sidebar, and its list still scrolls.
        await page.setViewportSize({ width: 375, height: 640 });
        await page.locator(".menu-btn").click();
        await page.locator(".sidebar.open").waitFor();
        await page.waitForTimeout(250);
        const phone = await page.evaluate(() => {
          const nav = document.querySelector(".nav-scroll")!;
          return { scroll: nav.scrollHeight, client: nav.clientHeight, docs: document.querySelector('[data-nav="docs"]')!.getBoundingClientRect().bottom };
        });
        expect(phone.scroll).toBeGreaterThan(phone.client);
        expect(phone.docs).toBeLessThanOrEqual(640);
      } finally {
        await browser.close();
        server.stop(true);
        await runtime.close?.();
      }
    },
    60_000,
  );
});
