import { chromium } from "playwright";
import sharp from "sharp";
const OUT = process.env.OUT ?? "/tmp/shots/out";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable" });
async function save(page, name, theme) {
  const buf = await page.screenshot();
  await sharp(buf).resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 82 }).toFile(`${OUT}/${name}-${theme}.webp`);
  console.log("wrote", name, theme);
}
for (const theme of ["light", "dark"]) {
  for (const who of ["avery@fernwood.example:demo-password-fernwood-1"]) {
    const [email, password] = who.split(":");
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
    await ctx.addInitScript((t) => localStorage.setItem("bakorin_theme", t), theme);
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:4371/admin/");
    await page.fill("input[type=email]", email);
    await page.fill("input[type=password]", password);
    await page.click("button[type=submit]");
    await page.waitForTimeout(2000);
    if (email.startsWith("juno")) { await save(page, "admin-admins-only", theme); await ctx.close(); continue; }
    await page.click('[data-nav="schema"]'); await page.waitForTimeout(1200);
    await page.mouse.click(773, 225);
    await page.waitForTimeout(800);
    await save(page, "admin-schema-panel", theme);
    await ctx.close();
  }
}
await browser.close();
