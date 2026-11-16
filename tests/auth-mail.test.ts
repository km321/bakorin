import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  clearLoggedMail,
  createRuntime,
  deliverMailById,
  drainMailOutbox,
  getLoggedMail,
  resetRateLimit,
  type Mailer,
  type MailMessage,
  type RuntimeHandles,
} from "@bakorin/server";
import { MAIL_OUTBOX_TABLE } from "../packages/server/src/db/system.ts";
import { redactToken, sealMail, unsealMail } from "../packages/server/src/mail/auth.ts";
import { sourceLabel } from "../packages/admin-ui/src/pages/Mail.tsx";
import { client, MINI_YAML, tempProject, waitForLoggedToken } from "./helpers.ts";

type Runtime = RuntimeHandles & { dir: string };

async function bootWith(files: Record<string, string> = {}): Promise<Runtime> {
  const dir = await tempProject(MINI_YAML);
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, "mail", name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, body);
  }
  const runtime = await createRuntime({ projectDir: dir, yamlSource: MINI_YAML, workers: false });
  return Object.assign(runtime, { dir });
}

function recordingMailer(failTimes = 0): Mailer & { sent: MailMessage[] } {
  let failures = failTimes;
  const mailer = {
    driver: "log" as const,
    sent: [] as MailMessage[],
    async send(message: MailMessage) {
      if (failures > 0) {
        failures -= 1;
        throw new Error("smtp 451 try later");
      }
      mailer.sent.push(message);
    },
  };
  return mailer;
}

async function authRows(runtime: Runtime, purpose?: string) {
  let query = runtime.db.selectFrom(MAIL_OUTBOX_TABLE).selectAll().where("source", "=", "auth");
  if (purpose) {
    query = query.where("purpose", "=", purpose);
  }
  return (await query.orderBy("created_at", "asc").execute()) as Array<Record<string, unknown>>;
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined>, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) {
      return value;
    }
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function setup(runtime: Runtime) {
  const http = client(runtime);
  const first = await http.fetch("/api/v1/auth/first-admin", {
    method: "POST",
    body: JSON.stringify({ email: "admin@studio.test", password: "password123", name: "Admin" }),
  });
  const admin = ((await first.json()) as { data: { accessToken: string } }).data.accessToken;
  const signup = await http.fetch("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email: "member@studio.test", password: "password123", name: "Member" }),
  });
  const member = (await signup.json()) as { data: { accessToken: string; user: { id: string } } };
  return { admin, member: member.data.accessToken, memberId: member.data.user.id };
}

