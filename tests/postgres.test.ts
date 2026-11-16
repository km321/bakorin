import { describe, expect, test } from "bun:test";
import { bootPostgres, client, MINI_YAML, signupAndLogin } from "./helpers.ts";
import { deliverMailById, exportPortable, importPortable, type MailMessage } from "@bakorin/server";
import { AUDIT_TABLE, MAIL_OUTBOX_TABLE, WEBHOOK_OUTBOX_TABLE } from "../packages/server/src/db/system.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("postgres", () => {
  test("migrator applies and auth works", async () => {
    const runtime = await bootPostgres();
    const signup = await signupAndLogin(client(runtime), {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada West" }),
    });
    expect(signup.status).toBe(200);
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123" }),
    });
    expect(login.status).toBe(200);
    expect((await login.json()).data.accessToken).toBeTypeOf("string");
    await runtime.close();
  });

  test("crud expand and owner isolation", async () => {
    const runtime = await bootPostgres();
    const signup = await signupAndLogin(client(runtime), {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada West" }),
    });
    const created = (await signup.json()).data as { accessToken: string; user: { id: string } };
    const api = client(runtime, created.accessToken);

    const item = await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Northwind" }) });
    expect(item.status).toBe(201);
    const itemJson = await item.json();
    expect(itemJson.data.ownerId).toBe(created.user.id);

    const expanded = await api.fetch(`/api/v1/items/${itemJson.data.id}?expand=ownerId`);
    const expandedJson = await expanded.json();
    expect(expandedJson.data.$expand.ownerId.name).toBe("Ada West");
    expect(expandedJson.data.$expand.ownerId.password).toBeUndefined();

    const staff = await signupAndLogin(client(runtime), {
      method: "POST",
      body: JSON.stringify({ email: "sam@studio.test", password: "password123", name: "Sam Lee" }),
    });
    const staffToken = (await staff.json()).data.accessToken as string;
    expect((await client(runtime, staffToken).fetch(`/api/v1/items/${itemJson.data.id}`)).status).toBe(404);

    const spoof = await client(runtime, staffToken).fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "Spoof", ownerId: created.user.id }),
    });
    expect(spoof.status).toBe(403);
    const own = await client(runtime, staffToken).fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "Mine" }),
    });
    expect(own.status).toBe(201);
    expect((await own.json()).data.ownerId).not.toBe(created.user.id);
    await runtime.close();
  });

  test("portable backup round trip", async () => {
    const runtime = await bootPostgres();
    const signup = await signupAndLogin(client(runtime), {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada West" }),
    });
    const token = (await signup.json()).data.accessToken as string;
    await client(runtime, token).fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Keep me" }) });
    const dest = `${runtime.dir}/portable`;
    await exportPortable({
      dest,
      projectDir: runtime.dir,
      ast: runtime.ast,
      db: runtime.db,
      files: runtime.context.files,
    });
    await runtime.db.deleteFrom("items").execute();
    expect((await runtime.db.selectFrom("items").selectAll().execute()).length).toBe(0);
    await importPortable({ src: dest, ast: runtime.ast, db: runtime.db, files: runtime.context.files });
    expect((await runtime.db.selectFrom("items").selectAll().execute()).length).toBe(1);
    await runtime.close();
  });

  test("openapi document is generated", async () => {
    const runtime = await bootPostgres();
    const spec = await client(runtime).fetch("/api/v1/openapi.json");
    expect(spec.status).toBe(200);
    const openapi = await spec.json();
    expect(openapi.openapi).toBe("3.0.3");
    expect(openapi.paths["/api/v1/items"]).toBeTruthy();
    expect(openapi.components.securitySchemes.bearerAuth).toBeTruthy();
    await runtime.close();
  });

  test("mail outbox: hook send queues, sends once, dedupes by key", async () => {
    const hooks = `export default { entities: { items: { async afterCreate(ctx) {
      await ctx.mail.send({ to: "team@studio.test", subject: "New " + ctx.record.title, html: "<p>" + ctx.record.title + "</p>", idempotencyKey: "item-" + ctx.record.id });
      await ctx.mail.send({ to: "team@studio.test", subject: "dupe", text: "dupe", idempotencyKey: "item-" + ctx.record.id });
    } } } };\n`;
    const runtime = await bootPostgres(hooks);
    const signup = await signupAndLogin(client(runtime), {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada West" }),
    });
    const created = (await signup.json()).data as { accessToken: string };
    await client(runtime, created.accessToken).fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Kiln" }) });
    let rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 100 && rows.length === 0; i += 1) {
      await Bun.sleep(20);
      rows = (await runtime.db.selectFrom(MAIL_OUTBOX_TABLE).selectAll().where("source", "=", "hook").execute()) as Array<Record<string, unknown>>;
    }
    await Bun.sleep(100);
    rows = (await runtime.db.selectFrom(MAIL_OUTBOX_TABLE).selectAll().where("source", "=", "hook").execute()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const verify = await runtime.db.selectFrom(MAIL_OUTBOX_TABLE).selectAll().where("source", "=", "auth").execute();
    expect(verify.map((row) => row.purpose)).toEqual(["verify"]);
    expect(String(verify[0]?.html)).toContain("[redacted]");
    const sent: MailMessage[] = [];
    const mailer = { driver: "log" as const, send: async (message: MailMessage) => void sent.push(message) };
    const id = String(rows[0]?.id);
    const status = await deliverMailById(runtime.db, mailer, id);
    expect(status === "sent" || status === null).toBe(true);
    await deliverMailById(runtime.db, mailer, id);
    const row = await runtime.db.selectFrom(MAIL_OUTBOX_TABLE).selectAll().where("id", "=", id).executeTakeFirst();
    expect(row?.status).toBe("sent");
    expect(sent.length).toBeLessThanOrEqual(1);
    await runtime.close();
  });

  describe("review fixes: transactional outbox and hook safety", () => {
    const WEBHOOK_YAML = `${MINI_YAML}
webhooks:
  - entity: items
    events: [create, update, delete]
    url: http://127.0.0.1:9/hook
    secret: webhook-secret-webhook-secret
`;
    const THROWING = `export default { entities: { items: { afterCreate: async () => { throw new Error("hook boom"); } } } };\n`;

    async function count(runtime: Awaited<ReturnType<typeof bootPostgres>>, table: string): Promise<number> {
      const row = (await (runtime.db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as("n")).executeTakeFirst()) as { n: string | number };
      return Number(row.n);
    }

    async function firstAdmin(runtime: Awaited<ReturnType<typeof bootPostgres>>) {
      const res = await client(runtime).fetch("/api/v1/auth/first-admin", {
        method: "POST",
        body: JSON.stringify({ email: "boss@x.test", password: "password123", name: "Boss" }),
      });
      return (await res.json()).data as { accessToken: string; user: { id: string } };
    }

    test("create, update and delete write webhook and audit rows in the record transaction", async () => {
      const runtime = await bootPostgres(THROWING, WEBHOOK_YAML);
      try {
        const admin = await firstAdmin(runtime);
        const api = client(runtime, admin.accessToken);
        const auditBefore = await count(runtime, AUDIT_TABLE);
        const created = await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "a", ownerId: admin.user.id }) });
        expect(created.status).toBe(201);
        const id = (await created.json()).data.id;
        expect((await api.fetch(`/api/v1/items/${id}`, { method: "PATCH", body: JSON.stringify({ title: "b" }) })).status).toBe(200);
        expect((await api.fetch(`/api/v1/items/${id}`, { method: "DELETE" })).status).toBeLessThan(300);
        expect(await count(runtime, WEBHOOK_OUTBOX_TABLE)).toBe(3);
        expect((await count(runtime, AUDIT_TABLE)) - auditBefore).toBe(3);
        // The throwing afterCreate was reported, not fatal.
        await Bun.sleep(50);
        expect(runtime.context.monitor.recentErrors().some((error) => error.source === "hook")).toBe(true);
        expect((await client(runtime).fetch("/health")).status).toBe(200);
      } finally {
        await runtime.close();
      }
    });

    test("a failed outbox write rolls back the record", async () => {
      const runtime = await bootPostgres(undefined, WEBHOOK_YAML);
      try {
        const admin = await firstAdmin(runtime);
        await runtime.db.schema.dropTable(WEBHOOK_OUTBOX_TABLE).execute();
        const created = await client(runtime, admin.accessToken).fetch("/api/v1/items", {
          method: "POST",
          body: JSON.stringify({ title: "ghost", ownerId: admin.user.id }),
        });
        expect(created.status).toBe(500);
        expect(await count(runtime, "items")).toBe(0);
        expect((await client(runtime).fetch("/health")).status).toBe(200);
      } finally {
        await runtime.close();
      }
    });

    test("concurrent writes each commit their own outbox row", async () => {
      const runtime = await bootPostgres(undefined, WEBHOOK_YAML);
      try {
        const admin = await firstAdmin(runtime);
        const api = client(runtime, admin.accessToken);
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, i) => api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: `t${i}`, ownerId: admin.user.id }) })),
        );
        expect(results.every((res) => res.status === 201)).toBe(true);
        expect(await count(runtime, WEBHOOK_OUTBOX_TABLE)).toBe(20);
      } finally {
        await runtime.close();
      }
    });
  });
});

