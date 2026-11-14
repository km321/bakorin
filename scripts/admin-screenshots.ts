import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const PORT = 9333;
const BASE = "http://127.0.0.1:4371";
const OUT = "/opt/cursor/artifacts";

await mkdir(OUT, { recursive: true });

const chrome = spawn(
  "/usr/bin/google-chrome-stable",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=/tmp/bakorin-chrome",
    "--window-size=1280,800",
    `${BASE}/admin/`,
  ],
  { stdio: "ignore" },
);

async function waitCdp(): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl: string; url: string }>;
      const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      // not ready
    }
    await Bun.sleep(250);
  }
  throw new Error("cdp not ready");
}

const wsUrl = await waitCdp();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

let seq = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
  if (msg.id !== undefined) {
    const waiter = pending.get(msg.id);
    if (!waiter) {
      return;
    }
    pending.delete(msg.id);
    if (msg.error) {
      waiter.reject(new Error(msg.error.message));
    } else {
      waiter.resolve(msg.result);
    }
  }
});

function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  seq += 1;
  const id = seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: `${BASE}/admin/` });
await Bun.sleep(1200);

async function shot(name: string): Promise<void> {
  const result = (await send("Page.captureScreenshot", { format: "png" })) as { data: string };
  await Bun.write(`${OUT}/${name}`, Buffer.from(result.data, "base64"));
  console.log("wrote", name);
}

await shot("admin-login.png");

await send("Runtime.evaluate", {
  expression: `
    const email = document.querySelector('input[name=email], input[type=email]');
    const password = document.querySelector('input[name=password], input[type=password]');
    email.value = 'ada@studio.test';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    password.value = 'password123';
    password.dispatchEvent(new Event('input', { bubbles: true }));
  `,
});
await Bun.sleep(400);
await send("Runtime.evaluate", {
  expression: `document.querySelector('form')?.requestSubmit();`,
});
await Bun.sleep(2000);
await shot("admin-leads.png");

await send("Runtime.evaluate", {
  expression: `
    const buttons = [...document.querySelectorAll('button')];
    const leads = buttons.find((b) => b.textContent?.trim() === 'Leads');
    leads?.click();
  `,
});
await Bun.sleep(800);
await shot("admin-leads.png");

await send("Runtime.evaluate", {
  expression: `document.getElementById('bakorin-new')?.click();`,
});
await Bun.sleep(800);
await shot("admin-drawer.png");

await send("Runtime.evaluate", {
  expression: `
    const labels = [...document.querySelectorAll('.field')];
    function setField(name, value) {
      const field = labels.find((el) => el.querySelector('label')?.textContent?.toLowerCase().includes(name));
      const input = field?.querySelector('input,select,textarea');
      if (!input) return;
      if (input.tagName === 'SELECT') {
        input.value = value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    function pickFirst(name) {
      const field = labels.find((el) => el.querySelector('label')?.textContent?.toLowerCase().includes(name));
      const select = field?.querySelector('select');
      const option = [...(select?.options ?? [])].find((item) => item.value);
      if (select && option) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    setField('company', 'Harbor Lights');
    setField('contact', 'Maya Chen');
    setField('email', 'maya@harbor.test');
    setField('status', 'new');
    pickFirst('owner');
    document.getElementById('bakorin-drawer')?.requestSubmit();
  `,
  awaitPromise: true,
});
await Bun.sleep(1800);
await shot("admin-leads-saved.png");

await send("Runtime.evaluate", {
  expression: `document.querySelector('.drawer-backdrop')?.click();`,
});
await Bun.sleep(400);
await send("Runtime.evaluate", {
  expression: `document.querySelector('[data-nav="tasks"]')?.click();`,
});
await Bun.sleep(800);
await shot("admin-tasks.png");

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await Bun.sleep(400);
await shot("admin-mobile.png");

ws.close();
chrome.kill();
console.log("done");
process.exit(0);
