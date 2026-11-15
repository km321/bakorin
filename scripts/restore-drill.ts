#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { runBackup, restoreSqliteSnapshot } from "@bakorin/server";
import { boot, client, MINI_YAML } from "../tests/helpers.ts";
import { startS3Mock } from "../tests/s3-mock.ts";

const mock = startS3Mock("bakorin-drill");
const yaml = MINI_YAML.replace(
  "    path: ./data/uploads\n",
  `    driver: s3
    path: ./data/uploads
    bucket: bakorin-drill
    endpoint: "${mock.endpoint}"
    accessKey: "${mock.accessKey}"
    secretKey: "${mock.secretKey}"
    region: auto
`,
).replace("destination: ./data/backups", 'destination: "s3://bakorin-drill/backups"');

const runtime = await boot(yaml);
const signup = await client(runtime).fetch("/api/v1/auth/signup", {
  method: "POST",
  body: JSON.stringify({ email: "drill@example.com", password: "password123", name: "Drill" }),
});
const token = (await signup.json()).data.accessToken as string;
await client(runtime, token).fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "keep-me" }) });
const usersBefore = (await runtime.db.selectFrom("users").selectAll().execute()).length;
const itemsBefore = (await runtime.db.selectFrom("items").selectAll().execute()).length;

const location = await runBackup({
  ast: runtime.ast,
  db: runtime.db,
  files: runtime.context.files,
  projectDir: runtime.dir,
});
console.log(`backup ${location}`);

const stamps = [...new Set([...mock.objects.keys()].map((key) => key.split("/")[1]).filter(Boolean))].sort();
const latest = stamps.at(-1);
if (!latest) {
  throw new Error("no s3 backup stamp");
}
const dest = join(tmpdir(), `bakorin-restore-${latest}`);
await mkdir(dest, { recursive: true });
for (const [key, bytes] of mock.objects) {
  const prefix = `backups/${latest}/`;
  if (!key.startsWith(prefix)) {
    continue;
  }
  const rel = key.slice(prefix.length);
  const path = join(dest, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

const dataDir = join(tmpdir(), `bakorin-data-${crypto.randomUUID()}`);
await mkdir(dataDir, { recursive: true });
const dbPath = join(dataDir, "app.db");
await restoreSqliteSnapshot({ src: dest, dbPath, uploadsPath: join(dataDir, "uploads") });
const restored = new Database(dbPath, { readonly: true });
const usersAfter = restored.query("select count(*) as n from users").get() as { n: number };
const itemsAfter = restored.query("select count(*) as n from items").get() as { n: number };
restored.close();

console.log(`users ${usersBefore} -> ${usersAfter.n}`);
console.log(`items ${itemsBefore} -> ${itemsAfter.n}`);
if (usersAfter.n !== usersBefore || itemsAfter.n !== itemsBefore) {
  throw new Error("restore drill row counts do not match");
}
console.log("restore drill ok");
await runtime.close();
mock.stop();
