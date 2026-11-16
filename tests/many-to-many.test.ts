// Many to many relations: `type: relation, to: X, many: true` with a hidden join
// table. Runs on SQLite, and on Postgres in the CI matrix.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { compileAppYaml, generateTypes, joinTableName } from "@bakorin/core";
import { buildOpenApi, exportPortable, importPortable, resetRateLimit } from "@bakorin/server";
import { boot, MINI_YAML } from "./helpers.ts";
import { sseReader } from "./realtime-helpers.ts";

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const M2M_YAML = MINI_YAML.replace(
  "entities:\n",
  `entities:
  tags:
    fields:
      name: { type: text, required: true }
    policies:
      read: public
      create: authenticated
      update: admin
      delete: authenticated
  posts:
    realtime: true
    fields:
      title: { type: text, required: true }
      authorId: { type: relation, to: users }
      tags: { type: relation, to: tags, many: true }
      items: { type: relation, to: items, many: true }
    policies:
      read: public
      create: authenticated
      update: authenticated
      delete: authenticated
`,
);

type Runtime = Awaited<ReturnType<typeof boot>>;

async function started(yaml = M2M_YAML) {
  resetRateLimit();
  const runtime = await boot(yaml);
  cleanups.push(() => runtime.close());
  return runtime;
}

