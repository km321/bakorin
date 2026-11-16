/**
 * End to end check of the create-bakorin templates against a real Bakorin.
 *
 *   bun scripts/e2e-templates/run.ts --template store --frontend next --dialect sqlite [--screenshots dir] [--keep]
 *
 * Scaffolds the template with the CLI (--sdk local), starts Bakorin with a seeded admin,
 * loads the template's example data with seed.ts, builds and starts the site, then
 * drives Chromium through the template's main flows. Runs axe (WCAG 2.2 AA rules) on
 * each page. The admin password is random and never printed.
 * Set E2E_CHROME to use an installed Chrome instead of Playwright's Chromium.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const ROOT = resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const TEMPLATES = ["blank", "auth-only", "blog", "marketing", "saas", "store"] as const;
type Template = (typeof TEMPLATES)[number];
const template = flag("--template", "blog") as Template;
const frontend = flag("--frontend", "astro") as "astro" | "next";
const dialect = flag("--dialect", "sqlite") as "sqlite" | "postgres";
const shots = flag("--screenshots");
const keep = args.includes("--keep");
if (!TEMPLATES.includes(template)) throw new Error(`--template must be one of ${TEMPLATES.join(", ")}`);
const children: ChildProcess[] = [];
const cleanups: (() => Promise<unknown> | unknown)[] = [];
const ADMIN_EMAIL = "admin@example.test";
let SITE = "";
const ADMIN_PASSWORD = `e2e-${crypto.randomUUID()}`;

function log(message: string) {
  console.log(`[e2e ${template}/${frontend}/${dialect}] ${message}`);
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
}

function start(name: string, command: string[], options: { cwd: string; env: Record<string, string | undefined> }) {
  const env = { ...process.env, ...options.env };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  const child = spawn(command[0]!, command.slice(1), { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const lines: string[] = [];
  const keepLine = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      // Never keep a line that could carry the admin password.
      if (line.trim()) lines.push(`[${name}] ${line.replaceAll(ADMIN_PASSWORD, "[redacted]")}`);
      if (lines.length > 300) lines.shift();
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
  return lines;
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
}

/** Waits until the page's forms are interactive (React hydrated, or the Astro element upgraded). */
async function ready(page: Page) {
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll("form.bk-form, .bk-table-wrap, .bk-dropzone, .bk-live-list")];
    return nodes.every((node) => Object.keys(node).some((key) => key.startsWith("__react")) || node.closest("[data-ready], bakorin-data-table, bakorin-live-list"));
  });
}

/** Visits a page, waits for it, and runs axe. */
async function visit(page: Page, path: string, label: string) {
  const response = await page.goto(path);
  check(response && response.status() < 400, `${path} answered ${response?.status()}`);
  await ready(page);
  await axe(page, label);
}

async function shot(page: Page, name: string, locator?: string) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  const path = join(shots, `${template}-${frontend}-${name}.png`);
  if (locator) await page.locator(locator).first().screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
  log(`screenshot ${path}`);
}

/** Every <img> on the page loaded (so file links work for this visitor). */
async function imagesLoaded(page: Page, label: string) {
  const images = page.locator("img.media");
  const count = await images.count();
  check(count > 0, `${label} should show images`);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>("img.media")].every((img) => img.complete && img.naturalWidth > 0), undefined, { timeout: 10_000 }).catch(() => {
    throw new Error(`check failed: images on ${label} did not load`);
  });
  const src = await images.first().getAttribute("src");
  check(src?.startsWith("/api/bakorin/files/"), `image links go through the site, got ${src}`);
  log(`${count} image(s) load on ${label}`);
}

async function signIn(page: Page, email: string, password: string, landing: string) {
  await page.goto("/login");
  await ready(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === landing, { timeout: 20_000 });
}

