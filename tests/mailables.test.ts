import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAppYaml, type ChangeEvent } from "@bakorin/core";
import {
  createResendMailer,
  createRuntime,
  deliverMailById,
  drainMailOutbox,
  escapeHtml,
  htmlToText,
  normalizeAddress,
  recoverStuckSends,
  renderTemplate,
  ruleMatches,
  type Mailer,
  type MailMessage,
  type RuntimeHandles,
} from "@bakorin/server";
import { MAIL_OUTBOX_TABLE } from "../packages/server/src/db/system.ts";
import { createPreviewToken, readPreviewToken } from "../packages/server/src/mail/routes.ts";
import { describeWhen } from "../packages/admin-ui/src/pages/Mail.tsx";
import { client, signupAndLogin } from "./helpers.ts";

const SECRET = "test-jwt-secret-0123456789-abcdefghijklmnop";

const SHOP_YAML = `
app:
  name: shop
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  files:
    path: ./data/uploads
  jwt:
    secret: ${SECRET}
  hooks: ./hooks.ts
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
      apiKey: { type: text, secret: true }
    policies:
      read: authenticated
      create: public
      update: owner(id)
      delete: admin
  orders:
    fields:
      number: { type: text, required: true }
      email: { type: email, required: true }
      total: { type: number, required: true }
      status: { type: enum, values: [pending, paid, refunded], default: pending }
      gift: { type: boolean, default: false }
      internalNote: { type: text, secret: true }
      customer: { type: relation, to: users }
    policies:
      read: authenticated
      create: authenticated
      update: authenticated
      delete: admin
  items:
    fields:
      title: { type: text, required: true }
    policies:
      read: authenticated
      create: authenticated
      update: authenticated
      delete: authenticated
`;

const SHOP_RULES = `
mail:
  - name: receipt
    entity: orders
    events: [create]
    to: "{{ record.email }}"
    bcc: ["books@shop.test"]
    replyTo: "Shop Support <support@shop.test>"
    subject: "Receipt for order {{ record.number }}"
    template: receipt
    expand: [customer]
  - name: paid
    entity: orders
    events: [update]
    changed: [status]
    when:
      status: paid
      total: { exists: true }
    to: ["{{ record.email }}", "ops@shop.test"]
    template: paid
`;

const TEMPLATES: Record<string, string> = {
  "_layout.html": "<html><body><div class=\"wrap\">{{{ body }}}</div><footer>{{ app.name }}</footer></body></html>",
  "receipt.html": [
    "<h1>Thanks {{ expand.customer.name }}</h1>",
    "<p>Order {{ record.number }} total {{ record.total }}</p>",
    "<p class=\"pw\">[{{ expand.customer.password }}][{{ expand.customer.apiKey }}][{{ record.internalNote }}]</p>",
    "{{#if record.gift}}<p>Gift wrapped</p>{{/if}}",
  ].join("\n"),
  "paid.html": "<p>Order {{ record.number }} is now {{ record.status }} (was {{ before.status }})</p>",
  "paid.subject": "Paid: {{ record.number }}",
  "welcome.html": "<p>Hello {{ name }}</p>",
  "welcome.txt": "Hello {{ name }}, plain version",
  "welcome.subject": "Welcome {{ name }}",
};

function fakeMailer(driver: Mailer["driver"] = "log", failTimes = 0): Mailer & { sent: MailMessage[]; calls: number } {
  let failures = failTimes;
  const mailer = {
    driver,
    sent: [] as MailMessage[],
    calls: 0,
    async send(message: MailMessage) {
      mailer.calls += 1;
      if (failures > 0) {
        failures -= 1;
        throw new Error("provider down");
      }
      mailer.sent.push(message);
    },
  };
  return mailer;
}

async function project(yaml: string, files: Record<string, string>, hooks = "export default { entities: {} };\n") {
  const dir = await mkdtemp(join(tmpdir(), "bakorin-mail-"));
  await writeFile(join(dir, "app.yaml"), yaml);
  await writeFile(join(dir, "hooks.ts"), hooks);
  await mkdir(join(dir, "data"), { recursive: true });
  await mkdir(join(dir, "mail"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, "mail", name), body);
  }
  return dir;
}

type Runtime = RuntimeHandles & { dir: string };

