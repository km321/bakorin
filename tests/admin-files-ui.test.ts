import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { boot, client, signupAndLogin } from "./helpers.ts";
import { FILES_YAML } from "./files-fixtures.ts";

/**
 * The admin record editor in a real browser: an existing file shows in the edit
 * form with a preview, Open, Download, Replace and Remove, and the Files page
 * links back to the record. Uses the system Chrome (CHROME_PATH, or the usual
 * install paths); skipped when there is none.
 */
const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(
  (path): path is string => Boolean(path && existsSync(path)),
);

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

describe.skipIf(!CHROME)("admin UI: file fields", () => {
  test(
    "an existing file shows in the edit form, and opens, downloads, replaces and removes",
    async () => {
      const { chromium } = await import("playwright");
      const runtime = await boot(FILES_YAML);
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
        const token = (
          await (
            await client(runtime).fetch("/api/v1/auth/login", {
              method: "POST",
              body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
            })
          ).json()
        ).data.accessToken as string;
        const api = client(runtime, token);
        const form = new FormData();
        form.set("file", new File([PDF], "brief.pdf", { type: "application/pdf" }));
        const file = (await (await api.fetch("/api/v1/files", { method: "POST", body: form })).json()).data as { id: string };
        const project = (
          await (await api.fetch("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Store rebuild", brief: file.id }) })).json()
        ).data as { id: string };
        const stored = async () => (await (await api.fetch(`/api/v1/projects/${project.id}`)).json()).data.brief as string | null;

        const context = await browser.newContext({ acceptDownloads: true });
        const page = await context.newPage();
        await page.goto(`${base}/admin/`);
        await page.fill("input[type=email]", "admin@example.com");
        await page.fill("input[type=password]", "password123");
        await page.click("button[type=submit]");
        await page.click('[data-nav="projects"]');
        const row = page.locator("tbody tr").filter({ hasText: "Store rebuild" });
        await row.getByRole("button", { name: "Edit" }).click();

        // The existing file is shown, not an empty picker.
        const card = page.locator('#bakorin-drawer [data-file-field="brief"] .file-card');
        // The card says "Loading file" until the file's details arrive; wait for the name.
        await card.filter({ hasText: "brief.pdf" }).waitFor();
        await expect(card.innerText()).resolves.toContain("brief.pdf");
        await expect(card.innerText()).resolves.toContain(`PDF, ${PDF.byteLength} B`);

        // Open shows it inline in a new tab, through a signed link.
        const [popup] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Open brief.pdf" }).click()]);
        await popup.waitForURL(/\/api\/v1\/files\//);
        expect(popup.url()).toContain(`/api/v1/files/${file.id}?exp=`);
        await popup.close();
        // Download saves it under its name.
        const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download brief.pdf" }).click()]);
        expect(download.suggestedFilename()).toBe("brief.pdf");

        // Replace with an image: the preview switches, and Save stores it.
        await page.setInputFiles('#bakorin-drawer [data-file-field="brief"] input[type=file]', {
          name: "cover.png",
          mimeType: "image/png",
          buffer: PNG,
        });
        await page.locator('#bakorin-drawer .file-card img[alt="Preview of cover.png"]').waitFor();
        await page.click("#bakorin-drawer button[type=submit]");
        await page.locator("#bakorin-drawer").waitFor({ state: "detached" });
        const replaced = await stored();
        expect(replaced).not.toBe(file.id);
        expect(replaced).toBeTruthy();

        // The list shows the file by name, with a thumbnail, through expand=brief.
        await row.locator(".file-chip").filter({ hasText: "cover.png" }).locator("img").waitFor();
        // Remove, then Save clears the field.
        await row.getByRole("button", { name: "Edit" }).click();
        await page.locator('#bakorin-drawer .file-card img[alt="Preview of cover.png"]').waitFor();
        await page.getByRole("button", { name: "Remove Brief" }).click();
        await page.locator("[data-file-pending]").waitFor();
        await page.click("#bakorin-drawer button[type=submit]");
        await page.locator("#bakorin-drawer").waitFor({ state: "detached" });
        expect(await stored()).toBeNull();

        // The Files page lists both uploads; the old PDF is now unused and links nowhere,
        // the image too. Attach it again and follow the link back to the record.
        await api.fetch(`/api/v1/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ brief: file.id }) });
        await page.click('[data-nav="files"]');
        const fileRow = page.locator("tbody tr").filter({ hasText: "brief.pdf" });
        await fileRow.getByRole("link", { name: "Project: Store rebuild" }).click();
        await page.locator('#bakorin-drawer [data-file-field="brief"] .file-card').filter({ hasText: "brief.pdf" }).waitFor();
        await page.keyboard.press("Escape");
        // The unused image can be deleted after a confirmation.
        await page.click('[data-nav="files"]');
        const imageRow = page.locator("tbody tr").filter({ hasText: "cover.png" });
        await imageRow.getByRole("button", { name: "Delete cover.png" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Delete file" }).click();
        await imageRow.waitFor({ state: "detached" });
        const audit = await runtime.db.selectFrom("_bakorin_audit").select("record_id").where("action", "=", "file_delete").execute();
        expect(audit.map((entry) => entry.record_id)).toEqual([replaced]);
        await context.close();
      } finally {
        await browser.close();
        server.stop(true);
        await runtime.close();
      }
    },
    60_000,
  );
});
