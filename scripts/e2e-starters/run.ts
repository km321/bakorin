/**
 * End to end check of the Astro and Next.js starters against a real Bakorin.
 *
 *   bun scripts/e2e-starters/run.ts --frontend astro --dialect sqlite [--screenshots dir] [--keep]
 *
 * Starts Bakorin with the todo schema, builds and starts the starter, then drives
 * Chromium through sign up, sign in, the protected pages, CRUD, realtime, uploads,
 * sign out, and a no JavaScript sign in. Runs axe (WCAG 2.2 AA rules) on each page.
 * Set E2E_CHROME to use an installed Chrome instead of Playwright's Chromium.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { navReport } from "../e2e-shared/nav.ts";
import { chromium, type Browser, type Page } from "playwright";

const ROOT = resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const frontend = flag("--frontend", "astro") as "astro" | "next";
const dialect = flag("--dialect", "sqlite") as "sqlite" | "postgres";
const shots = flag("--screenshots");
const keep = args.includes("--keep");
const children: ChildProcess[] = [];
const cleanups: (() => Promise<unknown> | unknown)[] = [];

function log(message: string) {
  console.log(`[e2e ${frontend}/${dialect}] ${message}`);
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
}

function start(name: string, command: string[], options: { cwd: string; env: Record<string, string | undefined> }) {
  const child = spawn(command[0]!, command.slice(1), { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
  const lines: string[] = [];
  const keepLine = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) lines.push(`[${name}] ${line}`);
      if (lines.length > 200) lines.shift();
    }
  };
  child.stdout!.on("data", keepLine);
  child.stderr!.on("data", keepLine);
  children.push(child);
  return { child, lines };
}

async function run(command: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const { child, lines } = start(command.join(" "), command, { cwd, env });
  const code = await new Promise<number>((done) => child.on("exit", (c) => done(c ?? 1)));
  if (code !== 0) {
    console.error(lines.join("\n"));
    throw new Error(`${command.join(" ")} failed with ${code}`);
  }
}

async function waitFor(url: string, what: string, logs: string[], timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(300);
  }
  console.error(logs.join("\n"));
  throw new Error(`${what} did not start at ${url}`);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const require = createRequire(import.meta.url);
const AXE = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");

async function axe(page: Page, label: string) {
  await page.addScriptTag({ content: AXE });
  const result = (await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe.run;
    return run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
  })) as { violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] };
  if (result.violations.length) {
    for (const v of result.violations) console.error(`  axe ${label}: ${v.id} (${v.impact}) ${v.help} at ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    throw new Error(`axe found ${result.violations.length} WCAG problem(s) on ${label}`);
  }
  log(`axe clean: ${label}`);
  await navCheck(page, label);
}

let mobileHeaderSaved = false;

/** At phone width (375px) the page fits: nothing makes it scroll sideways. */
async function noSidewaysScroll(page: Page, label: string) {
  const size = page.viewportSize();
  if (!size) return;
  await page.setViewportSize({ width: 375, height: 800 });
  try {
    const wide = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= limit + 1) return null;
      // Name the widest culprit so the failure says what to fix.
      let worst = "";
      let right = limit;
      for (const el of document.body.querySelectorAll("*")) {
        const r = el.getBoundingClientRect().right;
        if (r > right + 1) {
          right = r;
          worst = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : "");
        }
      }
      return `${document.documentElement.scrollWidth}px wide (limit ${limit}px), widest: ${worst || "unknown"} to ${right.toFixed(0)}px`;
    });
    check(wide === null, `${label} scrolls sideways at 375px: ${wide}`);
  } finally {
    await page.setViewportSize(size);
  }
}