async function call(runtime: Runtime, method: string, path: string, body?: unknown, token?: string) {
  const res = await runtime.app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function user(runtime: Runtime, email: string) {
  await call(runtime, "POST", "/api/v1/auth/signup", { email, password: "password123", name: email.split("@")[0] });
  const login = await call(runtime, "POST", "/api/v1/auth/login", { email, password: "password123" });
  return { id: login.json.data.user.id as string, token: login.json.data.accessToken as string };
}

async function admin(runtime: Runtime) {
  const res = await call(runtime, "POST", "/api/v1/auth/first-admin", { email: "boss@example.test", password: "password123", name: "Boss" });
  return { id: res.json.data.user.id as string, token: res.json.data.accessToken as string };
}

async function tag(runtime: Runtime, token: string, name: string): Promise<string> {
  const res = await call(runtime, "POST", "/api/v1/tags", { name }, token);
  expect(res.status).toBe(201);
  return res.json.data.id;
}

async function linkCount(runtime: Runtime, entity: string, field: string): Promise<number> {
  const rows = await runtime.db.selectFrom(joinTableName(entity, field)).select("source_id").execute();
  return rows.length;
}

describe("many to many: schema", () => {
  test("compiles to a list field with no column, typed as string[] and an array in OpenAPI", async () => {
    const ast = compileAppYaml(M2M_YAML);
    const field = ast.entityMap.posts!.fieldMap.tags!;
    expect(field.relation).toEqual({ to: "tags", onDelete: "restrict", many: true });
    expect(field.indexed).toBe(false);
    expect(generateTypes(ast)).toContain("tags: string[];");
    const openapi = buildOpenApi(ast) as { components: { schemas: Record<string, { properties: Record<string, { type: string }> }> } };
    const schemas = Object.values(openapi.components.schemas);
    expect(schemas.some((schema) => schema.properties?.tags?.type === "array")).toBe(true);
    // Both directions may link to each other: many to many does not order tables.
    expect(() =>
      compileAppYaml(M2M_YAML.replace("      name: { type: text, required: true }\n", "      name: { type: text, required: true }\n      posts: { type: relation, to: posts, many: true }\n")),
    ).not.toThrow();
  });

  test("rejects options that make no sense for a list", () => {
    const bad = (line: string) => M2M_YAML.replace("      tags: { type: relation, to: tags, many: true }", line);
    expect(() => compileAppYaml(bad("      tags: { type: text, many: true }"))).toThrow(/not a relation/);
    expect(() => compileAppYaml(bad("      tags: { type: relation, to: tags, many: true, unique: true }"))).toThrow(/cannot be unique/);
    expect(() => compileAppYaml(bad("      tags: { type: relation, to: tags, many: true, onDelete: cascade }"))).toThrow(/leave out onDelete/);
    expect(() => compileAppYaml(bad("      tags: { type: relation, to: nope, many: true }"))).toThrow(/unknown entity/);
  });

  test("the join table exists and the entity table has no column for the field", async () => {
    const runtime = await started();
    expect(await linkCount(runtime, "posts", "tags")).toBe(0);
    const row = await runtime.db.selectFrom("posts").selectAll().executeTakeFirst();
    expect(row).toBeUndefined();
    const pat = await user(runtime, "pat@example.test");
    const created = await call(runtime, "POST", "/api/v1/posts", { title: "Hello" }, pat.token);
    const raw = (await runtime.db.selectFrom("posts").selectAll().where("id", "=", created.json.data.id).executeTakeFirst()) as Record<string, unknown>;
    expect("tags" in raw).toBe(false);
    expect(created.json.data.tags).toEqual([]);
  });
});

describe("many to many: API", () => {
  test("create, read, list, expand, has filter, order and dedupe", async () => {
    const runtime = await started();
    const pat = await user(runtime, "pat@example.test");
    const garden = await tag(runtime, pat.token, "garden");
    const kitchen = await tag(runtime, pat.token, "kitchen");
    const tools = await tag(runtime, pat.token, "tools");
    const post = await call(runtime, "POST", "/api/v1/posts", { title: "Spring list", tags: [kitchen, garden, kitchen] }, pat.token);
    expect(post.status).toBe(201);
    expect(post.json.data.tags).toEqual([kitchen, garden]);
    const other = await call(runtime, "POST", "/api/v1/posts", { title: "Shed day", tags: [tools] }, pat.token);

    const got = await call(runtime, "GET", `/api/v1/posts/${post.json.data.id}?expand=tags`);
    expect(got.json.data.tags).toEqual([kitchen, garden]);
    expect(got.json.data.$expand.tags.map((item: { name: string }) => item.name)).toEqual(["kitchen", "garden"]);

    const list = await call(runtime, "GET", "/api/v1/posts?sort=title&expand=tags");
    expect(list.json.data.map((item: { title: string }) => item.title)).toEqual(["Shed day", "Spring list"]);
    expect(list.json.data[0].$expand.tags[0].name).toBe("tools");

    const has = await call(runtime, "GET", `/api/v1/posts?filter[tags][has]=${garden}`);
    expect(has.json.data.map((item: { id: string }) => item.id)).toEqual([post.json.data.id]);
    expect(has.json.meta.total).toBe(1);
    const any = await call(runtime, "GET", `/api/v1/posts?filter[tags]=${garden},${tools}&sort=title`);
    expect(any.json.data.map((item: { id: string }) => item.id)).toEqual([other.json.data.id, post.json.data.id]);

    // Replace, clear with null, and leave untouched when the field is not sent.
    const replaced = await call(runtime, "PATCH", `/api/v1/posts/${post.json.data.id}`, { tags: [tools] }, pat.token);
    expect(replaced.json.data.tags).toEqual([tools]);
    const renamed = await call(runtime, "PATCH", `/api/v1/posts/${post.json.data.id}`, { title: "Spring list 2" }, pat.token);
    expect(renamed.json.data.tags).toEqual([tools]);
    const cleared = await call(runtime, "PATCH", `/api/v1/posts/${post.json.data.id}`, { tags: null }, pat.token);
    expect(cleared.json.data.tags).toEqual([]);
  });

  test("invalid input and ids that do not exist are refused", async () => {
    const runtime = await started();
    const pat = await user(runtime, "pat@example.test");
    expect((await call(runtime, "POST", "/api/v1/posts", { title: "x", tags: "abc" }, pat.token)).status).toBe(400);
    expect((await call(runtime, "POST", "/api/v1/posts", { title: "x", tags: [1, 2] }, pat.token)).status).toBe(400);
    const missing = await call(runtime, "POST", "/api/v1/posts", { title: "x", tags: [crypto.randomUUID()] }, pat.token);
    expect(missing.status).toBe(400);
    expect(missing.json.error.message).toContain("tags");
    const tooMany = await call(runtime, "POST", "/api/v1/posts", { title: "x", tags: Array.from({ length: 1001 }, (_, i) => `t${i}`) }, pat.token);
    expect(tooMany.status).toBe(400);
  });

  test("every linked id is read policy checked, on write and on read, and hidden links survive a PATCH", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    const ann = await user(runtime, "ann@example.test");
    const ben = await user(runtime, "ben@example.test");
    const annItem = (await call(runtime, "POST", "/api/v1/items", { title: "Ann's ladder", ownerId: ann.id }, ann.token)).json.data.id;
    const benItem = (await call(runtime, "POST", "/api/v1/items", { title: "Ben's drill", ownerId: ben.id }, ben.token)).json.data.id;

    // Ben cannot link Ann's private item.
    expect((await call(runtime, "POST", "/api/v1/posts", { title: "Borrow", items: [annItem] }, ben.token)).status).toBe(400);
    const post = await call(runtime, "POST", "/api/v1/posts", { title: "Lending", items: [annItem] }, ann.token);
    expect(post.status).toBe(201);
    const id = post.json.data.id;

    // Readers only see ids they may read.
    expect((await call(runtime, "GET", `/api/v1/posts/${id}`, undefined, ben.token)).json.data.items).toEqual([]);
    expect((await call(runtime, "GET", `/api/v1/posts/${id}`)).json.data.items).toEqual([]);
    expect((await call(runtime, "GET", `/api/v1/posts/${id}?expand=items`, undefined, ben.token)).json.data.$expand.items).toEqual([]);

    // Ben adds his own item. Ann's link, which Ben cannot see, is kept.
    const patched = await call(runtime, "PATCH", `/api/v1/posts/${id}`, { items: [benItem] }, ben.token);
    expect(patched.status).toBe(200);
    expect(patched.json.data.items).toEqual([benItem]);
    expect((await call(runtime, "GET", `/api/v1/posts/${id}`, undefined, ann.token)).json.data.items).toEqual([annItem]);
    const all = (await call(runtime, "GET", `/api/v1/posts/${id}?expand=items`, undefined, boss.token)).json.data;
    expect([...all.items].sort()).toEqual([annItem, benItem].sort());
    expect(all.$expand.items).toHaveLength(2);
  });

  test("links are removed when either side is deleted", async () => {
    const runtime = await started();
    const pat = await user(runtime, "pat@example.test");
    const a = await tag(runtime, pat.token, "a");
    const b = await tag(runtime, pat.token, "b");
    const post = (await call(runtime, "POST", "/api/v1/posts", { title: "Linked", tags: [a, b] }, pat.token)).json.data;
    const second = (await call(runtime, "POST", "/api/v1/posts", { title: "Also", tags: [a] }, pat.token)).json.data;
    expect(await linkCount(runtime, "posts", "tags")).toBe(3);
    expect((await call(runtime, "DELETE", `/api/v1/tags/${a}`, undefined, pat.token)).status).toBe(200);
    expect((await call(runtime, "GET", `/api/v1/posts/${post.id}`)).json.data.tags).toEqual([b]);
    expect((await call(runtime, "GET", `/api/v1/posts/${second.id}`)).json.data.tags).toEqual([]);
    expect((await call(runtime, "DELETE", `/api/v1/posts/${post.id}`, undefined, pat.token)).status).toBe(200);
    expect(await linkCount(runtime, "posts", "tags")).toBe(0);
  });

  test("a change to links is an update event: realtime fires, updatedAt moves", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    const pat = await user(runtime, "pat@example.test");
    const garden = await tag(runtime, pat.token, "garden");
    const post = (await call(runtime, "POST", "/api/v1/posts", { title: "Live" }, pat.token)).json.data;
    const asPublic = await runtime.app.request("/api/v1/realtime?entities=posts");
    const asAdmin = await runtime.app.request("/api/v1/realtime?entities=posts", { headers: { authorization: `Bearer ${boss.token}` } });
    const pub = sseReader(asPublic);
    const adm = sseReader(asAdmin);
    cleanups.push(() => pub.cancel(), () => adm.cancel());
    await pub.next((event) => event.event === "ready");
    await adm.next((event) => event.event === "ready");
    await Bun.sleep(5);
    const patched = await call(runtime, "PATCH", `/api/v1/posts/${post.id}`, { tags: [garden] }, pat.token);
    expect(patched.json.data.updatedAt >= post.updatedAt).toBe(true);
    const event = await pub.next((item) => item.event === "change" && item.data.op === "update");
    const data = event.data;
    expect(data.op).toBe("update");
    expect(data.record.tags).toEqual([garden]);
    // items link to an owner only entity, so non admins get the field left out.
    expect("items" in data.record).toBe(false);
    const forAdmin = (await adm.next((item) => item.event === "change" && item.data.op === "update")).data;
    expect(forAdmin.record.items).toEqual([]);
  });
});