async function bootShop(options: { yaml?: string; files?: Record<string, string>; hooks?: string } = {}): Promise<Runtime> {
  const yaml = options.yaml ?? `${SHOP_YAML}${SHOP_RULES}`;
  const dir = await project(yaml, options.files ?? TEMPLATES, options.hooks);
  const runtime = await createRuntime({ projectDir: dir, yamlSource: yaml, workers: false });
  return Object.assign(runtime, { dir });
}

async function waitFor<T>(label: string, fn: () => Promise<T | undefined | null> | T | undefined | null, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) {
      return value;
    }
    await Bun.sleep(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Outbox rows from rules, hooks, and tests. Signup verify emails (source "auth") are covered in auth-mail.test.ts. */
async function outboxRows(runtime: Runtime) {
  return (await runtime.db
    .selectFrom(MAIL_OUTBOX_TABLE)
    .selectAll()
    .where("source", "!=", "auth")
    .orderBy("created_at", "asc")
    .execute()) as Array<Record<string, unknown>>;
}

async function tokens(runtime: Runtime) {
  const http = client(runtime);
  const first = await http.fetch("/api/v1/auth/first-admin", {
    method: "POST",
    body: JSON.stringify({ email: "ada@shop.test", password: "password123", name: "Ada" }),
  });
  expect(first.status).toBe(201);
  const admin = ((await first.json()) as { data: { accessToken: string; user: { id: string } } }).data;
  const signup = await signupAndLogin(http, {
    method: "POST",
    body: JSON.stringify({ email: "grace@shop.test", password: "password123", name: "Grace <b>Hopper</b>" }),
  });
  expect(signup.status).toBe(200);
  const member = ((await signup.json()) as { data: { accessToken: string; user: { id: string } } }).data;
  await runtime.db.updateTable("users").set({ apiKey: "hidden-api-key-value" }).where("id", "=", member.user.id).execute();
  return { admin: admin.accessToken, adminId: admin.user.id, member: member.accessToken, memberId: member.user.id };
}

describe("mail config validation", () => {
  const compile = (rules: string) => compileAppYaml(`${SHOP_YAML}${rules}`, { env: {} });

  test("compiles rules with lists, when, changed, and expand", () => {
    const ast = compile(SHOP_RULES);
    expect(ast.mail).toHaveLength(2);
    const [receipt, paid] = ast.mail;
    expect(receipt?.id).toBe("receipt");
    expect(receipt?.to).toEqual(["{{ record.email }}"]);
    expect(receipt?.bcc).toEqual(["books@shop.test"]);
    expect(receipt?.expand).toEqual(["customer"]);
    expect(receipt?.maxAttempts).toBe(8);
    expect(paid?.changed).toEqual(["status"]);
    expect(paid?.when).toEqual([
      { field: "status", op: "equals", value: "paid" },
      { field: "total", op: "exists", exists: true },
    ]);
  });

  test("readable errors for bad rules", () => {
    const base = "\nmail:\n  - entity: orders\n    events: [create]\n    to: \"{{ record.email }}\"\n    template: receipt\n";
    expect(() => compile(base.replace("entity: orders", "entity: invoices"))).toThrow(
      /mail rule #1: entity invoices does not exist \(known entities: users, orders, items\)/,
    );
    expect(() => compile(`${base}    expand: [total]\n`)).toThrow("expand field orders.total must be a relation field");
    expect(() => compile(`${base}    when: { nope: 1 }\n`)).toThrow("when field orders.nope does not exist");
    expect(() => compile(`${base}    when: { internalNote: x }\n`)).toThrow("when cannot test secret field");
    expect(() => compile(`${base}    changed: [status]\n`)).toThrow("changed only works with events: [update]");
    expect(() => compile(base.replace("{{ record.email }}", "{{ record.mail }}"))).toThrow(
      "references unknown field orders.mail",
    );
    expect(() => compile(base.replace("{{ record.email }}", "{{ expand.customer.email }}"))).toThrow(
      'needs "customer" in the rule\'s expand list',
    );
    expect(() => compile(base.replace("{{ record.email }}", "{{{ record.email }}}"))).toThrow("raw {{{ }}} output is not allowed");
    expect(() => compile(base.replace("{{ record.email }}", "{{ process.env }}"))).toThrow(
      "must start with record, before, expand, event, or app",
    );
    expect(() => compile(base.replace("template: receipt", "template: ../etc/passwd"))).toThrow(/template/);
    expect(() => compile(`${base}    bogus: true\n`)).toThrow('unknown key "bogus"');
    expect(() => compile(`${base}    when: { status: { in: [a], not: b } }\n`)).toThrow("exactly one of");
  });

  test("boot fails clearly when a template or subject is missing", async () => {
    const yaml = `${SHOP_YAML}${SHOP_RULES}`;
    const missing = await project(yaml, { "paid.html": "x", "paid.subject": "y" });
    await expect(createRuntime({ projectDir: missing, yamlSource: yaml, workers: false })).rejects.toThrow(
      "mail rule receipt: template receipt not found, add mail/receipt.html",
    );
    const noSubject = await project(yaml.replace('    subject: "Receipt for order {{ record.number }}"\n', ""), {
      "receipt.html": "x",
      "paid.html": "x",
      "paid.subject": "y",
    });
    await expect(
      createRuntime({
        projectDir: noSubject,
        yamlSource: yaml.replace('    subject: "Receipt for order {{ record.number }}"\n', ""),
        workers: false,
      }),
    ).rejects.toThrow("mail rule receipt: no subject");
    const broken = await project(yaml, { ...TEMPLATES, "receipt.html": "{{#if record.gift}}never closed" });
    await expect(createRuntime({ projectDir: broken, yamlSource: yaml, workers: false })).rejects.toThrow(
      "mail/receipt.html: {{#if}} is never closed",
    );
  });
});

describe("template engine", () => {
  test("escapes values by default (XSS)", () => {
    const html = renderTemplate(
      '<p title="{{ name }}">{{ name }}</p>',
      { name: `<script>alert("x")</script>' onmouseover=alert(1)` },
      "html",
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('"x"');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39; onmouseover&#61;alert(1)");
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });

  test("raw output is refused outside the layout body", () => {
    expect(() => renderTemplate("{{{ name }}}", { name: "<b>x</b>" }, "html")).toThrow("raw output {{{ name }}} is not allowed");
    expect(renderTemplate("<main>{{{ body }}}</main>", { body: "<b>x</b>" }, "html", { allowRaw: ["body"] })).toBe(
      "<main><b>x</b></main>",
    );
  });

  test("if, unless, each, else, and missing values", () => {
    const source =
      "{{#if vip}}VIP{{else}}regular{{/if}} {{#unless paid}}unpaid{{/unless}} {{#each items}}[{{ @index }}:{{ this.name }}]{{else}}none{{/each}} {{ missing.deep }}|";
    expect(renderTemplate(source, { vip: true, paid: false, items: [{ name: "a" }, { name: "<b>" }] }, "html")).toBe(
      "VIP unpaid [0:a][1:&lt;b&gt;] |",
    );
    expect(renderTemplate(source, { vip: 0, paid: true, items: [] }, "html")).toBe("regular  none |");
  });

  test("never reads inherited or prototype properties", () => {
    expect(renderTemplate("[{{ constructor }}][{{ record.__proto__ }}][{{ record.toString }}]", { record: {} }, "html")).toBe(
      "[][][]",
    );
  });

  test("text mode does not escape and rejects code-like expressions", () => {
    expect(renderTemplate("{{ a }}", { a: "Tom & Jerry <x>" }, "text")).toBe("Tom & Jerry <x>");
    expect(() => renderTemplate("{{ a + b }}", {}, "text")).toThrow("only dotted paths");
    expect(() => renderTemplate("{{#with a}}{{/with}}", {}, "text")).toThrow("unknown block");
  });

  test("auto text version strips tags, keeps links, decodes entities", () => {
    const text = htmlToText(
      '<html><head><style>p{}</style></head><body><h1>Hi &amp; welcome</h1><p>Line<br>two</p><a href="https://x.test/a">Open</a><ul><li>one</li></ul></body></html>',
    );
    expect(text).toBe("Hi & welcome\n\nLine\ntwo\n\nOpen (https://x.test/a)\n- one");
  });

  test("addresses: plain, named, and header injection attempts", () => {
    expect(normalizeAddress("a@b.co")).toBe("a@b.co");
    expect(normalizeAddress("Shop Support <support@shop.test>")).toBe("Shop Support <support@shop.test>");
    expect(normalizeAddress("a@b.co\r\nBcc: evil@x.test")).toBeNull();
    expect(normalizeAddress("not an email")).toBeNull();
    expect(normalizeAddress("<evil@x.test>, other@x.test")).toBeNull();
  });
});

describe("rule matching", () => {
  const ast = compileAppYaml(`${SHOP_YAML}${SHOP_RULES}`, { env: {} });
  const [receipt, paid] = ast.mail;
  const event = (op: ChangeEvent["op"], before: Record<string, unknown> | null, after: Record<string, unknown> | null): ChangeEvent => ({
    entity: "orders",
    op,
    before,
    after,
    actor: null,
  });

  test("matches entity and event", () => {
    expect(ruleMatches(receipt!, event("create", null, { status: "pending" }))).toBe(true);
    expect(ruleMatches(receipt!, event("delete", { status: "pending" }, null))).toBe(false);
    expect(ruleMatches(receipt!, { ...event("create", null, {}), entity: "items" })).toBe(false);
  });

  test("changed plus when: only when status becomes paid", () => {
    expect(ruleMatches(paid!, event("update", { status: "pending", total: 5 }, { status: "paid", total: 5 }))).toBe(true);
    expect(ruleMatches(paid!, event("update", { status: "paid", total: 5 }, { status: "paid", total: 6 }))).toBe(false);
    expect(ruleMatches(paid!, event("update", { status: "pending", total: 5 }, { status: "refunded", total: 5 }))).toBe(false);
    expect(ruleMatches(paid!, event("update", { status: "pending", total: null }, { status: "paid", total: null }))).toBe(false);
  });

  test("in, notIn, not, exists, and boolean storage", () => {
    const rules = compileAppYaml(
      `${SHOP_YAML}
mail:
  - entity: orders
    events: [create]
    to: a@b.co
    subject: s
    template: t
    when:
      status: { in: [paid, refunded] }
      number: { not: "0" }
      gift: true
      internalNote: { exists: false }
`.replace("      internalNote: { exists: false }\n", "      email: { notIn: [blocked@x.test] }\n"),
      { env: {} },
    ).mail;
    const rule = rules[0]!;
    const entity = ast.entityMap.orders;
    const base = { status: "paid", number: "7", gift: 1, email: "a@b.co" };
    expect(ruleMatches(rule, event("create", null, base), entity)).toBe(true);
    expect(ruleMatches(rule, event("create", null, { ...base, gift: 0 }), entity)).toBe(false);
    expect(ruleMatches(rule, event("create", null, { ...base, status: "pending" }), entity)).toBe(false);
    expect(ruleMatches(rule, event("create", null, { ...base, number: "0" }), entity)).toBe(false);
    expect(ruleMatches(rule, event("create", null, { ...base, email: "blocked@x.test" }), entity)).toBe(false);
    expect(describeWhen({ ...rule, replyTo: null, subject: null } as never)).toBe(
      "status in paid, refunded and number is not 0 and gift is true and email not in blocked@x.test",
    );
  });
});

describe("mail outbox", () => {
  let runtime: Runtime;
  let ids: Awaited<ReturnType<typeof tokens>>;
  let mailer: ReturnType<typeof fakeMailer>;

  beforeAll(async () => {
    runtime = await bootShop();
    ids = await tokens(runtime);
    mailer = fakeMailer();
    runtime.context.mailer = mailer;
  });

  afterAll(async () => {
    await runtime.close();
  });

  test("an order create queues a receipt with sanitized expansion, then sends once", async () => {
    const http = client(runtime, ids.member);
    const created = await http.fetch("/api/v1/orders", {
      method: "POST",
      body: JSON.stringify({
        number: "A-100",
        email: "buyer@shop.test",
        total: 42.5,
        gift: true,
        internalNote: "do not show",
        customer: ids.memberId,
      }),
    });
    expect(created.status).toBe(201);
    const row = await waitFor("receipt row", async () => (await outboxRows(runtime)).find((item) => item.rule_id === "receipt"));
    expect(row.status).toBe("pending");
    expect(JSON.parse(String(row.to_addrs))).toEqual(["buyer@shop.test"]);
    expect(JSON.parse(String(row.bcc_addrs))).toEqual(["books@shop.test"]);
    expect(row.reply_to).toBe("Shop Support <support@shop.test>");
    expect(row.subject).toBe("Receipt for order A-100");
    const html = String(row.html);
    expect(html).toContain("<h1>Thanks Grace &lt;b&gt;Hopper&lt;/b&gt;</h1>");
    expect(html).toContain('<p class="pw">[][][]</p>');
    expect(html).toContain("Gift wrapped");
    expect(html).toContain("<footer>shop</footer>");
    expect(html).not.toContain("hidden-api-key-value");
    expect(html).not.toContain("argon2");
    expect(html).not.toContain("do not show");
    expect(String(row.body_text)).toContain("Thanks Grace <b>Hopper</b>");

    await drainMailOutbox(runtime.db, () => runtime.ast, () => mailer);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.idempotencyKey).toBe(String(row.id));
    expect(mailer.sent[0]?.bcc).toEqual(["books@shop.test"]);
    await drainMailOutbox(runtime.db, () => runtime.ast, () => mailer);
    expect(await deliverMailById(runtime.db, mailer, String(row.id))).toBeNull();
    expect(mailer.sent).toHaveLength(1);
    const after = (await outboxRows(runtime)).find((item) => item.id === row.id);
    expect(after?.status).toBe("sent");
    expect(Number(after?.attempts)).toBe(1);
  });

  test("an update matching changed + when queues to a list of recipients", async () => {
    const http = client(runtime, ids.member);
    const created = await http.fetch("/api/v1/orders", {
      method: "POST",
      body: JSON.stringify({ number: "B-200", email: "b@shop.test", total: 10 }),
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    await http.fetch(`/api/v1/orders/${id}`, { method: "PATCH", body: JSON.stringify({ total: 11 }) });
    await http.fetch(`/api/v1/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status: "paid" }) });
    const row = await waitFor("paid row", async () => (await outboxRows(runtime)).find((item) => item.rule_id === "paid"));
    expect(JSON.parse(String(row.to_addrs))).toEqual(["b@shop.test", "ops@shop.test"]);
    expect(row.subject).toBe("Paid: B-200");
    expect(String(row.html)).toContain("is now paid (was pending)");
    await Bun.sleep(50);
    expect((await outboxRows(runtime)).filter((item) => item.rule_id === "paid")).toHaveLength(1);
  });

  test("retries with backoff, fails at maxAttempts, and Retry sends exactly once", async () => {
    const flaky = fakeMailer("log", 2);
    const http = client(runtime, ids.member);
    await http.fetch("/api/v1/orders", {
      method: "POST",
      body: JSON.stringify({ number: "C-300", email: "c@shop.test", total: 1 }),
    });
    const row = await waitFor("C-300", async () =>
      (await outboxRows(runtime)).find((item) => item.subject === "Receipt for order C-300"),
    );
    const id = String(row.id);
    await runtime.db.updateTable(MAIL_OUTBOX_TABLE).set({ max_attempts: 2 }).where("id", "=", id).execute();
    expect(await deliverMailById(runtime.db, flaky, id)).toBe("pending");
    let current = (await outboxRows(runtime)).find((item) => item.id === id)!;
    expect(Number(current.attempts)).toBe(1);
    expect(String(current.last_error)).toBe("provider down");
    expect(new Date(String(current.next_attempt_at)).getTime()).toBeGreaterThan(Date.now());
    expect(await deliverMailById(runtime.db, flaky, id)).toBeNull();
    await runtime.db.updateTable(MAIL_OUTBOX_TABLE).set({ next_attempt_at: new Date(0).toISOString() }).where("id", "=", id).execute();
    expect(await deliverMailById(runtime.db, flaky, id)).toBe("failed");
    current = (await outboxRows(runtime)).find((item) => item.id === id)!;
    expect(current.status).toBe("failed");
    expect(flaky.sent).toHaveLength(0);

    runtime.context.mailer = flaky;
    const admin = client(runtime, ids.admin);
    const retried = await admin.fetch(`/api/v1/mail/deliveries/${id}/retry`, { method: "POST" });
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as { data: { status: string } }).data.status).toBe("sent");
    expect(flaky.sent).toHaveLength(1);
    const again = await admin.fetch(`/api/v1/mail/deliveries/${id}/retry`, { method: "POST" });
    expect(again.status).toBe(409);
    await drainMailOutbox(runtime.db, () => runtime.ast, () => flaky);
    expect(flaky.sent.filter((message) => message.subject === "Receipt for order C-300")).toHaveLength(1);
    runtime.context.mailer = mailer;
  });

  test("a send interrupted mid-flight is never resent blindly", async () => {
    const http = client(runtime, ids.member);
    await http.fetch("/api/v1/orders", {
      method: "POST",
      body: JSON.stringify({ number: "D-400", email: "d@shop.test", total: 1 }),
    });
    const row = await waitFor("D-400", async () =>
      (await outboxRows(runtime)).find((item) => item.subject === "Receipt for order D-400"),
    );
    const stuck = { status: "sending", locked_until: new Date(Date.now() - 1000).toISOString() };
    await runtime.db.updateTable(MAIL_OUTBOX_TABLE).set(stuck).where("id", "=", String(row.id)).execute();
    expect(await recoverStuckSends(runtime.db, fakeMailer("smtp"))).toBe(1);
    let current = (await outboxRows(runtime)).find((item) => item.id === row.id)!;
    expect(current.status).toBe("failed");
    expect(String(current.last_error)).toContain("outcome unknown");

    await runtime.db.updateTable(MAIL_OUTBOX_TABLE).set(stuck).where("id", "=", String(row.id)).execute();
    expect(await recoverStuckSends(runtime.db, fakeMailer("resend"))).toBe(1);
    current = (await outboxRows(runtime)).find((item) => item.id === row.id)!;
    expect(current.status).toBe("pending");
    const resend = fakeMailer("resend");
    expect(await deliverMailById(runtime.db, resend, String(row.id))).toBe("sent");
    expect(resend.sent[0]?.idempotencyKey).toBe(String(row.id));
  });

  test("rows that never rendered fail visibly and cannot be retried", async () => {
    const yaml = `${SHOP_YAML}
mail:
  - entity: items
    events: [create]
    to: "{{ record.title }}"
    subject: "Item"
    template: welcome
`;
    const other = await bootShop({ yaml });
    const otherIds = await tokens(other);
    await client(other, otherIds.member).fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "not-an-address" }),
    });
    const row = await waitFor("bad address row", async () => (await outboxRows(other))[0]);
    expect(row.status).toBe("failed");
    expect(String(row.last_error)).toContain("invalid email address: not-an-address");
    const retry = await client(other, otherIds.admin).fetch(`/api/v1/mail/deliveries/${String(row.id)}/retry`, {
      method: "POST",
    });
    expect(retry.status).toBe(409);
    await other.close();
  });
});

describe("hook sends", () => {
  const hooks = `
export default {
  entities: {
    items: {
      async afterCreate(ctx) {
        await ctx.mail.send({
          to: ["team@shop.test"],
          template: "welcome",
          data: { name: ctx.record.title },
          idempotencyKey: "welcome-" + ctx.record.title,
        });
        await ctx.mail.send({
          to: "team@shop.test",
          subject: "Raw <hello>",
          html: "<p>inline</p>",
          idempotencyKey: "welcome-" + ctx.record.title,
        });
        await ctx.mail.send({ to: "ops@shop.test", subject: "Text only", text: "Just text" });
        await ctx.mail.send({ to: "{{ record.email }}", subject: "x", text: "y" }).catch((error) => {
          globalThis.__mailHookError = String(error.message);
        });
      },
    },
  },
};
`;

  test("ctx.mail.send queues through the outbox, dedupes by key, and never sends inline", async () => {
    const runtime = await bootShop({ hooks });
    const ids = await tokens(runtime);
    const mailer = fakeMailer();
    runtime.context.mailer = mailer;
    const response = await client(runtime, ids.member).fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "Kit <one>" }),
    });
    expect(response.status).toBe(201);
    const rows = await waitFor("hook rows", async () => {
      const list = await outboxRows(runtime);
      return list.length >= 3 && (globalThis as { __mailHookError?: string }).__mailHookError ? list : null;
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.source === "hook")).toBe(true);
    expect(rows.map((row) => row.status).sort()).toEqual(["failed", "pending", "pending"]);
    expect(JSON.parse(String(rows.find((row) => row.status === "failed")?.to_addrs))).toEqual([]);
    expect(mailer.calls).toBe(0);
    const welcome = rows.find((row) => row.template === "welcome")!;
    expect(welcome.subject).toBe("Welcome Kit <one>");
    expect(String(welcome.html)).toContain("<p>Hello Kit &lt;one&gt;</p>");
    expect(welcome.body_text).toBe("Hello Kit <one>, plain version");
    const textOnly = rows.find((row) => row.subject === "Text only")!;
    expect(String(textOnly.html)).toBe("<p>Just text</p>");
    expect((globalThis as { __mailHookError?: string }).__mailHookError).toContain("invalid email address");
    await drainMailOutbox(runtime.db, () => runtime.ast, () => mailer);
    expect(mailer.sent.map((message) => message.subject).sort()).toEqual(["Text only", "Welcome Kit <one>"]);
    await runtime.close();
  });
});

describe("admin mail endpoints", () => {
  let runtime: Runtime;
  let ids: Awaited<ReturnType<typeof tokens>>;
  let orderId = "";
  let mailer: ReturnType<typeof fakeMailer>;

  beforeAll(async () => {
    runtime = await bootShop();
    ids = await tokens(runtime);
    mailer = fakeMailer();
    runtime.context.mailer = mailer;
    const created = await client(runtime, ids.member).fetch("/api/v1/orders", {
      method: "POST",
      body: JSON.stringify({
        number: "<img src=x onerror=alert(1)>",
        email: "buyer@shop.test",
        total: 9,
        customer: ids.memberId,
      }),
    });
    orderId = ((await created.json()) as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await runtime.close();
  });

  const endpoints: Array<{ method: "GET" | "POST"; path: string; body?: unknown }> = [
    { method: "GET", path: "/api/v1/mail" },
    { method: "GET", path: "/api/v1/mail/deliveries" },
    { method: "POST", path: "/api/v1/mail/preview", body: { template: "receipt" } },
    { method: "POST", path: "/api/v1/mail/test", body: { template: "receipt" } },
    { method: "POST", path: "/api/v1/mail/deliveries/x/retry" },
  ];

  for (const endpoint of endpoints) {
    test(`${endpoint.method} ${endpoint.path}: 401 anonymous, 403 member`, async () => {
      const init = { method: endpoint.method, body: endpoint.body ? JSON.stringify(endpoint.body) : undefined };
      expect((await client(runtime).fetch(endpoint.path, init)).status).toBe(401);
      expect((await client(runtime, ids.member).fetch(endpoint.path, init)).status).toBe(403);
    });
  }

  test("GET /api/v1/mail lists templates and rules for admins", async () => {
    const response = await client(runtime, ids.admin).fetch("/api/v1/mail");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { driver: string; layout: boolean; templates: Array<{ name: string; rules: string[] }>; rules: Array<{ id: string }> };
    };
    expect(body.data.driver).toBe("log");
    expect(body.data.layout).toBe(true);
    expect(body.data.templates.map((item) => item.name)).toEqual(["paid", "receipt", "welcome"]);
    expect(body.data.templates.find((item) => item.name === "receipt")?.rules).toEqual(["receipt"]);
    expect(body.data.rules.map((rule) => rule.id)).toEqual(["receipt", "paid"]);
  });

  test("preview renders sample data and real records, escaped and sanitized", async () => {
    const admin = client(runtime, ids.admin);
    const sample = await admin.fetch("/api/v1/mail/preview", { method: "POST", body: JSON.stringify({ ruleId: "receipt" }) });
    expect(sample.status).toBe(200);
    const sampleBody = (await sample.json()) as { data: { sample: boolean; subject: string; to: string[] } };
    expect(sampleBody.data.sample).toBe(true);
    expect(sampleBody.data.subject).toBe("Receipt for order Sample number");
    expect(sampleBody.data.to).toEqual(["customer@example.com"]);

    const real = await admin.fetch("/api/v1/mail/preview", {
      method: "POST",
      body: JSON.stringify({ template: "receipt", entity: "orders", recordId: orderId }),
    });
    expect(real.status).toBe(200);
    const realBody = (await real.json()) as { data: { html: string; text: string; subject: string; frameUrl: string; ruleId: string } };
    expect(realBody.data.ruleId).toBe("receipt");
    expect(realBody.data.html).toContain("&lt;img src&#61;x onerror&#61;alert(1)&gt;");
    expect(realBody.data.html).not.toContain("<img");
    expect(realBody.data.html).not.toContain("hidden-api-key-value");
    expect(realBody.data.subject).toBe("Receipt for order <img src=x onerror=alert(1)>");

    const frame = await client(runtime).fetch(realBody.data.frameUrl);
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-security-policy")).toContain("sandbox");
    expect(frame.headers.get("content-security-policy")).not.toContain("script-src");
    expect(frame.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(await frame.text()).toContain("Thanks Grace");
    const forged = await client(runtime).fetch(`${realBody.data.frameUrl}x`);
    expect(forged.status).toBe(403);

    const missing = await admin.fetch("/api/v1/mail/preview", {
      method: "POST",
      body: JSON.stringify({ template: "receipt", entity: "orders", recordId: "nope" }),
    });
    expect(missing.status).toBe(404);
    const noTemplate = await admin.fetch("/api/v1/mail/preview", { method: "POST", body: JSON.stringify({ template: "ghost" }) });
    expect(noTemplate.status).toBe(422);
  });

  test("preview tokens expire and need the server secret", () => {
    const token = createPreviewToken(SECRET, { template: "receipt" }, "admin-id", 1000);
    expect(readPreviewToken([SECRET], token, 2000)?.template).toBe("receipt");
    expect(readPreviewToken([SECRET], token, 1000 + 6 * 60 * 1000)).toBeNull();
    expect(readPreviewToken(["other-secret-other-secret-other-1"], token, 2000)).toBeNull();
  });

  test("a frame token for a demoted admin stops working", async () => {
    const token = createPreviewToken(SECRET, { template: "receipt" }, ids.memberId);
    const response = await client(runtime).fetch(`/api/v1/mail/frame?token=${encodeURIComponent(token)}`);
    expect(response.status).toBe(403);
  });

  test("send test to me delivers to the signed-in admin only", async () => {
    const response = await client(runtime, ids.admin).fetch("/api/v1/mail/test", {
      method: "POST",
      body: JSON.stringify({ ruleId: "receipt", recordId: orderId }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { status: string; to: string[]; source: string; subject: string } };
    expect(body.data.status).toBe("sent");
    expect(body.data.to).toEqual(["ada@shop.test"]);
    expect(body.data.source).toBe("test");
    expect(mailer.sent.at(-1)?.to).toEqual(["ada@shop.test"]);
    expect(mailer.sent.at(-1)?.bcc).toEqual([]);
    expect(mailer.sent.at(-1)?.subject.startsWith("[Test] Receipt for order")).toBe(true);
  });

  test("delivery log paginates and filters by status", async () => {
    await waitFor("receipt queued", async () => (await outboxRows(runtime)).find((row) => row.rule_id === "receipt"));
    const admin = client(runtime, ids.admin);
    const all = (await (await admin.fetch("/api/v1/mail/deliveries?limit=1")).json()) as {
      data: Array<{ status: string }>;
      meta: { total: number };
    };
    const authRows = await runtime.db.selectFrom(MAIL_OUTBOX_TABLE).select("id").where("source", "=", "auth").execute();
    expect(authRows.length).toBeGreaterThan(0);
    expect(all.meta.total).toBe(2 + authRows.length);
    expect(all.data).toHaveLength(1);
    const sent = (await (await admin.fetch("/api/v1/mail/deliveries?status=sent")).json()) as {
      data: Array<{ status: string; source: string }>;
    };
    expect(sent.data.map((row) => row.source).filter((source) => source !== "auth")).toEqual(["test"]);
    const pending = (await (await admin.fetch("/api/v1/mail/deliveries?status=pending")).json()) as {
      data: Array<{ ruleId: string }>;
    };
    expect(pending.data.map((row) => row.ruleId)).toEqual(["receipt"]);
  });
});

describe("mail drivers", () => {
  test("resend sends lists, cc, bcc, reply_to, and an idempotency key", async () => {
    let captured: { headers: Headers; body: Record<string, unknown> } | null = null;
    const fetcher = (async (_url: string, init?: RequestInit) => {
      captured = { headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const mailer = createResendMailer("key", "Shop <noreply@shop.test>", fetcher);
    await mailer.send({
      to: ["a@shop.test", "b@shop.test"],
      cc: ["c@shop.test"],
      bcc: ["d@shop.test"],
      replyTo: "help@shop.test",
      subject: "s",
      html: "<p>h</p>",
      text: "h",
      idempotencyKey: "delivery-1",
    });
    expect(captured!.headers.get("idempotency-key")).toBe("delivery-1");
    expect(captured!.body.to).toEqual(["a@shop.test", "b@shop.test"]);
    expect(captured!.body.cc).toEqual(["c@shop.test"]);
    expect(captured!.body.bcc).toEqual(["d@shop.test"]);
    expect(captured!.body.reply_to).toBe("help@shop.test");
  });
});