/** The header lines up at desktop width and at phone width (where it may wrap). */
async function navCheck(page: Page, label: string) {
  await noSidewaysScroll(page, label);
  if ((await page.locator(".site-header nav").count()) === 0) return;
  const desktop = await navReport(page);
  check(desktop.ok, `header lines up on ${label}: ${desktop.detail}`);
  const size = page.viewportSize();
  if (!size) return;
  await page.setViewportSize({ width: 375, height: 800 });
  try {
    const phone = await navReport(page);
    check(phone.ok, `header lines up on ${label} at 375px: ${phone.detail}`);
    if (shots && !mobileHeaderSaved) {
      mobileHeaderSaved = true;
      await mkdir(shots, { recursive: true });
      await page.locator(".site-header").first().screenshot({ path: join(shots, `${frontend}-header-mobile.png`) });
    }
  } finally {
    await page.setViewportSize(size);
  }
  log(`header lines up: ${label}`);
}

/** Waits until the page's forms are interactive (React hydrated, or the Astro element upgraded). */
async function ready(page: Page) {
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll("form.bk-form, .bk-table-wrap, .bk-dropzone, .bk-live-list")];
    return nodes.every((node) => Object.keys(node).some((key) => key.startsWith("__react")) || node.closest("[data-ready], bakorin-data-table, bakorin-live-list"));
  });
}

async function shot(page: Page, name: string, locator?: string) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  const path = join(shots, `${frontend}-${name}.png`);
  if (locator) await page.locator(locator).first().screenshot({ path });
  else {
    await page.screenshot({ path, fullPage: true });
    const size = page.viewportSize();
    if (size) {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.screenshot({ path: path.replace(/\.png$/, "-mobile.png"), fullPage: true });
      await page.setViewportSize(size);
    }
    if ((await page.locator(".site-header").count()) > 0) await page.locator(".site-header").first().screenshot({ path: path.replace(/\.png$/, "-header.png") });
  }
  log(`screenshot ${path}`);
}

async function main() {
  // 1. Bakorin with the todo schema.
  const project = await mkdtemp(join(tmpdir(), `bakorin-e2e-${frontend}-`));
  cleanups.push(() => (keep ? undefined : rm(project, { recursive: true, force: true })));
  let yaml = (await readFile(join(ROOT, "packages/create-bakorin/templates/schemas/todo.yaml"), "utf8")).replaceAll("{{APP_NAME}}", "e2e");
  if (dialect === "postgres") {
    const adminUrl = process.env.DATABASE_URL;
    check(adminUrl, "DATABASE_URL is needed for postgres");
    const { createPostgresDatabase, dropPostgresDatabase } = await import("@bakorin/server");
    const database = `e2e${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const url = await createPostgresDatabase(adminUrl, database);
    cleanups.push(() => dropPostgresDatabase(adminUrl, database).catch(() => undefined));
    yaml = yaml.replace("dialect: sqlite", "dialect: postgres").replace("  sqlite:\n    path: ./data/app.db\n", `  postgres:\n    url: "${url}"\n`);
  }
  await writeFile(join(project, "app.yaml"), yaml);
  await writeFile(join(project, "hooks.ts"), "export default { entities: {} };\n");
  const apiPort = await freePort();
  const sitePort = await freePort();
  const site = `http://127.0.0.1:${sitePort}`;
  const api = `http://127.0.0.1:${apiPort}`;
  const bakorin = start("bakorin", ["bun", join(ROOT, "packages/server/src/cli.ts"), "dev", "--dir", project], {
    cwd: ROOT,
    env: { PORT: String(apiPort), MAIL_DRIVER: "log", CORS_ORIGINS: site, BAKORIN_ADMIN_EMAIL: undefined, BAKORIN_ADMIN_PASSWORD: undefined },
  });
  await waitFor(`${api}/api/v1/status/health`, "Bakorin", bakorin.lines);
  log(`Bakorin on ${api}`);

  // 2. The starter.
  const web = join(ROOT, "examples", `${frontend}-starter`);
  if (!args.includes("--no-build")) {
    log("building the starter");
    await run(frontend === "astro" ? ["npx", "astro", "build"] : ["npx", "next", "build"], web, { BAKORIN_URL: api, NEXT_TELEMETRY_DISABLED: "1", SITE_URL: site });
  }
  const server =
    frontend === "astro"
      ? start("astro", ["node", "dist/server/entry.mjs"], { cwd: web, env: { HOST: "127.0.0.1", PORT: String(sitePort), BAKORIN_URL: api } })
      : start("next", ["npx", "next", "start", "-p", String(sitePort), "-H", "127.0.0.1"], { cwd: web, env: { BAKORIN_URL: api, NEXT_TELEMETRY_DISABLED: "1" } });
  await waitFor(`${site}/`, frontend, server.lines);
  log(`site on ${site}`);

  // 3. The browser.
  const browser: Browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined, args: ["--no-sandbox"] });
  cleanups.push(() => browser.close());
  try {
    await flows(browser, site, server.lines.concat(bakorin.lines));
  } catch (error) {
    console.error(server.lines.slice(-60).join("\n"));
    console.error(bakorin.lines.slice(-30).join("\n"));
    throw error;
  }
}