describe.skipIf(!url)("postgres: idle connection errors", () => {
  test("a terminated idle connection is logged, not fatal", async () => {
    const { openPostgres } = await import("../packages/server/src/db/dialects.ts");
    const { db, pool } = openPostgres(url!);
    await pool.query("select 1");
    const idle = pool.idleCount;
    expect(idle).toBeGreaterThan(0);
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    // Simulate Postgres killing the idle backend.
    const admin = openPostgres(url!);
    await admin.pool.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state = 'idle'");
    await Bun.sleep(200);
    expect((await pool.query("select 1 as ok")).rows[0].ok).toBe(1);
    await db.destroy();
    await admin.db.destroy();
  });
});

describe.skipIf(!url)("postgres: review mediums", () => {
  const ENV = { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" };

  test("M6: a failed migration rolls back DDL and the stored schema", async () => {
    const { compileAppYaml } = await import("@bakorin/core");
    const { migrateToSchema } = await import("@bakorin/server");
    const { postgresYaml } = await import("./helpers.ts");
    const runtime = await bootPostgres();
    try {
      const before = (await runtime.db.selectFrom("_bakorin_meta").select("value").where("key", "=", "schema_ast").executeTakeFirstOrThrow()).value;
      const { openPostgres } = await import("../packages/server/src/db/dialects.ts");
      const direct = openPostgres(runtime.ast.runtime.postgresUrl!);
      await direct.pool.query(`create function bakorin_boom() returns trigger language plpgsql as $$ begin if new.key = 'applied_at' then raise exception 'boom'; end if; return new; end $$`);
      await direct.pool.query(`create trigger boom before update on _bakorin_meta for each row execute function bakorin_boom()`);
      const dbUrl = runtime.ast.runtime.postgresUrl!;
      const v2 = compileAppYaml(`${postgresYaml(dbUrl)}  extras:\n    fields:\n      label: { type: text }\n`, { env: ENV });
      await expect(migrateToSchema(runtime.db, v2)).rejects.toThrow(/boom/);
      const exists = await direct.pool.query(`select count(*) as n from information_schema.tables where table_name = 'extras'`);
      expect(Number(exists.rows[0].n)).toBe(0);
      await direct.db.destroy();
      const after = (await runtime.db.selectFrom("_bakorin_meta").select("value").where("key", "=", "schema_ast").executeTakeFirstOrThrow()).value;
      expect(after).toBe(before);
    } finally {
      await runtime.close();
    }
  });

  test("M7: like matches case insensitively and treats % literally", async () => {
    const runtime = await bootPostgres();
    try {
      const signup = await signupAndLogin(client(runtime), { method: "POST", body: JSON.stringify({ email: "l@x.test", password: "password123", name: "L" }) });
      const token = (await signup.json()).data.accessToken;
      const api = client(runtime, token);
      for (const title of ["Hello World", "50% off", "plain"]) {
        await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title }) });
      }
      const hello = await (await api.fetch("/api/v1/items?filter[title][like]=hello")).json();
      expect(hello.data.map((row: any) => row.title)).toEqual(["Hello World"]);
      const percent = await (await api.fetch(`/api/v1/items?filter[title][like]=${encodeURIComponent("%")}`)).json();
      expect(percent.data.map((row: any) => row.title)).toEqual(["50% off"]);
    } finally {
      await runtime.close();
    }
  });

  test("M1: parallel refreshes on separate connections mint one successor", async () => {
    const runtime = await bootPostgres();
    try {
      const signup = await signupAndLogin(client(runtime), { method: "POST", body: JSON.stringify({ email: "r@x.test", password: "password123", name: "R" }) });
      const data = (await signup.json()).data;
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => client(runtime).fetch("/api/v1/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: data.refreshToken }) })),
      );
      expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
      const tokens = new Set(await Promise.all(results.map(async (res) => (await res.json()).data.refreshToken)));
      expect(tokens.size).toBe(1);
      const live = await runtime.db.selectFrom("_bakorin_refresh_tokens").selectAll().where("user_id", "=", data.user.id).where("revoked_at", "is", null).execute();
      expect(live.length).toBe(1);
    } finally {
      await runtime.close();
    }
  });

  test("M3 and M13 on Postgres: deleted user's token and cross user relations", async () => {
    const runtime = await bootPostgres();
    try {
      const first = await client(runtime).fetch("/api/v1/auth/first-admin", { method: "POST", body: JSON.stringify({ email: "boss@x.test", password: "password123", name: "Boss" }) });
      const admin = (await first.json()).data;
      const signup = await signupAndLogin(client(runtime), { method: "POST", body: JSON.stringify({ email: "u@x.test", password: "password123", name: "U" }) });
      const user = (await signup.json()).data;
      const adminItem = await client(runtime, admin.accessToken).fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "admin", ownerId: admin.user.id }) });
      expect(adminItem.status).toBe(201);
      // A non admin cannot claim a missing user id as owner (bad id gives 400 or 403, never 500).
      const bad = await client(runtime, user.accessToken).fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "x", ownerId: crypto.randomUUID() }) });
      expect([400, 403]).toContain(bad.status);
      await client(runtime, admin.accessToken).fetch(`/api/v1/users/${user.user.id}`, { method: "DELETE" });
      expect((await client(runtime, user.accessToken).fetch("/api/v1/auth/me")).status).toBe(401);
    } finally {
      await runtime.close();
    }
  });
});