async function signUp(page: Page, email: string, name: string) {
  await page.goto("/signup");
  await ready(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").filter({ hasText: /check|email|account/i }).first().waitFor();
}

/** A small PNG for upload checks. */
function png(): Buffer {
  const width = 64;
  const height = 40;
  const raw = Buffer.alloc((width * 3 + 1) * height, 120);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Calls the API through the site's pass through route, as the context's visitor. */
async function apiStatus(context: BrowserContext, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await context.request.fetch(`/api/bakorin/${path}`, {
    method,
    data: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", origin: SITE },
  });
  return { status: response.status(), json: (await response.json().catch(() => null)) as { data?: Record<string, unknown> } | null };
}

async function main() {
  // 1. Scaffold with the CLI, like a user would.
  const project = await mkdtemp(join(tmpdir(), `bakorin-tpl-${template}-${frontend}-`));
  cleanups.push(() => (keep ? undefined : rm(project, { recursive: true, force: true })));
  await run(["bun", join(ROOT, "packages/create-bakorin/src/cli.ts"), "e2e", "--dir", project, "--frontend", frontend, "--template", template, "--sdk", "local", "--yes", "--force"], ROOT);
  if (dialect === "postgres") {
    const adminUrl = process.env.DATABASE_URL;
    check(adminUrl, "DATABASE_URL is needed for postgres");
    const { createPostgresDatabase, dropPostgresDatabase } = await import("@bakorin/server");
    const database = `tpl${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const url = await createPostgresDatabase(adminUrl, database);
    cleanups.push(() => dropPostgresDatabase(adminUrl, database).catch(() => undefined));
    const yaml = await readFile(join(project, "app.yaml"), "utf8");
    await writeFile(join(project, "app.yaml"), yaml.replace("dialect: sqlite", "dialect: postgres").replace("  sqlite:\n    path: ./data/app.db\n", `  postgres:\n    url: "${url}"\n`));
  }
  const apiPort = await freePort();
  const sitePort = await freePort();
  const site = `http://127.0.0.1:${sitePort}`;
  SITE = site;
  const api = `http://127.0.0.1:${apiPort}`;
  const adminEnv = { BAKORIN_ADMIN_EMAIL: ADMIN_EMAIL, BAKORIN_ADMIN_PASSWORD: ADMIN_PASSWORD, BAKORIN_ADMIN_NAME: "Site Admin" };
  const bakorin = start("bakorin", ["bun", join(ROOT, "packages/server/src/cli.ts"), "dev", "--dir", project], {
    cwd: ROOT,
    env: { PORT: String(apiPort), MAIL_DRIVER: "log", CORS_ORIGINS: site, JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(), ...adminEnv },
  });
  await waitFor(`${api}/api/v1/status/health`, "Bakorin", bakorin.lines);
  log(`Bakorin on ${api}`);

  // 2. The template's example data.
  if (await Bun.file(join(project, "seed.ts")).exists()) {
    await run(["bun", "seed.ts"], project, { BAKORIN_URL: api, ...adminEnv });
    // Running it twice adds nothing.
    const again = await run(["bun", "seed.ts"], project, { BAKORIN_URL: api, ...adminEnv });
    check(!again.some((line) => line.includes("Added ")), "seed.ts is safe to run twice");
    log("seed.ts loaded the example data (and a second run added nothing)");
  }

  // 3. The site.
  const web = join(project, "web");
  log("installing and building the site");
  await run(["bun", "install"], web);
  await run(frontend === "astro" ? ["npx", "astro", "build"] : ["npx", "next", "build"], web, { BAKORIN_URL: api, NEXT_TELEMETRY_DISABLED: "1" });
  const server =
    frontend === "astro"
      ? start("astro", ["node", "dist/server/entry.mjs"], { cwd: web, env: { HOST: "127.0.0.1", PORT: String(sitePort), BAKORIN_URL: api } })
      : start("next", ["npx", "next", "start", "-p", String(sitePort), "-H", "127.0.0.1"], { cwd: web, env: { BAKORIN_URL: api, NEXT_TELEMETRY_DISABLED: "1" } });
  await waitFor(`${site}/`, frontend, server.lines);
  log(`site on ${site}`);

  // 4. The browser.
  const browser: Browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined, args: ["--no-sandbox"] });
  cleanups.push(() => browser.close());
  const errors: string[] = [];
  const newContext = async () => {
    const context = await browser.newContext({ baseURL: site, viewport: { width: 1200, height: 900 } });
    context.on("page", (page) => {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !/status of 40[134]/.test(message.text())) console.error(`  [browser] ${message.text()}`);
      });
    });
    cleanups.push(() => context.close().catch(() => undefined));
    return context;
  };
  try {
    await FLOWS[template](newContext, site);
    check(errors.length === 0, `page errors: ${errors.join("; ")}`);
  } catch (error) {
    console.error(server.lines.slice(-60).join("\n"));
    console.error(bakorin.lines.slice(-30).join("\n"));
    throw error;
  }
}

type NewContext = () => Promise<BrowserContext>;

