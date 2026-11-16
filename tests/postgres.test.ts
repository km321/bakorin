import { describe, expect, test } from "bun:test";
import { bootPostgres, client, MINI_YAML } from "./helpers.ts";
import { deliverMailById, exportPortable, importPortable, type MailMessage } from "@bakorin/server";
import { AUDIT_TABLE, MAIL_OUTBOX_TABLE, WEBHOOK_OUTBOX_TABLE } from "../packages/server/src/db/system.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("postgres", () => {
  test("migrator applies and auth works", async () => {
    const runtime = await bootPostgres();
    const signup = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada West" }),
    });
    expect(signup.status).toBe(201);
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
    const signup = await client(runtime).fetch("/api/v1/auth/signup", {
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

    const staff = await client(runtime).fetch("/api/v1/auth/signup", {
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
    const signup = await client(runtime).fetch("/api/v1/auth/signup", {
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
    const signup = await client(runtime).fetch("/api/v1/auth/signup", {
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
