#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { boot, client } from "../tests/helpers.ts";

const PORT = 4391;
const runtime = await boot();
const signup = await client(runtime).fetch("/api/v1/auth/signup", {
  method: "POST",
  body: JSON.stringify({ email: "bench@example.com", password: "password123", name: "Bench" }),
});
const json = (await signup.json()).data as { accessToken: string };
await client(runtime, json.accessToken).fetch("/api/v1/items", {
  method: "POST",
  body: JSON.stringify({ title: "seed" }),
});

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: runtime.app.fetch,
});
console.log(`bench server http://127.0.0.1:${PORT}`);

async function runScenario(scenario: "list" | "get" | "create", rate: number) {
  const out = join(import.meta.dir, `../bench/k6-${scenario}.json`);
  const proc = Bun.spawn(
    ["k6", "run", "--summary-export", out, join(import.meta.dir, "../bench/k6-crud.js")],
    {
      env: {
        ...process.env,
        BASE_URL: `http://127.0.0.1:${PORT}`,
        ACCESS_TOKEN: json.accessToken,
        SCENARIO: scenario,
        RATE: String(rate),
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`k6 ${scenario} exited ${code}`);
  }
  const summary = JSON.parse(await Bun.file(out).text()) as {
    metrics: Record<string, { count?: number; rate?: number; "p(95)"?: number; values?: Record<string, number> }>;
  };
  const reqs = summary.metrics.http_reqs ?? {};
  const duration = summary.metrics.http_req_duration ?? {};
  return {
    scenario,
    rate,
    count: reqs.count ?? reqs.values?.count ?? 0,
    rps: reqs.rate ?? reqs.values?.rate ?? 0,
    p95: duration["p(95)"] ?? duration.values?.["p(95)"] ?? 0,
  };
}

const results = [
  await runScenario("list", 40),
  await runScenario("get", 40),
  await runScenario("create", 20),
];

const lines = [
  "# SQLite k6 baseline",
  "",
  `Measured locally on ${new Date().toISOString().slice(0, 10)} against SQLite (this repo's MINI_YAML fixture) at http://127.0.0.1:${PORT}.`,
  "k6 constant-arrival-rate, 15s per scenario. Re-run with `bun scripts/bench-sqlite.ts`. Do not invent replacements.",
  "",
  "| Operation | configured arrival/s | http requests | measured req/s | p95 (ms) |",
  "|---|---|---|---|---|",
  ...results.map(
    (row) =>
      `| ${row.scenario} | ${row.rate} | ${row.count} | ${row.rps.toFixed(1)} | ${row.p95.toFixed(1)} |`,
  ),
  "",
];
await mkdir(join(import.meta.dir, "../bench"), { recursive: true });
await writeFile(join(import.meta.dir, "../bench/baseline.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
server.stop();
await runtime.close();