/** blank and auth-only: accounts and a protected page, and no leftover task pages. */
async function accountsFlow(newContext: NewContext) {
  const context = await newContext();
  const page = await context.newPage();
  failurePage = page;
  await visit(page, "/", "home");
  check((await page.getByText(/task/i).count()) === 0, "no task pages or links");
  await page.goto("/app");
  check(new URL(page.url()).pathname === "/login", "signed out /app goes to /login");
  check((await page.request.get("/app/tasks", { maxRedirects: 0 })).status() !== 200, "there is no /app/tasks page");
  const email = `reader-${Date.now()}@example.test`;
  await signUp(page, email, "Sam Example");
  await signIn(page, email, "password123", "/app");
  await page.getByRole("heading", { name: "Hello, Sam Example" }).waitFor();
  await axe(page, "account");
  await shot(page, "account");
  const admin = await (await newContext()).newPage();
  await signIn(admin, ADMIN_EMAIL, ADMIN_PASSWORD, "/app");
  await admin.getByText("You are an admin").waitFor();
  log("sign up, sign in, protected account page, admin banner");
}

async function blogFlow(newContext: NewContext) {
  const reader = await newContext();
  const page = await reader.newPage();
  failurePage = page;
  await visit(page, "/", "posts");
  await page.getByRole("link", { name: "Example post: Welcome to the blog" }).waitFor();
  await imagesLoaded(page, "posts");
  await shot(page, "posts");
  await page.getByRole("link", { name: "Example post: How posts are laid out" }).click();
  await page.waitForURL("**/posts/example-writing-tips");
  await axe(page, "post");
  await imagesLoaded(page, "post");
  await shot(page, "post");
  await page.getByRole("link", { name: "Example: Guides" }).click();
  await page.waitForURL("**/categories/example-guides");
  await axe(page, "category");
  check((await page.getByText("Example draft").count()) === 0, "drafts stay private");
  check((await apiStatus(reader, "GET", "drafts")).status === 401, "visitors cannot list drafts");
  check((await apiStatus(reader, "POST", "posts", { title: "x", slug: "x", body: "x", publishedOn: "2026-01-01" })).status === 401, "visitors cannot create posts");
  check((await page.getByRole("link", { name: "Create account" }).count()) === 0, "no sign up link (signup: invite)");
  await page.goto("/write");
  check(new URL(page.url()).pathname === "/login", "signed out /write goes to /login");
  log("public posts, images, categories; drafts and writing are private");

  const admin = await newContext();
  const writer = await admin.newPage();
  failurePage = writer;
  await signIn(writer, ADMIN_EMAIL, ADMIN_PASSWORD, "/");
  await visit(writer, "/write", "write");
  await writer.getByLabel("Title").fill("A post written in the e2e run");
  await writer.getByLabel("Slug").fill("e2e-post");
  await writer.getByLabel("Body").fill("First paragraph.\n\nSecond paragraph.");
  await writer.getByLabel("Category").selectOption({ label: "Example: News" });
  await writer.locator("input[type=file]").first().setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png() });
  await writer.locator(".bk-dropzone__status").filter({ hasText: "cover.png" }).first().waitFor();
  await writer.getByLabel("Cover description").fill("A gray test image");
  await shot(writer, "write");
  await writer.getByRole("button", { name: "Save draft" }).click();
  await writer.getByRole("link", { name: "A post written in the e2e run" }).waitFor({ timeout: 15_000 });
  await writer.getByRole("link", { name: "A post written in the e2e run" }).click();
  await writer.waitForURL(/\/write\/[^/]+$/);
  await ready(writer);
  await axe(writer, "edit draft");
  check((await page.request.get("/posts/e2e-post")).status() === 404, "a draft is not public");
  await writer.getByRole("button", { name: "Publish" }).click();
  await writer.waitForURL("**/posts/e2e-post");
  log("admin wrote a draft with a cover and published it");

  await page.goto("/posts/e2e-post");
  await page.getByRole("heading", { name: "A post written in the e2e run" }).waitFor();
  await imagesLoaded(page, "published post (signed out)");
  check((await page.locator(".prose p").count()) === 2, "blank lines make paragraphs");
  log("the published post and its cover are public");
}

