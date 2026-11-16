import { chromium } from "playwright";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
const OUT = process.env.OUT ?? "/tmp/shots/out";
const ONLY = process.env.ONLY?.split(",");
const BRANDED = process.env.BRANDED === "1";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable" });
async function save(page, name, theme, clip) {
  const buf = await page.screenshot(clip ? { clip } : {});
  await sharp(buf).resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 82 }).toFile(`${OUT}/${name}-${theme}.webp`);
  console.log("wrote", `${name}-${theme}.webp`);
}
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.addInitScript((t) => localStorage.setItem("bakorin_theme", t), theme);
  const page = await ctx.newPage();
  const want = (n) => !ONLY || ONLY.includes(n);
  await page.goto("http://127.0.0.1:4371/admin/");
  await page.waitForSelector("input[type=email]");
  if (want("signin")) await save(page, BRANDED ? "admin-branded-signin" : "admin-signin", theme);
  await page.fill("input[type=email]", "avery@fernwood.example");
  await page.fill("input[type=password]", "demo-password-fernwood-1");
  await page.click("button[type=submit]");
  await page.waitForSelector('[data-nav="projects"]');
  await page.waitForTimeout(600);
  const nav = async (n) => { await page.click(`[data-nav="${n}"]`); await page.waitForTimeout(900); };
  if (BRANDED) {
    await nav("projects");
    await save(page, "admin-branded", theme);
    await ctx.close();
    continue;
  }
  if (want("status")) { await nav("status"); await save(page, "admin-status", theme); await page.getByText("Monitoring setup").scrollIntoViewIfNeeded(); await page.evaluate(() => { for (const el of document.querySelectorAll("*")) if (el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY !== "visible") el.scrollTop = el.scrollHeight; window.scrollTo(0, document.body.scrollHeight); }); await page.waitForTimeout(400); await save(page, "admin-monitoring", theme); }
  if (want("projects")) { await nav("projects"); await save(page, "admin-projects", theme); }
  if (want("editor")) {
    await nav("projects");
    await page.locator("tbody tr").filter({ hasText: "Online store rebuild" }).getByRole("button", { name: "Edit" }).click();
    await page.waitForTimeout(900);
    await save(page, "admin-editor", theme);
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  }
  if (want("users")) { await nav("users"); await save(page, "admin-users", theme); }
  if (want("files")) {
    await nav("clients");
    await page.locator("tbody tr").filter({ hasText: "Saltmarsh Bakery" }).getByRole("button", { name: "Edit" }).click();
    await page.waitForTimeout(1200);
    await save(page, "admin-files", theme);
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  }
  if (want("filespage")) {
    await nav("files");
    await page.waitForTimeout(600);
    await save(page, "admin-files-page", theme);
    await page.locator("tbody tr").filter({ hasText: "signage-moodboard.png" }).getByRole("button", { name: "Preview signage-moodboard.png" }).click();
    await page.waitForTimeout(800);
    await save(page, "admin-file-preview", theme);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  }
  if (want("mail")) { await nav("mail"); await page.waitForTimeout(800); await page.getByRole("button", { name: /project-shipped/ }).first().click().catch(() => page.getByText("project-shipped").first().click()); await page.waitForTimeout(1200); await page.evaluate(() => { for (const sel of document.querySelectorAll("select")) { const opt = [...sel.options].find((o) => o.textContent.includes("Annual report")); if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); } } }); await page.waitForTimeout(1200); await save(page, "admin-mail", theme); }
  if (want("webhooks")) { await nav("webhooks"); await save(page, "admin-webhooks", theme); }
  if (want("backups")) { await nav("backups"); await save(page, "admin-backups", theme); }
  if (want("audit")) { await nav("audit"); await save(page, "admin-audit", theme); }
  if (want("schema")) { await nav("schema"); await page.waitForTimeout(800); await save(page, "admin-schema", theme); }
  await ctx.close();
}
await browser.close();
