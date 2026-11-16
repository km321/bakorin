// Realtime load test: starts a real `bakorin start` server on a temp project,
// opens many SSE connections from worker processes, writes at a fixed rate, and
// reports delivery counts, latency percentiles, and server CPU and memory.
//
//   bun scripts/realtime-load/run.ts --connections 5000 --rate 50 --duration 30
//   bun scripts/realtime-load/run.ts --dialect postgres --database-url postgres://... --instances 2
//
// Flags:
//   --connections N    total SSE connections (default 2000)
//   --private-share F  share of connections on an owner only entity (default 0.2)
//   --users N          signed in users the connections are spread over (default 100)
//   --rate N           writes per second, split 80/20 public/private (default 50)
//   --duration S       seconds of writing (default 20)
//   --workers N        client processes (default 4)
//   --dialect          sqlite (default) or postgres
//   --database-url     Postgres URL (a fresh database is created and dropped)
//   --instances N      server processes (Postgres only; connections round robin)
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir, cpus, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { signAccessToken } from "../../packages/server/src/auth/jwt.ts";

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const connections = Number(flag("connections", "2000"));
const privateShare = Number(flag("private-share", "0.2"));
const userCount = Number(flag("users", "100"));
const rate = Number(flag("rate", "50"));
const duration = Number(flag("duration", "20"));
const workers = Number(flag("workers", "4"));
const dialect = flag("dialect", "sqlite");
const baseDatabaseUrl = flag("database-url", process.env.DATABASE_URL ?? "");
const instances = dialect === "postgres" ? Number(flag("instances", "1")) : 1;
const basePort = Number(flag("port", "4590"));
const repo = resolve(import.meta.dir, "../..");
const secret = "load-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const adminEmail = "load-admin@example.test";
const adminPassword = "load-test-password-123";

const dir = await mkdtemp(join(tmpdir(), "bakorin-load-"));
let databaseUrl = "";
if (dialect === "postgres") {
  const name = `bakorin_load_${Date.now()}`;
  const admin = new Bun.SQL(baseDatabaseUrl);
  await admin.unsafe(`create database ${name}`);
  await admin.close();
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${name}`;
  databaseUrl = url.toString();
}

const dbBlock =
  dialect === "postgres"
    ? `  dialect: postgres\n  postgres:\n    url: \${DATABASE_URL}\n`
    : `  dialect: sqlite\n  sqlite:\n    path: ./data/app.db\n`;
await writeFile(
  join(dir, "app.yaml"),
  `app:
  name: loadtest
runtime:
${dbBlock}  files:
    path: ./data/uploads
  cors:
    origins: [http://127.0.0.1]
  realtime:
    maxConnections: ${connections + 1000}
    maxPerUser: ${Math.min(10000, Math.ceil(connections / userCount) + 10)}
auth:
  entity: users
  adminRole: admin
entities:
  users:
    auth: true
    fields:
      email: { type: email, unique: true, required: true }
      password: { type: password, required: true }
      name: { type: text, required: true }
      role: { type: enum, values: [user, admin], default: user }
    policies:
      read: authenticated
      create: admin
      update: owner(id)
      delete: admin
  notes:
    realtime: true
    fields:
      body: { type: text, required: true }
      sentAt: { type: number }
    policies:
      read: public
      create: admin
      update: admin
      delete: admin
  tasks:
    realtime: true
    fields:
      title: { type: text, required: true }
      sentAt: { type: number }
      ownerId: { type: relation, to: users, required: true }
    policies:
      read: owner(ownerId)
      create: authenticated
      update: owner(ownerId)
      delete: owner(ownerId)
`,
);
await writeFile(join(dir, "hooks.ts"), "export default { entities: {} };\n");

const env = {
  ...process.env,
  JWT_SECRET: secret,
  DATABASE_URL: databaseUrl,
  BAKORIN_ADMIN_EMAIL: adminEmail,
  BAKORIN_ADMIN_PASSWORD: adminPassword,
  BAKORIN_ENV: "production",
  BAKORIN_TEST: "",
  METRICS_TOKEN: "load-metrics-token-0123456789",
};
delete (env as Record<string, string | undefined>).BAKORIN_TEST;

const children: Array<{ proc: ReturnType<typeof Bun.spawn>; lines: string[]; done?: Promise<void> }> = [];
const servers: Array<{ proc: ReturnType<typeof Bun.spawn>; port: number }> = [];
// Never leave servers or clients behind, even when the run fails.
process.on("exit", () => {
  for (const server of servers) server.proc.kill("SIGKILL");
  for (const child of children) child.proc.kill("SIGKILL");
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(1));
for (let i = 0; i < instances; i++) {
  const port = basePort + i;
  const busy = await fetch(`http://127.0.0.1:${port}/health`).then(
    () => true,
    () => false,
  );
  if (busy) throw new Error(`port ${port} is already in use; pass --port`);
  const proc = Bun.spawn([process.execPath, ...(process.env.LOAD_BUN_FLAGS ? process.env.LOAD_BUN_FLAGS.split(" ") : []), join(repo, "packages/server/src/cli.ts"), "start", "--dir", dir, "--port", String(port)], {
    env,
    // To a file: an unread pipe fills up and blocks the server's logging.
    stdout: Bun.file(join(dir, `server-${i}.log`)),
    stderr: Bun.file(join(dir, `server-${i}.log`)),
  });
  servers.push({ proc, port });
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
    } catch {}
    if (Date.now() > deadline) {
      console.error(await Bun.file(join(dir, `server-${i}.log`)).text());
      throw new Error("server did not start");
    }
    await Bun.sleep(200);
  }
}
const api = `http://127.0.0.1:${servers[0]!.port}`;