async function marketingFlow(newContext: NewContext) {
  const visitor = await newContext();
  const page = await visitor.newPage();
  failurePage = page;
  await visit(page, "/", "home");
  await page.getByRole("heading", { level: 1, name: "Example headline for your company" }).waitFor();
  await shot(page, "home");
  await visit(page, "/about", "about");
  await page.getByRole("heading", { level: 1, name: "Example: About us" }).waitFor();
  await visit(page, "/contact", "contact");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText(/is required/).first().waitFor();
  await page.getByLabel("Your name").fill("Riley Visitor");
  await page.getByLabel("Email").fill("riley@example.test");
  await page.getByLabel("Message").fill("I would like a quote for a new website.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText("Thanks for your message").waitFor();
  await shot(page, "contact");
  check((await apiStatus(visitor, "GET", "leads")).status === 401, "visitors cannot read leads");
  log("contact form saved a lead; visitors cannot read leads");

  const admin = await newContext();
  const team = await admin.newPage();
  failurePage = team;
  await signIn(team, ADMIN_EMAIL, ADMIN_PASSWORD, "/app/leads");
  await ready(team);
  await team.getByRole("cell", { name: "riley@example.test" }).waitFor();
  await axe(team, "leads");
  await shot(team, "leads");
  log("admin sees the lead");
}

async function saasFlow(newContext: NewContext) {
  const memberContext = await newContext();
  const page = await memberContext.newPage();
  failurePage = page;
  await visit(page, "/", "welcome");
  const email = `member-${Date.now()}@example.test`;
  await signUp(page, email, "Morgan Member");
  await signIn(page, email, "password123", "/app");
  await page.getByRole("heading", { name: "Hello, Morgan Member" }).waitFor();
  await page.getByText("A manager or admin can change the rest").waitFor();
  await ready(page);
  await page.locator(".bk-live--open").first().waitFor({ timeout: 15_000 });
  await axe(page, "dashboard");
  check((await page.getByRole("link", { name: "Team", exact: true }).count()) === 0, "members do not see the Team link");

  // CRUD with the live table.
  await visit(page, "/app/projects", "projects");
  await page.getByLabel("Name").fill("Member project");
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("link", { name: "Member project" }).waitFor();
  check((await page.getByRole("button", { name: /^Delete / }).count()) === 0, "members get no delete buttons");
  await page.getByRole("link", { name: "Member project" }).click();
  await page.waitForURL(/\/app\/projects\/[^/]+$/);
  await ready(page);
  await axe(page, "project");
  await page.getByLabel("Status").selectOption("active");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL("**/app/projects");
  await ready(page);
  await page.getByRole("row").filter({ hasText: "Member project" }).getByText("active").waitFor();
  log("member created and edited a project; no delete for members");

  // A member cannot edit someone else's project (owner or manager rule).
  const others = await apiStatus(memberContext, "GET", `projects?${new URLSearchParams({ "filter[name]": "Example: Website refresh" })}`);
  const exampleId = (others.json as { data?: { id: string }[] } | null)?.data?.[0]?.id;
  check(exampleId, "the example project is visible to members");
  const patch = await memberContext.request.fetch(`/api/bakorin/projects/${exampleId}`, { method: "PATCH", data: JSON.stringify({ status: "done" }), headers: { "content-type": "application/json", origin: SITE } });
  check(patch.status() === 403 || patch.status() === 404, `members cannot edit others' projects, got ${patch.status()}`);

  // Live list: an update posted in one tab shows in another.
  const other = await memberContext.newPage();
  await other.goto("/app");
  await ready(other);
  await other.locator(".bk-live--open").first().waitFor({ timeout: 15_000 });
  await page.goto("/app");
  await ready(page);
  await page.locator("input[name=message]").fill("Shipped the member project draft");
  await page.getByRole("button", { name: "Post update" }).click();
  await other.locator(".bk-list").getByText("Shipped the member project draft").waitFor({ timeout: 10_000 });
  await shot(other, "dashboard");
  log("live list updated in another tab");

  const team = await memberContext.newPage();
  await team.goto("/app/team");
  await team.getByText("Only admins can see the team list.").waitFor();

  // Admins: Team page and delete buttons.
  const adminContext = await newContext();
  const admin = await adminContext.newPage();
  failurePage = admin;
  await signIn(admin, ADMIN_EMAIL, ADMIN_PASSWORD, "/app");
  await visit(admin, "/app/team", "team");
  await admin.getByRole("cell", { name: email }).waitFor();
  await visit(admin, "/app/projects", "projects (admin)");
  await admin.getByRole("button", { name: "Delete Member project" }).waitFor();
  await shot(admin, "projects");
  log("admin sees the team and can delete projects");
}

async function storeFlow(newContext: NewContext) {
  const shopperContext = await newContext();
  const page = await shopperContext.newPage();
  failurePage = page;
  await visit(page, "/", "shop");
  await imagesLoaded(page, "shop");
  check((await page.getByText("Price not set").count()) === 3, "example products have no prices");
  await shot(page, "shop");
  await page.getByRole("link", { name: "Example product: Mug" }).click();
  await page.waitForURL("**/products/example-mug");
  await axe(page, "product");
  await page.getByRole("link", { name: "Sign in" }).first().waitFor();
  await page.goto("/cart");
  check(new URL(page.url()).pathname === "/login", "signed out /cart goes to /login");

  const email = `shopper-${Date.now()}@example.test`;
  await signUp(page, email, "Casey Shopper");
  await signIn(page, email, "password123", "/");
  await page.goto("/products/example-tote");
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForURL("**/cart");
  await page.getByRole("link", { name: "Example product: Canvas tote" }).waitFor();
  await axe(page, "cart");
  await shot(page, "cart");
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/checkout\/[^/]+$/);
  for (let i = 0; i < 10 && (await page.getByText("Adding up your order").count()) > 0; i++) {
    await Bun.sleep(300);
    await page.reload();
  }
  await page.getByText("Payments are not connected yet.", { exact: true }).waitFor();
  await page.getByRole("cell", { name: "Example product: Canvas tote" }).waitFor();
  await axe(page, "checkout");
  await shot(page, "checkout");
  log("added to the cart, placed an order, and saw the payment placeholder");

  // An admin sets a price; the next order uses it. Shoppers cannot set totals or status.
  const adminContext = await newContext();
  const admin = await adminContext.newPage();
  failurePage = admin;
  await signIn(admin, ADMIN_EMAIL, ADMIN_PASSWORD, "/");
  await visit(admin, "/manage", "manage");
  await shot(admin, "manage");
  await admin.getByRole("link", { name: "Example product: Mug" }).click();
  await admin.waitForURL(/\/manage\/[^/]+$/);
  await ready(admin);
  await axe(admin, "edit product");
  await admin.getByLabel("Price in cents").fill("1000");
  await admin.getByRole("button", { name: "Save changes" }).click();
  await admin.waitForURL("**/manage");
  log("admin set a test price");

  failurePage = page;
  await page.goto("/products/example-mug");
  await page.getByLabel("Quantity").fill("3");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForURL("**/cart");
  await page.getByText("Total: $30.00").waitFor();
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/checkout\/[^/]+$/);
  for (let i = 0; i < 10 && (await page.getByText("Adding up your order").count()) > 0; i++) {
    await Bun.sleep(300);
    await page.reload();
  }
  await page.getByText("Total: $30.00").waitFor();
  const cheat = await apiStatus(shopperContext, "POST", "orders", { status: "paid", totalCents: 1, lines: "[]" });
  check(cheat.status === 403, `shoppers cannot set an order's status or total, got ${cheat.status}`);
  const orders = await shopperContext.request.get("/api/bakorin/orders?sort=-createdAt&limit=1");
  const latest = ((await orders.json()) as { data: { totalCents?: number; id: string }[] }).data[0]!;
  check(latest.totalCents === 3000, `the server sets the total from the cart, got ${latest.totalCents}`);
  await visit(page, "/orders", "orders");
  await page.getByRole("cell", { name: "$30.00" }).waitFor();
  await page.goto("/cart");
  await page.getByText("Your cart is empty").waitFor();
  log("the server computed the order total; the cart was emptied");

  const strangerContext = await newContext();
  const stranger = await strangerContext.newPage();
  const strangerEmail = `other-${Date.now()}@example.test`;
  await signUp(stranger, strangerEmail, "Other Shopper");
  await signIn(stranger, strangerEmail, "password123", "/");
  check((await strangerContext.request.get(`/api/bakorin/orders/${latest.id}`)).status() >= 403, "orders are private to their shopper");
}

const FLOWS: Record<Template, (newContext: NewContext, site: string) => Promise<void>> = {
  blank: accountsFlow,
  "auth-only": accountsFlow,
  blog: blogFlow,
  marketing: marketingFlow,
  saas: saasFlow,
  store: storeFlow,
};

let failurePage: Page | undefined;
let failed = false;
try {
  await main();
  log("all checks passed");
} catch (error) {
  failed = true;
  console.error(String(error instanceof Error ? error.stack ?? error.message : error).replaceAll(ADMIN_PASSWORD, "[redacted]"));
  if (failurePage) {
    const path = join(tmpdir(), `bakorin-tpl-${template}-${frontend}-${dialect}-failure.png`);
    await failurePage.screenshot({ path, fullPage: true }).catch(() => undefined);
    console.error(`failure screenshot: ${path} (url ${failurePage.url()})`);
  }
} finally {
  for (const child of children) child.kill("SIGTERM");
  for (const cleanup of cleanups.reverse()) await cleanup();
}
process.exit(failed ? 1 : 0);
