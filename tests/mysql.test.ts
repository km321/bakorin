import { describe, expect, test } from "bun:test";
import { compileAppYaml } from "@bakorin/core";
import { exportPortable, importPortable, migrateToSchema } from "@bakorin/server";
import { bootMysql, client, MINI_YAML, MYSQL_URL, mysqlYaml, signupAndLogin } from "./helpers.ts";

const ENV = { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" };

/** Runtime config tests need no server. */
describe("mysql and mariadb config", () => {
  const base = (runtime: string) =>
    `app:\n  name: cfg\nruntime:\n${runtime}auth:\n  entity: users\nentities:\n  users:\n    auth: true\n    fields:\n      email: { type: email, unique: true, required: true }\n      password: { type: password, required: true }\n      role: { type: enum, values: [user, admin], default: user }\n`;

  test("dialect mysql reads runtime.mysql.url", () => {
    const ast = compileAppYaml(base(`  dialect: mysql\n  mysql:\n    url: mysql://u:p@db:3306/app\n`), { env: ENV });
    expect(ast.runtime.dialect).toBe("mysql");
    expect(ast.runtime.mysqlUrl).toBe("mysql://u:p@db:3306/app");
    expect(ast.runtime.mysqlFlavor).toBe("mysql");
  });

  test("dialect mariadb is the mysql dialect with the mariadb flavor", () => {
    const ast = compileAppYaml(base(`  dialect: mariadb\n  mysql:\n    url: \${DATABASE_URL}\n`), {
      env: { ...ENV, DATABASE_URL: "mariadb://u:p@db:3306/app" },
    });
    expect(ast.runtime.dialect).toBe("mysql");
    expect(ast.runtime.mysqlFlavor).toBe("mariadb");
  });

  test("the URL scheme picks the dialect when runtime.dialect is unset", () => {
    expect(compileAppYaml(base(`  mysql:\n    url: mysql://u:p@db/app\n`), { env: ENV }).runtime.dialect).toBe("mysql");
    const maria = compileAppYaml(base(`  mariadb:\n    url: mariadb://u:p@db/app\n`), { env: ENV });
    expect(maria.runtime.dialect).toBe("mysql");
    expect(maria.runtime.mysqlFlavor).toBe("mariadb");
    // A shared DATABASE_URL in a postgres block that points at MySQL.
    const fromPostgresBlock = compileAppYaml(base(`  postgres:\n    url: \${DATABASE_URL}\n`), {
      env: { ...ENV, DATABASE_URL: "mysql://u:p@db/app" },
    });
    expect(fromPostgresBlock.runtime.dialect).toBe("mysql");
    expect(fromPostgresBlock.runtime.mysqlUrl).toBe("mysql://u:p@db/app");
  });

  test("DATABASE_URL alone selects mysql or mariadb; explicit SQLite wins", () => {
    for (const scheme of ["mysql", "mariadb"] as const) {
      const ast = compileAppYaml(base("  host: 127.0.0.1\n"), { env: { ...ENV, DATABASE_URL: `${scheme}://u:p@db/app` } });
      expect(ast.runtime.dialect).toBe("mysql");
      expect(ast.runtime.mysqlFlavor).toBe(scheme);
      expect(ast.runtime.mysqlUrl).toBe(`${scheme}://u:p@db/app`);
      const sqlite = compileAppYaml(base("  dialect: sqlite\n"), { env: { ...ENV, DATABASE_URL: `${scheme}://u:p@db/app` } });
      expect(sqlite.runtime.dialect).toBe("sqlite");
    }
  });

  test("mismatched URLs are clear errors", () => {
    expect(() => compileAppYaml(base(`  dialect: mysql\n`), { env: ENV })).toThrow(/runtime.mysql.url is required/);
    expect(() => compileAppYaml(base(`  dialect: mysql\n  mysql:\n    url: postgres://u:p@db/app\n`), { env: ENV })).toThrow(/Postgres URL/);
    expect(() => compileAppYaml(base(`  dialect: postgres\n  postgres:\n    url: mysql://u:p@db/app\n`), { env: ENV })).toThrow(/MySQL or MariaDB URL/);
    expect(() => compileAppYaml(base(`  dialect: mysql\n  mysql:\n    url: http://db/app\n`), { env: ENV })).toThrow(/mysql:\/\/ or mariadb:\/\//);
  });

  test("the stored schema never holds the database password", async () => {
    const { serializeAst } = await import("@bakorin/core");
    const ast = compileAppYaml(base(`  dialect: mysql\n  mysql:\n    url: mysql://u:hunter2@db/app\n`), { env: ENV });
    expect(serializeAst(ast)).not.toContain("hunter2");
  });

  test("realtime broker postgres is refused on mysql", () => {
    expect(() =>
      compileAppYaml(base(`  dialect: mysql\n  mysql:\n    url: mysql://u:p@db/app\n  realtime:\n    broker: postgres\n`), { env: ENV }),
    ).toThrow(/broker postgres needs/);
  });
});

const FIELDS_YAML = `
app:
  name: fields
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  files:
    path: ./data/uploads
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
      create: public
      update: owner(id)
      delete: admin
  tags:
    fields:
      label: { type: text, required: true, unique: true }
    policies:
      read: public
      create: authenticated
      update: authenticated
      delete: authenticated
  posts:
    fields:
      title: { type: text, required: true, index: true }
      slug: { type: text, unique: true }
      body: { type: richtext }
      notes: { type: text, default: "none yet" }
      meta: { type: json, default: { views: 0 } }
      published: { type: boolean, default: false }
      rating: { type: number }
      views: { type: integer, default: 0 }
      day: { type: date }
      at: { type: datetime }
      cover: { type: file }
      tags: { type: relation, to: tags, many: true }
      parent: { type: relation, to: posts, onDelete: set_null }
      ownerId: { type: relation, to: users, required: true }
    indexes:
      - [published, title]
      - [body]
    policies:
      read: public
      create: authenticated
      update: owner(ownerId)
      delete: owner(ownerId)
`;

async function session(runtime: Awaited<ReturnType<typeof bootMysql>>, email = "ada@studio.test") {
  const signup = await signupAndLogin(client(runtime), {
    method: "POST",
    body: JSON.stringify({ email, password: "password123", name: "Ada West" }),
  });
  const data = (await signup.json()).data as { accessToken: string; refreshToken: string; user: { id: string } };
  return { ...data, api: client(runtime, data.accessToken) };
}

describe.skipIf(!MYSQL_URL)("mysql and mariadb", () => {
  test("every field type round trips, with defaults, utf8mb4 and long text", async () => {
    const runtime = await bootMysql(undefined, FIELDS_YAML);
    try {
      const { api } = await session(runtime);
      const tag = await (await api.fetch("/api/v1/tags", { method: "POST", body: JSON.stringify({ label: "news" }) })).json();
      const longBody = `<p>${"long ".repeat(20000)}</p>`;
      const created = await api.fetch("/api/v1/posts", {
        method: "POST",
        body: JSON.stringify({
          title: "Café 🚀 émoji",
          slug: "cafe",
          body: longBody,
          meta: { nested: { list: [1, "two", null] }, "123": "key" },
          published: true,
          rating: 4.5,
          day: "2026-11-18",
          at: "2026-11-18T21:30:00.000Z",
          tags: [tag.data.id],
        }),
      });
      expect(created.status).toBe(201);
      const post = (await created.json()).data;
      expect(post.title).toBe("Café 🚀 émoji");
      expect(post.notes).toBe("none yet");
      expect(post.views).toBe(0);
      expect(post.published).toBe(true);
      expect(post.rating).toBe(4.5);
      expect(post.day).toBe("2026-11-18");
      expect(post.at).toBe("2026-11-18T21:30:00.000Z");
      expect(post.meta).toEqual({ nested: { list: [1, "two", null] }, "123": "key" });
      expect(String(post.body).length).toBeGreaterThan(90000);
      expect(post.tags).toEqual([tag.data.id]);

      // JSON default, and a JSON string that looks like a number stays a string.
      const second = await api.fetch("/api/v1/posts", { method: "POST", body: JSON.stringify({ title: "Second", meta: "123" }) });
      expect(second.status).toBe(201);
      const secondJson = (await second.json()).data;
      expect(secondJson.meta).toBe("123");
      expect(secondJson.published).toBe(false);
      const third = (await (await api.fetch("/api/v1/posts", { method: "POST", body: JSON.stringify({ title: "Third" }) })).json()).data;
      expect(third.meta).toEqual({ views: 0 });

      // Filters: boolean, like (case insensitive, % literal), many to many has.
      const published = await (await api.fetch("/api/v1/posts?filter[published][eq]=true")).json();
      expect(published.data.map((row: { title: string }) => row.title)).toEqual(["Café 🚀 émoji"]);
      const like = await (await api.fetch(`/api/v1/posts?filter[title][like]=${encodeURIComponent("CAFÉ")}`)).json();
      expect(like.data.length).toBe(1);
      const has = await (await api.fetch(`/api/v1/posts?filter[tags][has]=${tag.data.id}`)).json();
      expect(has.data.map((row: { id: string }) => row.id)).toEqual([post.id]);
      const jsonLike = await (await api.fetch(`/api/v1/posts?filter[meta][like]=${encodeURIComponent("two")}`)).json();
      expect(jsonLike.data.map((row: { id: string }) => row.id)).toEqual([post.id]);

      // Sorting on text and datetime.
      const sorted = await (await api.fetch("/api/v1/posts?sort=title")).json();
      expect(sorted.data.map((row: { title: string }) => row.title)).toEqual(["Café 🚀 émoji", "Second", "Third"]);
    } finally {
      await runtime.close();
    }
  });

  test("unique values are case sensitive, like SQLite and Postgres, and conflicts are 409", async () => {
    const runtime = await bootMysql(undefined, FIELDS_YAML);
    try {
      const { api } = await session(runtime);
      expect((await api.fetch("/api/v1/tags", { method: "POST", body: JSON.stringify({ label: "News" }) })).status).toBe(201);
      expect((await api.fetch("/api/v1/tags", { method: "POST", body: JSON.stringify({ label: "news" }) })).status).toBe(201);
      const dupe = await api.fetch("/api/v1/tags", { method: "POST", body: JSON.stringify({ label: "news" }) });
      expect(dupe.status).toBe(409);
      // A unique text over 255 characters is a 400, never a silent cut.
      const long = await api.fetch("/api/v1/tags", { method: "POST", body: JSON.stringify({ label: "x".repeat(300) }) });
      expect(long.status).toBe(400);
      const eq = await (await api.fetch("/api/v1/tags?filter[label][eq]=news")).json();
      expect(eq.data.map((row: { label: string }) => row.label)).toEqual(["news"]);
    } finally {
      await runtime.close();
    }
  });

  test("foreign keys: restrict is 409, set_null clears, many to many links cascade", async () => {
    const runtime = await bootMysql(undefined, FIELDS_YAML);
    try {
      const { api, user } = await session(runtime);
      const tag = (await (await api.fetch("/api/v1/tags", { method: "POST", body: JSON.stringify({ label: "t" }) })).json()).data;
      const parent = (await (await api.fetch("/api/v1/posts", { method: "POST", body: JSON.stringify({ title: "Parent", tags: [tag.id] }) })).json()).data;
      const child = (await (await api.fetch("/api/v1/posts", { method: "POST", body: JSON.stringify({ title: "Child", parent: parent.id }) })).json()).data;
      expect(child.parent).toBe(parent.id);
      const missing = await api.fetch("/api/v1/posts", { method: "POST", body: JSON.stringify({ title: "Bad", parent: crypto.randomUUID() }) });
      expect(missing.status).toBe(400);
      expect((await api.fetch(`/api/v1/posts/${parent.id}`, { method: "DELETE" })).status).toBeLessThan(300);
      const after = (await (await api.fetch(`/api/v1/posts/${child.id}`)).json()).data;
      expect(after.parent).toBeNull();
      const links = await runtime.db.selectFrom("_bakorin_link_posts_tags").selectAll().execute();
      expect(links.length).toBe(0);
      // posts.ownerId is restrict: the database refuses to delete the owner.
      await expect(runtime.db.deleteFrom("users").where("id", "=", user.id).execute()).rejects.toThrow();
    } finally {
      await runtime.close();
    }
  });

  test("tables are InnoDB utf8mb4_bin, long index names fit, and migrations rerun cleanly", async () => {
    const runtime = await bootMysql(undefined, FIELDS_YAML);
    try {
      const catalog = (table: string) => runtime.db.selectFrom(`information_schema.${table}`).where("table_schema", "=", runtime.database);
      const tables = (await catalog("tables").select(["table_name as name", "table_collation as collation", "engine as engine"]).execute()) as Array<{
        name: string;
        collation: string;
        engine: string;
      }>;
      expect(tables.length).toBeGreaterThan(10);
      for (const row of tables) {
        expect(row.collation).toBe("utf8mb4_bin");
        expect(row.engine).toBe("InnoDB");
      }
      const indexNames = async (table: string) =>
        [...new Set((await catalog("statistics").select("index_name as name").where("table_name", "=", table).execute()).map((row) => String(row.name)))];
      const names = await indexNames("posts");
      expect(names).toContain("_bakorin_idx_posts_published_title");
      expect(names).toContain("_bakorin_uidx_posts_slug");
      expect(names).toContain("_bakorin_idx_posts_body");
      // Same schema again, then a new field, entity and index: nothing fails.
      const url = runtime.ast.runtime.mysqlUrl!;
      const again = compileAppYaml(mysqlYaml(url, FIELDS_YAML), { env: ENV });
      const same = await migrateToSchema(runtime.db, again);
      expect(same.plan.auto.length + same.plan.safe.length).toBe(0);
      const longName = "a_really_long_entity_name_for_index_limits";
      const next = compileAppYaml(
        `${mysqlYaml(url, FIELDS_YAML)}  ${longName}:\n    fields:\n      some_long_field_name_number_one: { type: text, index: true }\n      some_long_field_name_number_two: { type: text }\n    indexes:\n      - [some_long_field_name_number_one, some_long_field_name_number_two]\n`.replace(
          "      ownerId: { type: relation, to: users, required: true }\n",
          "      ownerId: { type: relation, to: users, required: true }\n      subtitle: { type: text, required: true, default: \"\" }\n      score: { type: number, index: true }\n",
        ),
        { env: ENV },
      );
      const applied = await migrateToSchema(runtime.db, next);
      expect(applied.applied).toBe(true);
      const longIndexes = await indexNames(longName);
      expect(longIndexes.length).toBeGreaterThanOrEqual(3);
      for (const name of longIndexes) {
        expect(name.length).toBeLessThanOrEqual(64);
      }
      // Running the same migration a second time is a no op.
      const rerun = await migrateToSchema(runtime.db, next);
      expect(rerun.plan.auto.length).toBe(0);
    } finally {
      await runtime.close();
    }
  });

  test("renaming a field and an entity keeps the data and the join tables", async () => {
    const runtime = await bootMysql(undefined, FIELDS_YAML);
    try {
      const { api } = await session(runtime);
      const tag = (await (await api.fetch("/api/v1/tags", { method: "POST", body: JSON.stringify({ label: "r" }) })).json()).data;
      await api.fetch("/api/v1/posts", { method: "POST", body: JSON.stringify({ title: "Keep", slug: "keep", tags: [tag.id] }) });
      const url = runtime.ast.runtime.mysqlUrl!;
      const renamed = compileAppYaml(
        mysqlYaml(url, FIELDS_YAML)
          .replace("      slug: { type: text, unique: true }", "      handle: { type: text, unique: true, renameFrom: slug }")
          .replace("      tags: { type: relation, to: tags, many: true }", "      labels: { type: relation, to: tags, many: true, renameFrom: tags }"),
        { env: ENV },
      );
      const result = await migrateToSchema(runtime.db, renamed);
      expect(result.plan.safe.map((change) => change.kind)).toEqual(["rename_field", "rename_field"]);
      const row = await runtime.db.selectFrom("posts").selectAll().executeTakeFirstOrThrow();
      expect(row.handle).toBe("keep");
      const links = await runtime.db.selectFrom("_bakorin_link_posts_labels").selectAll().execute();
      expect(links.length).toBe(1);
    } finally {
      await runtime.close();
    }
  });

  test("two instances migrating at once: the advisory lock serializes them", async () => {
    const runtime = await bootMysql();
    try {
      const { openMysql } = await import("../packages/server/src/db/dialects.ts");
      const url = runtime.ast.runtime.mysqlUrl!;
      const v2 = compileAppYaml(`${mysqlYaml(url)}  extras:\n    fields:\n      label: { type: text, index: true }\n`, { env: ENV });
      const a = openMysql(url);
      const b = openMysql(url);
      try {
        const results = await Promise.all([migrateToSchema(a.db, v2), migrateToSchema(b.db, v2)]);
        // One applied the new entity, the other found nothing left to do.
        const added = results.map((result) => result.plan.auto.filter((change) => change.kind === "add_entity").length).sort();
        expect(added).toEqual([0, 1]);
      } finally {
        await a.db.destroy();
        await b.db.destroy();
      }
    } finally {
      await runtime.close();
    }
  });

  test("upserts: logout everywhere twice updates the token cutoff instead of failing", async () => {
    const runtime = await bootMysql();
    try {
      const { revokeAllForUser, tokenCutoff } = await import("../packages/server/src/auth/refresh.ts");
      const { user } = await session(runtime);
      await revokeAllForUser(runtime.db, user.id);
      const first = await tokenCutoff(runtime.db, user.id);
      await Bun.sleep(5);
      await revokeAllForUser(runtime.db, user.id);
      const second = await tokenCutoff(runtime.db, user.id);
      expect(first).toBeGreaterThan(0);
      expect(second).toBeGreaterThan(first);
      const rows = await runtime.db.selectFrom("_bakorin_token_cutoffs").selectAll().execute();
      expect(rows.length).toBe(1);
    } finally {
      await runtime.close();
    }
  });

  test("mail outbox dedupes by idempotency key", async () => {
    const hooks = `export default { entities: { items: { async afterCreate(ctx) {
      await ctx.mail.send({ to: "team@studio.test", subject: "New " + ctx.record.title, text: "x", idempotencyKey: "item-" + ctx.record.id });
      await ctx.mail.send({ to: "team@studio.test", subject: "dupe", text: "dupe", idempotencyKey: "item-" + ctx.record.id });
    } } } };\n`;
    const runtime = await bootMysql(hooks);
    try {
      const { api } = await session(runtime);
      await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Kiln" }) });
      let rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 100 && rows.length === 0; i += 1) {
        await Bun.sleep(20);
        rows = (await runtime.db.selectFrom("_bakorin_mail_outbox").selectAll().where("source", "=", "hook").execute()) as Array<Record<string, unknown>>;
      }
      await Bun.sleep(100);
      rows = (await runtime.db.selectFrom("_bakorin_mail_outbox").selectAll().where("source", "=", "hook").execute()) as Array<Record<string, unknown>>;
      expect(rows.length).toBe(1);
      expect(rows[0]?.subject).toBe("New Kiln");
    } finally {
      await runtime.close();
    }
  });

  test("parallel refreshes on separate connections mint one successor", async () => {
    const runtime = await bootMysql();
    try {
      const data = await session(runtime, "r@x.test");
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => client(runtime).fetch("/api/v1/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: data.refreshToken }) })),
      );
      expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
      const tokens = new Set(await Promise.all(results.map(async (res) => (await res.json()).data.refreshToken)));
      expect(tokens.size).toBe(1);
    } finally {
      await runtime.close();
    }
  });

  test("portable export and import round trip, including self references", async () => {
    const runtime = await bootMysql(undefined, FIELDS_YAML);
    try {
      const { api } = await session(runtime);
      const tag = (await (await api.fetch("/api/v1/tags", { method: "POST", body: JSON.stringify({ label: "b" }) })).json()).data;
      const parent = (await (await api.fetch("/api/v1/posts", { method: "POST", body: JSON.stringify({ title: "P", meta: { a: 1 }, tags: [tag.id] }) })).json()).data;
      await api.fetch("/api/v1/posts", { method: "POST", body: JSON.stringify({ title: "C", parent: parent.id, published: true }) });
      const dest = `${runtime.dir}/portable`;
      await exportPortable({ dest, projectDir: runtime.dir, ast: runtime.ast, db: runtime.db, files: runtime.context.files });
      await importPortable({ src: dest, ast: runtime.ast, db: runtime.db, files: runtime.context.files });
      const posts = await (await api.fetch("/api/v1/posts?sort=title")).json();
      expect(posts.data.map((row: { title: string }) => row.title)).toEqual(["C", "P"]);
      expect(posts.data[0].parent).toBe(parent.id);
      expect(posts.data[0].published).toBe(true);
      expect(posts.data[1].meta).toEqual({ a: 1 });
      expect(posts.data[1].tags).toEqual([tag.id]);
      // Foreign key checks are back on for the pooled connections.
      const bad = await api.fetch("/api/v1/posts", { method: "POST", body: JSON.stringify({ title: "Bad", parent: crypto.randomUUID() }) });
      expect(bad.status).toBe(400);
    } finally {
      await runtime.close();
    }
  });

  test("status reports the database size", async () => {
    const { databaseSize } = await import("../packages/server/src/monitor/status.ts");
    const runtime = await bootMysql();
    try {
      const size = await databaseSize(runtime.ast, runtime.db, runtime.dir);
      expect(size).toBeGreaterThan(0);
    } finally {
      await runtime.close();
    }
  });

  test("like treats % and _ literally and backslashes are plain text", async () => {
    const runtime = await bootMysql(undefined, MINI_YAML);
    try {
      const { api } = await session(runtime, "l@x.test");
      for (const title of ["Hello World", "50% off", "a_b", "back\\slash", "plain"]) {
        await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title }) });
      }
      const pick = async (q: string) =>
        (await (await api.fetch(`/api/v1/items?filter[title][like]=${encodeURIComponent(q)}`)).json()).data.map((row: { title: string }) => row.title);
      expect(await pick("hello")).toEqual(["Hello World"]);
      expect(await pick("%")).toEqual(["50% off"]);
      expect(await pick("_")).toEqual(["a_b"]);
      expect(await pick("\\")).toEqual(["back\\slash"]);
    } finally {
      await runtime.close();
    }
  });
});