async function post(path: string, body: unknown, token: string) {
  const res = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return (await res.json()) as { data: Record<string, unknown> };
}

const login = await fetch(`${api}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: adminPassword }),
});
const adminToken = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;

// Owner only subscribers: real users, with access tokens signed the way the server signs them.
const users: string[] = [];
for (let i = 0; i < userCount; i++) {
  const created = await post("/api/v1/users", { email: `load${i}@example.test`, password: "password1234", name: `Load ${i}` }, adminToken);
  users.push(String(created.data.id));
}
const userTokens = await Promise.all(users.map((id) => signAccessToken({ sub: id, role: "user", ent: "users" }, secret, 3600)));

const privateConnections = Math.round(connections * privateShare);
const assignments: Array<{ entity: string; token: string | null; user?: number }> = [];
for (let i = 0; i < connections; i++) {
  if (i < privateConnections) {
    const user = i % userCount;
    assignments.push({ entity: "tasks", token: userTokens[user]!, user });
  } else {
    // Signed in readers of a public entity: they share one frame per event.
    assignments.push({ entity: "notes", token: userTokens[i % userCount]! });
  }
}
const connsPerUser = new Map<number, number>();
for (const a of assignments) if (a.user !== undefined) connsPerUser.set(a.user, (connsPerUser.get(a.user) ?? 0) + 1);
const publicConnections = connections - privateConnections;

// Spread connections over workers and (for Postgres) over server instances.
for (let w = 0; w < workers; w++) {
  const mine = assignments.filter((_, i) => i % workers === w);
  for (let s = 0; s < servers.length; s++) {
    const slice = mine.filter((_, i) => i % servers.length === s);
    const file = join(dir, `assign-${w}-${s}.json`);
    await Bun.write(file, JSON.stringify(slice.map(({ entity, token }) => ({ entity, token }))));
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "client.ts")], {
      env: { ...process.env, LOAD_PORT: String(servers[s]!.port), LOAD_ASSIGNMENTS: file },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const child: (typeof children)[number] = { proc, lines: [] as string[] };
    children.push(child);
    child.done = (async () => {
      const decoder = new TextDecoder();
      let rest = "";
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        rest += decoder.decode(chunk);
        const parts = rest.split("\n");
        rest = parts.pop()!;
        child.lines.push(...parts.filter(Boolean));
      }
      if (rest) child.lines.push(rest);
    })();
  }
}

const connectStart = Date.now();
console.error(`[load] ${servers.length} server(s) up, ${users.length} users, opening ${connections} streams`);
while (children.some((child) => !child.lines.some((line) => line.includes('"type":"connected"')))) {
  if (Date.now() - connectStart > 300_000) throw new Error("connect phase timed out");
  await Bun.sleep(200);
}
const connectSeconds = (Date.now() - connectStart) / 1000;
const connected = children
  .map((child) => JSON.parse(child.lines.find((line) => line.includes('"type":"connected"'))!) as { ready: number; failed: number; failures: Record<string, number> })
  .reduce((sum, item) => ({ ready: sum.ready + item.ready, failed: sum.failed + item.failed }), { ready: 0, failed: 0 });

function cpuTicks(pid: number): number {
  const stat = require("node:fs").readFileSync(`/proc/${pid}/stat`, "utf8") as string;
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return Number(fields[11]) + Number(fields[12]);
}
function rssMb(pid: number): number {
  const status = require("node:fs").readFileSync(`/proc/${pid}/status`, "utf8") as string;
  return Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
}
const rssAfterConnect = servers.map((s) => rssMb(s.proc.pid));
const ticksBefore = servers.map((s) => cpuTicks(s.proc.pid));
const writeStart = performance.now();

// Writer: fixed rate, 80% public notes, 20% private tasks for a random user.
let publicWrites = 0;
let privateWrites = 0;
let writeErrors = 0;
const privateByUser = new Map<number, number>();
const writeLatencies: number[] = [];
const total = Math.round(rate * duration);
const inflight: Promise<void>[] = [];
for (let i = 0; i < total; i++) {
  const due = writeStart + (i * 1000) / rate;
  const wait = due - performance.now();
  if (wait > 0) await Bun.sleep(wait);
  const isPrivate = i % 5 === 4;
  const sentAt = performance.timeOrigin + performance.now();
  const target = servers[i % servers.length]!.port;
  const user = Math.floor(Math.random() * userCount);
  const body = isPrivate ? { title: `Task ${i}`, sentAt, ownerId: users[user] } : { body: `Note ${i}`, sentAt };
  inflight.push(
    fetch(`http://127.0.0.1:${target}/api/v1/${isPrivate ? "tasks" : "notes"}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(body),
    }).then(
      async (res) => {
        await res.arrayBuffer();
        writeLatencies.push(performance.timeOrigin + performance.now() - sentAt);
        if (!res.ok) {
          writeErrors += 1;
          return;
        }
        if (isPrivate) {
          privateWrites += 1;
          privateByUser.set(user, (privateByUser.get(user) ?? 0) + 1);
        } else publicWrites += 1;
      },
      () => {
        writeErrors += 1;
      },
    ),
  );
}
await Promise.all(inflight);
console.error(`[load] writes done`);
const writeSeconds = (performance.now() - writeStart) / 1000;
await Bun.sleep(3000);
const ticksAfter = servers.map((s) => cpuTicks(s.proc.pid));
const rssEnd = servers.map((s) => rssMb(s.proc.pid));
const metrics = await (await fetch(`${api}/metrics`, { headers: { authorization: "Bearer load-metrics-token-0123456789" } })).text();