describe("account emails go through the mail outbox", () => {
  let runtime: Runtime;
  let ids: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    resetRateLimit();
    clearLoggedMail();
    runtime = await bootWith();
    ids = await setup(runtime);
  });

  afterAll(async () => {
    await runtime.close();
  });

  test("signup queues a verify email, sent in the background, with the token only in the real send", async () => {
    const token = await waitForLoggedToken("verify");
    const row = await waitFor("sent verify row", async () => (await authRows(runtime, "verify")).find((r) => r.status === "sent"));
    expect(row.template).toBe("_auth/verify");
    expect(row.event).toBe("auth.verify");
    expect(JSON.parse(String(row.to_addrs))).toEqual(["member@studio.test"]);
    expect(String(row.html)).not.toContain(token);
    expect(String(row.body_text)).not.toContain(token);
    expect(String(row.body_text)).toContain("/verify-email?token=[redacted]");
    expect(row.sealed).toBeNull();
    const sent = getLoggedMail().find((mail) => mail.meta?.token === token);
    expect(sent?.text).toContain(`/verify-email?token=${token}`);
    expect(String(row.idempotency_key)).not.toContain(token);
  });

  test("forgot-password: same response for known and unknown emails, only known ones queue mail", async () => {
    const http = client(runtime);
    const before = (await authRows(runtime, "reset")).length;
    const missing = await http.fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@studio.test" }),
    });
    const known = await http.fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "member@studio.test" }),
    });
    expect(missing.status).toBe(known.status);
    expect(missing.status).toBe(200);
    expect(await missing.text()).toBe(await known.text());
    const rows = await waitFor("reset row", async () => {
      const list = await authRows(runtime, "reset");
      return list.length > before ? list : null;
    });
    expect(rows).toHaveLength(before + 1);
    expect(JSON.parse(String(rows.at(-1)?.to_addrs))).toEqual(["member@studio.test"]);
    const token = await waitForLoggedToken("reset");
    const reset = await http.fetch("/api/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "new-password-1" }),
    });
    expect(reset.status).toBe(200);
    // A password reset rejects access tokens issued before it, so the old one is now dead.
    expect((await client(runtime, ids.member).fetch("/api/v1/auth/me")).status).toBe(401);
    const login = await http.fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "member@studio.test", password: "new-password-1" }),
    });
    expect(login.status).toBe(200);
    ids.member = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
  });

  test("the admin delivery log labels system emails and never returns a token", async () => {
    const admin = client(runtime, ids.admin);
    const response = await admin.fetch("/api/v1/mail/deliveries?limit=100");
    expect(response.status).toBe(200);
    const raw = await response.text();
    for (const mail of getLoggedMail()) {
      if (mail.meta?.token) {
        expect(raw).not.toContain(mail.meta.token);
      }
    }
    const body = JSON.parse(raw) as { data: Array<{ source: string; purpose: string; subject: string }> };
    const system = body.data.filter((row) => row.source === "auth");
    expect(system.map((row) => row.purpose).sort()).toEqual(["reset", "verify"]);
    expect(sourceLabel({ source: "auth", purpose: "reset", ruleId: null })).toBe("system: reset");
    const member = await client(runtime, ids.member).fetch("/api/v1/mail/deliveries");
    expect(member.status).toBe(403);
  });

  test("invites and admin resend-verification are queued as system emails too", async () => {
    const admin = client(runtime, ids.admin);
    const invite = await admin.fetch("/api/v1/auth/invites", {
      method: "POST",
      body: JSON.stringify({ email: "new@studio.test", name: "New" }),
    });
    expect(invite.status).toBeLessThan(300);
    await waitFor("invite row", async () => (await authRows(runtime, "invite"))[0]);
    const verifyBefore = (await authRows(runtime, "verify")).length;
    const resend = await admin.fetch("/api/v1/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ userId: ids.memberId }),
    });
    expect(resend.status).toBeLessThan(300);
    await waitFor("second verify row", async () => {
      const list = await authRows(runtime, "verify");
      return list.length > verifyBefore ? list : null;
    });
  });

  test("system email preview uses a placeholder link, never a real token", async () => {
    const admin = client(runtime, ids.admin);
    const overview = (await (await admin.fetch("/api/v1/mail")).json()) as {
      data: { system: Array<{ kind: string; html: boolean }> };
    };
    expect(overview.data.system.map((item) => item.kind)).toEqual(["verify", "reset", "invite"]);
    expect(overview.data.system.every((item) => item.html === false)).toBe(true);
    const preview = await admin.fetch("/api/v1/mail/preview", {
      method: "POST",
      body: JSON.stringify({ template: "_auth/reset" }),
    });
    expect(preview.status).toBe(200);
    const raw = await preview.text();
    expect(raw).toContain("preview-token-not-valid");
    for (const mail of getLoggedMail()) {
      if (mail.meta?.token) {
        expect(raw).not.toContain(mail.meta.token);
      }
    }
    expect((JSON.parse(raw) as { data: { subject: string } }).data.subject).toBe("Reset your mini password");
    const forbidden = await client(runtime, ids.member).fetch("/api/v1/mail/preview", {
      method: "POST",
      body: JSON.stringify({ template: "_auth/reset" }),
    });
    expect(forbidden.status).toBe(403);
  });
});

