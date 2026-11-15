import { describe, expect, test } from "bun:test";
import { createMailer, createResendMailer, createRuntime, missingResendApiKeyMessage } from "@bakorin/server";
import { MINI_YAML, tempProject } from "./helpers.ts";

const PROD_SECRET = "prod-secret-prod-secret-prod-secret-ok";

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as typeof fetch;
}

describe("resend mail driver", () => {
  test("posts to api.resend.com with from, to, subject, html, and text", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = mockFetch((url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "email_test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const mailer = createResendMailer("test-resend-key", "Mini <noreply@mail.example.com>", fetcher);
    await mailer.send({
      to: "ada@studio.test",
      subject: "Reset your mini password",
      html: "<p>reset</p>",
      text: "reset",
      meta: { purpose: "reset", link: "http://127.0.0.1:4321/reset-password?token=abc" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init?.method).toBe("POST");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-resend-key");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.from).toBe("Mini <noreply@mail.example.com>");
    expect(body.to).toEqual(["ada@studio.test"]);
    expect(body.subject).toBe("Reset your mini password");
    expect(body.html).toBe("<p>reset</p>");
    expect(body.text).toBe("reset");
  });

  test("throws the Resend status and body when the API rejects the send", async () => {
    const fetcher = mockFetch(() => new Response(JSON.stringify({ message: "API key is invalid" }), { status: 401 }));
    const mailer = createResendMailer("test-resend-key", "Mini <noreply@mail.example.com>", fetcher);
    await expect(
      mailer.send({
        to: "ada@studio.test",
        subject: "Verify your mini email",
        html: "<p>verify</p>",
        text: "verify",
        meta: { purpose: "verify" },
      }),
    ).rejects.toThrow(/Resend 401:.*"API key is invalid"/);
  });

  test("createMailer(resend) without RESEND_API_KEY throws a clear error", () => {
    expect(() => createMailer({ MAIL_DRIVER: "resend" }, "Mini <noreply@localhost>")).toThrow(
      /RESEND_API_KEY is required when MAIL_DRIVER=resend/,
    );
  });

  test("missing key in production uses the loud startup message", () => {
    const env = { MAIL_DRIVER: "resend", NODE_ENV: "production" };
    expect(missingResendApiKeyMessage(env)).toContain("production startup failed");
    expect(missingResendApiKeyMessage(env)).toContain("RESEND_API_KEY");
    expect(() => createMailer(env, "Mini <noreply@mail.example.com>")).toThrow(/production startup failed/);
  });

  test("createRuntime refuses to start in production when MAIL_DRIVER=resend and the key is missing", async () => {
    const dir = await tempProject();
    await expect(
      createRuntime({
        projectDir: dir,
        yamlSource: MINI_YAML,
        env: {
          NODE_ENV: "production",
          JWT_SECRET: PROD_SECRET,
          CORS_ORIGINS: "https://app.test",
          MAIL_DRIVER: "resend",
          MAIL_FROM: "Mini <noreply@mail.example.com>",
        },
      }),
    ).rejects.toThrow(/production startup failed: MAIL_DRIVER=resend requires RESEND_API_KEY/);
  });

  test("createMailer(resend) with a key returns the resend driver", () => {
    const mailer = createMailer(
      { MAIL_DRIVER: "resend", RESEND_API_KEY: "test-resend-key" },
      "Mini <noreply@mail.example.com>",
    );
    expect(mailer.driver).toBe("resend");
  });
});