console.error(`[load] collecting results`);
// Ask each worker for its numbers over stdin (signals are unreliable across runtimes).
for (const child of children) {
  const stdin = child.proc.stdin as import("bun").FileSink;
  stdin.write("report\n");
  await stdin.flush();
}
await Promise.all(children.map((child) => child.proc.exited));
await Promise.race([Promise.all(children.map((child) => child.done)), Bun.sleep(2000)]);
const finals = children.map(
  (child) =>
    JSON.parse(child.lines.find((line) => line.includes('"type":"final"'))!) as {
      ready: number;
      failed: number;
      closed: number;
      events: number;
      histogram: Array<[number, number]>;
      connectP50: number;
      connectP99: number;
    },
);
const histogram = new Map<number, number>();
for (const final of finals) for (const [ms, n] of final.histogram) histogram.set(ms, (histogram.get(ms) ?? 0) + n);
const sorted = [...histogram].sort((a, b) => a[0] - b[0]);
const delivered = sorted.reduce((sum, [, n]) => sum + n, 0);
function percentile(p: number): number {
  let seen = 0;
  for (const [ms, n] of sorted) {
    seen += n;
    if (seen >= delivered * p) return ms;
  }
  return 0;
}
let expected = publicWrites * publicConnections;
for (const [user, writes] of privateByUser) expected += writes * (connsPerUser.get(user) ?? 0);
writeLatencies.sort((a, b) => a - b);

for (const server of servers) server.proc.kill("SIGTERM");
await Promise.all(servers.map((s) => s.proc.exited));
await rm(dir, { recursive: true, force: true });
if (dialect === "postgres") {
  const admin = new Bun.SQL(baseDatabaseUrl);
  await admin.unsafe(`drop database if exists ${new URL(databaseUrl).pathname.slice(1)} with (force)`);
  await admin.close();
}

const hz = 100;
const metric = (name: string) => metrics.split("\n").find((line) => line.startsWith(name))?.split(" ").at(-1) ?? "n/a";
console.log(
  JSON.stringify(
    {
      machine: { cpus: cpus().length, cpuModel: cpus()[0]?.model, memoryGb: Math.round(totalmem() / 1e9), bun: Bun.version },
      setup: { dialect, instances, connections, publicConnections, privateConnections, users: userCount, workers, rate, duration },
      connect: {
        seconds: connectSeconds,
        ready: connected.ready,
        failed: connected.failed,
        p50Ms: Math.round(Math.max(...finals.map((f) => f.connectP50))),
        p99Ms: Math.round(Math.max(...finals.map((f) => f.connectP99))),
      },
      writes: {
        publicWrites,
        privateWrites,
        writeErrors,
        achievedPerSecond: Number(((publicWrites + privateWrites) / writeSeconds).toFixed(1)),
        httpP50Ms: Math.round(writeLatencies[Math.floor(writeLatencies.length * 0.5)] ?? 0),
        httpP99Ms: Math.round(writeLatencies[Math.floor(writeLatencies.length * 0.99)] ?? 0),
      },
      delivery: {
        expected,
        delivered,
        deliveredPct: expected ? Number(((delivered / expected) * 100).toFixed(3)) : 0,
        perSecond: Math.round(delivered / writeSeconds),
        latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1)?.[0] ?? 0 },
        streamsClosedEarly: finals.reduce((sum, f) => sum + f.closed, 0),
      },
      server: {
        cpuPercentOfOneCoreDuringWrites: servers.map((_, i) => Math.round(((ticksAfter[i]! - ticksBefore[i]!) / hz / (writeSeconds + 3)) * 100)),
        rssMbAfterConnect: rssAfterConnect.map(Math.round),
        rssMbEnd: rssEnd.map(Math.round),
        droppedSlow: metric("bakorin_realtime_dropped_slow_total"),
        framesBuilt: metric("bakorin_realtime_frames_built_total"),
      },
    },
    null,
    2,
  ),
);
process.exit(0);