describe("system email retries and idempotency", () => {
  test("a failing provider is retried with backoff and the link survives in the sealed copy", async () => {
    resetRateLimit();
    clearLoggedMail();
    const runtime = await bootWith();
    await setup(runtime);
    const flaky = recordingMailer(1);
    runtime.context.mailer = flaky;
    const response = await client(runtime).fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "member@studio.test" }),
    });
    expect(response.status).toBe(200);
    const pending = await waitFor("failed first attempt", async () =>
      (await authRows(runtime, "reset")).find((row) => Number(row.attempts) === 1 && row.status === "pending"),
    );
    expect(String(pending.last_error)).toBe("smtp 451 try later");
    expect(pending.sealed).toBeTruthy();
    expect(String(pending.sealed)).not.toContain("reset-password");
    const id = String(pending.id);
    await runtime.db.updateTable(MAIL_OUTBOX_TABLE).set({ next_attempt_at: new Date(0).toISOString() }).where("id", "=", id).execute();
    await drainMailOutbox(runtime.db, () => runtime.ast, () => flaky);
    expect(flaky.sent).toHaveLength(1);
    const token = flaky.sent[0]?.meta?.token ?? "";
    expect(token.length).toBeGreaterThan(10);
    expect(flaky.sent[0]?.text).toContain(`/reset-password?token=${token}`);
    expect(flaky.sent[0]?.idempotencyKey).toBe(id);
    const after = (await authRows(runtime, "reset")).find((row) => row.id === id)!;
    expect(after.status).toBe("sent");
    expect(after.sealed).toBeNull();
    expect(String(after.html)).not.toContain(token);
    expect(await deliverMailById(runtime.db, flaky, id, { secrets: [runtime.ast.runtime.jwtSecret] })).toBeNull();
    await drainMailOutbox(runtime.db, () => runtime.ast, () => flaky);
    expect(flaky.sent).toHaveLength(1);
    const used = await client(runtime).fetch("/api/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "after-retry-1" }),
    });
    expect(used.status).toBe(200);
    await runtime.close();
  });

  test("Retry is refused once the link expired, and a changed secret fails safely", async () => {
    resetRateLimit();
    const runtime = await bootWith();
    const ids = await setup(runtime);
    runtime.context.mailer = recordingMailer(100);
    await client(runtime).fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "member@studio.test" }),
    });
    const row = await waitFor("reset row", async () =>
      (await authRows(runtime, "reset")).find((item) => Number(item.attempts) >= 1),
    );
    const id = String(row.id);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await runtime.db.updateTable(MAIL_OUTBOX_TABLE).set({ status: "failed", created_at: old }).where("id", "=", id).execute();
    const admin = client(runtime, ids.admin);
    const expired = await admin.fetch(`/api/v1/mail/deliveries/${id}/retry`, { method: "POST" });
    expect(expired.status).toBe(409);
    expect(((await expired.json()) as { error: { message: string } }).error.message).toContain("expired");

    await runtime.db
      .updateTable(MAIL_OUTBOX_TABLE)
      .set({ status: "pending", next_attempt_at: new Date(0).toISOString(), created_at: new Date().toISOString() })
      .where("id", "=", id)
      .execute();
    const working = recordingMailer();
    expect(await deliverMailById(runtime.db, working, id, { secrets: ["a-different-secret-a-different-secret"] })).toBe("failed");
    expect(working.sent).toHaveLength(0);
    const failed = (await authRows(runtime, "reset")).find((item) => item.id === id)!;
    expect(String(failed.last_error)).toContain("JWT secret changed");
    await runtime.close();
  });

  test("sealing round trips with current or previous secret and redaction removes every copy", () => {
    const sealed = sealMail("secret-one-secret-one-secret-one-1", { html: "<a href=\"x?t=abc\">", text: "abc", meta: { purpose: "reset", token: "abc" } });
    expect(sealed).not.toContain("abc");
    expect(unsealMail(["other", "secret-one-secret-one-secret-one-1"], sealed)?.meta?.token).toBe("abc");
    expect(unsealMail(["wrong-secret"], sealed)).toBeNull();
    expect(redactToken("go to /r?token=abc or abc", "abc")).toBe("go to /r?token=[redacted] or [redacted]");
  });
});

describe("overridable system templates", () => {
  test("mail/_auth files override subject, html, and text, with the shared layout", async () => {
    resetRateLimit();
    clearLoggedMail();
    const runtime = await bootWith({
      "_layout.html": "<html><body><header>{{ app.name }}</header>{{{ body }}}</body></html>",
      "_auth/reset.html": '<p>Hi {{ email }}, <a href="{{ link }}">reset</a> within {{ expires }}.</p>',
      "_auth/reset.subject": "{{ app.name }}: password help",
    });
    await setup(runtime);
    await client(runtime).fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "member@studio.test" }),
    });
    const token = await waitForLoggedToken("reset");
    const mail = getLoggedMail().find((item) => item.meta?.token === token)!;
    expect(mail.subject).toBe("mini: password help");
    expect(mail.html).toContain("<header>mini</header>");
    expect(mail.html).toContain("Hi member@studio.test");
    expect(mail.html).toContain(`reset-password?token&#61;${token}`);
    expect(mail.html).toContain("within 1 hour");
    expect(mail.text).toContain(`reset (http://127.0.0.1:4371/reset-password?token=${token})`);
    const verify = getLoggedMail().find((item) => item.meta?.purpose === "verify");
    expect(verify?.subject).toBe("Verify your mini email");
    const overview = (await (
      await client(runtime, (await loginAdmin(runtime))).fetch("/api/v1/mail")
    ).json()) as { data: { system: Array<{ kind: string; html: boolean; subject: boolean }> } };
    expect(overview.data.system.find((item) => item.kind === "reset")).toMatchObject({ html: true, subject: true });
    await runtime.close();
  });

  test("an override without {{ link }} stops the server with a clear message", async () => {
    await expect(bootWith({ "_auth/invite.html": "<p>Welcome!</p>" })).rejects.toThrow(
      "mail/_auth/invite.html must include {{ link }}",
    );
    await expect(bootWith({ "_auth/verify.subject": "Click {{ link }}" })).rejects.toThrow(
      "mail/_auth/verify.subject must not include {{ link }}",
    );
  });
});

async function loginAdmin(runtime: Runtime): Promise<string> {
  const login = await client(runtime).fetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@studio.test", password: "password123" }),
  });
  return ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
}