describe("many to many: migrations and backups", () => {
  test("adding a many field later creates the join table; renameFrom keeps the links", async () => {
    const base = M2M_YAML.replace("      items: { type: relation, to: items, many: true }\n", "");
    const runtime = await started(base);
    const pat = await user(runtime, "pat@example.test");
    const yamlPath = join(runtime.dir, "app.yaml");
    const current = await Bun.file(yamlPath).text();
    const withItems = current.replace(
      "      tags: { type: relation, to: tags, many: true }\n",
      "      tags: { type: relation, to: tags, many: true }\n      items: { type: relation, to: items, many: true }\n",
    );
    await runtime.reload(withItems);
    const item = (await call(runtime, "POST", "/api/v1/items", { title: "Rake", ownerId: pat.id }, pat.token)).json.data.id;
    const post = (await call(runtime, "POST", "/api/v1/posts", { title: "Tools", items: [item] }, pat.token)).json.data;
    expect(post.items).toEqual([item]);

    const renamed = withItems.replace("      items: { type: relation, to: items, many: true }\n", "      gear: { type: relation, to: items, many: true, renameFrom: items }\n");
    await runtime.reload(renamed);
    expect((await call(runtime, "GET", `/api/v1/posts/${post.id}`, undefined, pat.token)).json.data.gear).toEqual([item]);

    // Switching between single and many is refused.
    const switched = renamed.replace("      gear: { type: relation, to: items, many: true, renameFrom: items }\n", "      gear: { type: relation, to: items }\n");
    await expect(runtime.reload(switched)).rejects.toThrow(/many: true/);
  });

  test("portable export and import keep the links", async () => {
    const runtime = await started();
    const pat = await user(runtime, "pat@example.test");
    const a = await tag(runtime, pat.token, "a");
    const b = await tag(runtime, pat.token, "b");
    const post = (await call(runtime, "POST", "/api/v1/posts", { title: "Backed up", tags: [b, a] }, pat.token)).json.data;
    const dest = join(await mkdtemp(join(tmpdir(), "bakorin-m2m-")), "backup");
    await exportPortable({ dest, projectDir: runtime.dir, ast: runtime.ast, db: runtime.db, files: runtime.context.files });
    expect(await Bun.file(join(dest, "data", `${joinTableName("posts", "tags")}.ndjson`)).exists()).toBe(true);
    await call(runtime, "PATCH", `/api/v1/posts/${post.id}`, { tags: [] }, pat.token);
    await importPortable({ src: dest, ast: runtime.ast, db: runtime.db, files: runtime.context.files });
    expect((await call(runtime, "GET", `/api/v1/posts/${post.id}`)).json.data.tags).toEqual([b, a]);
  });
});