async function flows(browser: Browser, site: string, logs: string[]) {
  const context = await browser.newContext({ baseURL: site, viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`  [browser] ${message.text()}`);
  });
  failurePage = page;
  const email = `kit-${Date.now()}@example.test`;

  // Protected pages send you to sign in.
  await page.goto("/app");
  check(new URL(page.url()).pathname === "/login", `signed out /app should land on /login, got ${page.url()}`);
  log("protected page redirects to /login");

  // Sign up.
  await page.goto("/signup");
  await ready(page);
  await axe(page, "sign up");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("Email is required").waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill("Kit Example");
  // Editing a field clears its message; untouched fields keep theirs.
  await page.getByText("Email is required").waitFor({ state: "hidden" });
  await page.getByText("Name is required").waitFor({ state: "hidden" });
  check(await page.getByText("Password is required").isVisible(), "the password message should stay until it is edited");
  await shot(page, "sign-up", "form.bk-form");
  await page.getByLabel("Password").fill("password123");
  await page.getByText("Password is required").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").filter({ hasText: /check|email|account/i }).first().waitFor();
  log("signed up");

  // Sign in, with a wrong password first.
  await page.goto("/login");
  await ready(page);
  await axe(page, "sign in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("alert").filter({ hasText: /./ }).first().waitFor();
  await shot(page, "sign-in-error", "form.bk-form");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app");
  await page.getByRole("heading", { name: "Hello, Kit Example" }).waitFor();
  const cookies = await context.cookies();
  check(cookies.find((c) => c.name === "bakorin_access")?.httpOnly, "access cookie is httpOnly");
  check(!(await page.evaluate(() => document.cookie)).includes("bakorin_"), "no session cookie visible to scripts");
  log("signed in; session is httpOnly");
  await page.locator(".bk-live--open").first().waitFor({ timeout: 15_000 });
  await axe(page, "dashboard");

  // CRUD on the tasks page.
  await page.goto("/app/tasks");
  await ready(page);
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByText(/is required/).first().waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-invalid") === "true", undefined, { timeout: 3000 }).catch(() => {
    throw new Error("check failed: focus moves to the invalid field");
  });
  for (const title of ["Write the launch post", "Book the venue", "Order stickers"]) {
    await page.getByLabel("New task").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await page.getByRole("cell", { name: title, exact: true }).waitFor();
  }
  log("created 3 tasks");
  const toggled = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/tasks/"));
  await page.getByRole("checkbox", { name: "Done: Book the venue" }).check();
  check((await toggled).ok(), "the toggle request succeeded");
  await page.reload();
  await ready(page);
  check(await page.getByRole("checkbox", { name: "Done: Book the venue" }).isChecked(), "toggle persisted");
  log("toggled a task and it persisted");
  await axe(page, "tasks");
  await shot(page, "tasks");
  await shot(page, "data-table", ".bk-table-wrap");
  await shot(page, "record-form", "form.bk-record-form");
  page.once("dialog", (dialog) => void dialog.accept());
  // The row goes away at once (optimistic); wait for the API to confirm before reloading.
  const deleted = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("/tasks/"));
  await page.getByRole("button", { name: "Delete Order stickers" }).click();
  await page.getByRole("cell", { name: "Order stickers", exact: true }).waitFor({ state: "detached" });
  check((await deleted).ok(), "the delete request succeeded");
  await page.reload();
  check((await page.getByRole("cell", { name: "Order stickers", exact: true }).count()) === 0, "delete persisted");
  log("deleted a task");

  // Realtime: a second tab sees a new task without reloading.
  const other = await context.newPage();
  await other.goto("/app");
  await ready(other);
  await other.locator(".bk-live--open").first().waitFor({ timeout: 15_000 });
  await page.getByLabel("New task").fill("Seen in the other tab");
  await page.getByRole("button", { name: "Add task" }).click();
  await other.locator(".bk-list").getByText("Seen in the other tab").waitFor({ timeout: 10_000 });
  log("realtime list updated in another tab");
  await shot(other, "live-list", ".bk-live-list");

  // Upload through the pass through route.
  await other.locator("input[type=file]").first().setInputFiles({ name: "hello.txt", mimeType: "text/plain", buffer: Buffer.from("hello from e2e") });
  await other.getByText("hello.txt").waitFor();
  const href = await other.locator(".bk-dropzone__status a").getAttribute("href");
  check(href?.startsWith("/api/bakorin/files/"), `signed link goes through the site, got ${href}`);
  const download = await context.request.get(href!);
  check((await download.text()) === "hello from e2e", "download returns the file");
  await shot(other, "file-upload", ".bk-dropzone");
  log("uploaded a file and downloaded it through the site");

  // The user menu signs out.
  await other.close();
  await page.goto("/app");
  await ready(page);
  const menu = page.locator(".bk-user-menu").first();
  await menu.locator(".bk-user-menu__button").click();
  if (shots) {
    const button = (await menu.locator(".bk-user-menu__button").boundingBox())!;
    const panel = (await menu.locator(".bk-user-menu__panel").boundingBox())!;
    const x = Math.min(button.x, panel.x) - 16;
    const y = button.y - 12;
    await page.screenshot({
      path: join(shots, `${frontend}-user-menu.png`),
      clip: { x, y, width: Math.max(button.x + button.width, panel.x + panel.width) - x + 16, height: panel.y + panel.height - y + 16 },
    });
  }
  await menu.getByRole("link", { name: "Sign out" }).or(menu.getByRole("button", { name: "Sign out" })).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/login");
  await page.goto("/app");
  check(new URL(page.url()).pathname === "/login", "signed out after the menu");
  log("signed out from the user menu");

  // Sign in with JavaScript off (the form posts to the page).
  if (frontend === "astro") {
    const noJs = await browser.newContext({ baseURL: site, javaScriptEnabled: false });
    const plain = await noJs.newPage();
    await plain.goto("/login");
    await plain.getByLabel("Email").fill(email);
    await plain.getByLabel("Password").fill("password123");
    await plain.getByRole("button", { name: "Sign in" }).click();
    await plain.waitForURL("**/app");
    await plain.goto("/app/tasks");
    await plain.getByLabel("New task").fill("Added without JavaScript");
    await plain.getByRole("button", { name: "Add task" }).click();
    await plain.getByRole("cell", { name: "Added without JavaScript", exact: true }).waitFor();
    await noJs.close();
    log("sign in and create work without JavaScript");
  }

  check(errors.length === 0, `page errors: ${errors.join("; ")}`);
  void logs;
  await context.close();
}

let failurePage: Page | undefined;
let failed = false;
try {
  await main();
  log("all checks passed");
} catch (error) {
  failed = true;
  console.error(error);
  if (failurePage) {
    const path = join(tmpdir(), `bakorin-e2e-${frontend}-${dialect}-failure.png`);
    await failurePage.screenshot({ path, fullPage: true }).catch(() => undefined);
    console.error(`failure screenshot: ${path}`);
    console.error((await failurePage.content().catch(() => "")).slice(0, 4000));
  }
} finally {
  for (const child of children) child.kill("SIGTERM");
  for (const cleanup of cleanups.reverse()) await cleanup();
}
process.exit(failed ? 1 : 0);
