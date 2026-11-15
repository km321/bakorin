import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const PORT = 9334;
const BASE = "http://127.0.0.1:4321";
const OUT = "/opt/cursor/artifacts";
const EMAIL = `ada-${Date.now()}@studio.test`;

await mkdir(OUT, { recursive: true });

const chrome = spawn(
  "/usr/bin/google-chrome-stable",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=/tmp/bakorin-astro-chrome",
    "--window-size=1280,800",
    `${BASE}/signup`,
  ],
  { stdio: "ignore" },
);

async function waitCdp(): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
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

const ws = new WebSocket(await waitCdp());
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
await send("Page.navigate", { url: `${BASE}/signup` });
await Bun.sleep(800);

async function shot(name: string): Promise<void> {
  const result = (await send("Page.captureScreenshot", { format: "png" })) as { data: string };
  await Bun.write(`${OUT}/${name}`, Buffer.from(result.data, "base64"));
  console.log("wrote", name);
}

await shot("astro-signup.png");

await send("Runtime.evaluate", {
  expression: `
    document.querySelector('input[name=name]').value = 'Ada West';
    document.querySelector('input[name=email]').value = ${JSON.stringify(EMAIL)};
    document.querySelector('input[name=password]').value = 'password123';
    document.querySelector('form')?.requestSubmit();
  `,
});
await Bun.sleep(2000);
await shot("astro-app.png");

await send("Page.navigate", { url: `${BASE}/logout` });
await Bun.sleep(800);
await send("Page.navigate", { url: `${BASE}/login` });
await Bun.sleep(800);
await shot("astro-login.png");

await send("Runtime.evaluate", {
  expression: `
    document.querySelector('input[name=email]').value = ${JSON.stringify(EMAIL)};
    document.querySelector('input[name=password]').value = 'password123';
    document.querySelector('form')?.requestSubmit();
  `,
});
await Bun.sleep(2000);
await send("Runtime.evaluate", {
  expression: `
    const form = document.querySelector('form');
    const input = document.querySelector('input[name=title]');
    if (input && form) {
      input.value = 'Call Harbor Lights';
      form.requestSubmit();
    }
  `,
});
await Bun.sleep(1500);
await shot("astro-app.png");

ws.close();
chrome.kill();
console.log("done", EMAIL);
process.exit(0);
