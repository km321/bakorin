// json and richtext field types: compiler, types, builder, sanitizer, CRUD, filters,
// permissions, OpenAPI, and migrations. The CRUD tests run on SQLite, and on Postgres
// in the CI matrix (BAKORIN_TEST_DIALECT=postgres).
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compileAppYaml, generateTypes } from "@bakorin/core";
import { builderIssues, importAppYaml, toAppYaml } from "../packages/core/src/builder.ts";
import { buildOpenApi, resetRateLimit } from "@bakorin/server";
import { isRichTextEmpty, richTextToPlain, safeUrl, sanitizeRichText } from "@bakorin/sdk/richtext";
import { boot, MINI_YAML, TEST_DIALECT } from "./helpers.ts";

const ENV = { env: { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" } };

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const FIELDS_YAML = MINI_YAML.replace(
  "entities:\n",
  `entities:
  articles:
    fields:
      title: { type: text, required: true }
      body: { type: richtext }
      summary: { type: richtext, required: true, default: "<p>Coming soon</p><script>x()</script>" }
      settings: { type: json }
      tags: { type: json, default: ["new"] }
      internal: { type: json, private: true }
      reviewNotes: { type: richtext, writable: admin }
    policies:
      read: public
      create: authenticated
      update: authenticated
      delete: authenticated
`,
);

type Runtime = Awaited<ReturnType<typeof boot>>;

async function started(yaml = FIELDS_YAML) {
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
  return login.json.data.accessToken as string;
}

async function admin(runtime: Runtime) {
  const res = await call(runtime, "POST", "/api/v1/auth/first-admin", { email: "boss@example.test", password: "password123", name: "Boss" });
  return res.json.data.accessToken as string;
}

describe("json and richtext in app.yaml", () => {
  test("compile with the right flags and reject what cannot work", () => {
    const ast = compileAppYaml(FIELDS_YAML, ENV);
    const articles = ast.entityMap.articles!;
    expect(articles.fieldMap.body?.type).toBe("richtext");
    expect(articles.fieldMap.settings?.type).toBe("json");
    expect(articles.fieldMap.tags?.defaultValue).toEqual(["new"]);
    expect(articles.fieldMap.internal?.private).toBe(true);

    const bad = (field: string) => () => compileAppYaml(FIELDS_YAML.replace("settings: { type: json }", field), ENV);
    expect(bad("settings: { type: json, unique: true }")).toThrow(/json field and cannot be unique or indexed/);
    expect(bad("settings: { type: json, index: true }")).toThrow(/json field and cannot be unique or indexed/);
    expect(bad("settings: { type: richtext, unique: true }")).toThrow(/richtext field and cannot be unique/);
    expect(bad("settings: { type: richtext, default: 3 }")).toThrow(/default must be a string of HTML/);
    expect(bad("settings: { type: jsonb }")).toThrow(/unknown field type "jsonb".*json, richtext/);
  });

  test("typegen: JsonValue for json, string for richtext, no alias when unused", () => {
    const types = generateTypes(compileAppYaml(FIELDS_YAML, ENV));
    expect(types).toContain("export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };");
    expect(types).toContain("  settings?: JsonValue;");
    expect(types).toContain("  body?: string;");
    expect(types).toContain('"type": "richtext"');
    expect(generateTypes(compileAppYaml(MINI_YAML, ENV))).not.toContain("JsonValue");
  });

  test("config builder: json defaults round trip and are checked", () => {
    const imported = importAppYaml(FIELDS_YAML);
    const articles = imported.config.entities.find((entity) => entity.name === "articles")!;
    const tags = articles.fields.find((field) => field.name === "tags")!;
    expect(tags.type).toBe("json");
    expect(tags.defaultValue).toBe('["new"]');
    expect(articles.fields.find((field) => field.name === "body")!.type).toBe("richtext");
    const yaml = toAppYaml(imported.config);
    expect(compileAppYaml(yaml, ENV).entityMap.articles?.fieldMap.tags?.defaultValue).toEqual(["new"]);

    tags.defaultValue = "{ not json";
    tags.index = true;
    const issues = builderIssues(imported.config).map((issue) => issue.message);
    expect(issues).toContain("Default must be valid JSON, for example {} or [].");
    expect(issues).toContain("JSON fields cannot be unique or indexed.");
  });
});

describe("sanitizeRichText", () => {
  const cases: Array<[string, string]> = [
    ["<p>Hi <strong>there</strong><script>alert(1)</script></p>", "<p>Hi <strong>there</strong></p>"],
    ['<img src=x onerror="alert(1)">', '<img src="x" alt="">'],
    ['<img src="javascript:alert(1)">', ""],
    ['<img src="data:image/png;base64,AAAA">', ""],
    ['<a href="javascript:alert(1)">a</a>', "<a>a</a>"],
    ['<a href=" JaVa&#x09;ScRiPt:alert(1)">a</a>', "<a>a</a>"],
    ['<a href="&#106;avascript:alert(1)">a</a>', "<a>a</a>"],
    ['<a href="data:text/html,<script>x</script>">a</a>', "<a>a</a>"],
    ['<a href="vbscript:msgbox(1)">a</a>', "<a>a</a>"],
    ['<a href="https://example.com" target="_blank" onclick="x()">a</a>', '<a href="https://example.com" target="_blank" rel="noopener noreferrer">a</a>'],
    ['<a href="/docs?q=1#top">a</a>', '<a href="/docs?q=1#top">a</a>'],
    ['<a href="mailto:hello@example.com">a</a>', '<a href="mailto:hello@example.com">a</a>'],
    ["<svg><script>alert(1)</script><p>x</p></svg>after", "after"],
    ['<iframe src="https://example.com"></iframe>ok', "ok"],
    ["<style>body{display:none}</style><p>ok</p>", "<p>ok</p>"],
    ['<p style="color:red" class="x" id="y">t</p>', "<p>t</p>"],
    ["<div><span>kept text</span></div>", "kept text"],
    ["<p>unclosed <em>emphasis", "<p>unclosed <em>emphasis</em></p>"],
    ["<!-- comment --><p>&lt;script&gt;</p>", "<p>&lt;script&gt;</p>"],
    ['<pre><code class="language-ts evil">a &lt; b</code></pre>', '<pre><code class="language-ts">a &lt; b</code></pre>'],
    ['<a title="&quot; onmouseover=&quot;x()" href="/a">t</a>', '<a href="/a" title="&quot; onmouseover=&quot;x()">t</a>'],
    ['<form action="/x"><input name="a"><button>Go</button></form>', "Go"],
    ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>y', "y"],
    ["<h2>Title</h2><ul><li>One</li></ul><ol start=\"3\"><li>Three</li></ol><blockquote>Q</blockquote><hr>", "<h2>Title</h2><ul><li>One</li></ul><ol start=\"3\"><li>Three</li></ol><blockquote>Q</blockquote><hr>"],
  ];
  for (const [input, output] of cases) {
    test(input.slice(0, 60), () => {
      const clean = sanitizeRichText(input);
      expect(clean).toBe(output);
      // Cleaning clean HTML changes nothing.
      expect(sanitizeRichText(clean)).toBe(clean);
    });
  }

  test("safeUrl, plain text, and empty checks", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeUrl("java\nscript:alert(1)")).toBeNull();
    expect(safeUrl("weird:thing")).toBeNull();
    expect(safeUrl("folder/a:b")).toBe("folder/a:b");
    expect(richTextToPlain("<h2>Hello</h2><p>big <b>world</b></p><script>x</script>")).toBe("Hello big world");
    expect(richTextToPlain("<p>abcdefghij</p>", 8)).toBe("abcde...");
    expect(isRichTextEmpty("<p></p>")).toBe(true);
    expect(isRichTextEmpty('<p><img src="/a.png"></p>')).toBe(false);
  });
});

describe(`json and richtext over REST (${TEST_DIALECT})`, () => {
  test("json keeps every JSON type exactly, and richtext is cleaned on create and update", async () => {
    const runtime = await started();
    const token = await user(runtime, "writer@example.test");
    const values: unknown[] = [{ theme: "dark", nested: { list: [1, 2, { ok: true }] } }, [1, "two", null], "a plain string", '{"looks":"like json"}', 42.5, false];
    for (const settings of values) {
      const created = await call(runtime, "POST", "/api/v1/articles", { title: "T", settings, body: "<p>Hello</p><script>steal()</script>" }, token);
      expect(created.status).toBe(201);
      expect(created.json.data.settings).toEqual(settings);
      expect(created.json.data.body).toBe("<p>Hello</p>");
      // Defaults: the json default and the cleaned richtext default.
      expect(created.json.data.tags).toEqual(["new"]);
      expect(created.json.data.summary).toBe("<p>Coming soon</p>");
      const read = await call(runtime, "GET", `/api/v1/articles/${created.json.data.id}`);
      expect(read.json.data.settings).toEqual(settings);
      expect(typeof read.json.data.settings).toBe(typeof settings);
    }

    const created = await call(runtime, "POST", "/api/v1/articles", { title: "Edit me", settings: { a: 1 } }, token);
    const id = created.json.data.id;
    const patched = await call(
      runtime,
      "PATCH",
      `/api/v1/articles/${id}`,
      { settings: { a: 2, b: [true] }, body: '<p onclick="x()">Safe <a href="javascript:x()">link</a></p>' },
      token,
    );
    expect(patched.status).toBe(200);
    expect(patched.json.data.settings).toEqual({ a: 2, b: [true] });
    expect(patched.json.data.body).toBe("<p>Safe <a>link</a></p>");
    const cleared = await call(runtime, "PATCH", `/api/v1/articles/${id}`, { settings: null }, token);
    expect(cleared.json.data.settings).toBeNull();

    if (TEST_DIALECT === "postgres") {
      const columns = await runtime.db
        .selectFrom("information_schema.columns")
        .select(["column_name", "data_type"])
        .where("table_name", "=", "articles")
        .where("column_name", "in", ["settings", "body"])
        .execute();
      expect(Object.fromEntries(columns.map((row) => [String(row.column_name), String(row.data_type)]))).toEqual({ settings: "jsonb", body: "text" });
    }
    // The stored value really is clean, not only the response.
    const row = await runtime.db.selectFrom("articles").select(["body"]).where("id", "=", id).executeTakeFirst();
    expect(row?.body).toBe("<p>Safe <a>link</a></p>");
  });

  test("bad values get a clear 400", async () => {
    const runtime = await started();
    const token = await user(runtime, "writer@example.test");
    const notString = await call(runtime, "POST", "/api/v1/articles", { title: "T", body: { html: "<p>x</p>" } }, token);
    expect(notString.status).toBe(400);
    expect(notString.json.error.message).toBe("body must be a string of HTML");

    const onlyScript = await call(runtime, "POST", "/api/v1/articles", { title: "T", summary: "<script>x()</script>" }, token);
    expect(onlyScript.status).toBe(400);
    expect(onlyScript.json.error.message).toBe("summary is required");

    let deep: unknown = 1;
    for (let i = 0; i < 70; i++) deep = [deep];
    const tooDeep = await call(runtime, "POST", "/api/v1/articles", { title: "T", settings: deep }, token);
    expect(tooDeep.status).toBe(400);
    expect(tooDeep.json.error.message).toContain("nested too deeply");

    const huge = await call(runtime, "POST", "/api/v1/articles", { title: "T", settings: { text: "x".repeat(1_000_001) } }, token);
    expect(huge.status).toBe(400);
    expect(huge.json.error.message).toContain("too large");

    const res = await runtime.app.request("/api/v1/articles", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: '{"title":"T","settings":{bad json}',
    });
    expect(res.status).toBe(400);
  });

  test("filters: isnull and like on json, eq is ignored, json cannot be sorted", async () => {
    const runtime = await started();
    const token = await user(runtime, "writer@example.test");
    await call(runtime, "POST", "/api/v1/articles", { title: "A", settings: { color: "Teal" }, body: "<p>Harbor lights</p>" }, token);
    await call(runtime, "POST", "/api/v1/articles", { title: "B", settings: { color: "amber" } }, token);
    await call(runtime, "POST", "/api/v1/articles", { title: "C" }, token);
    const titles = async (query: string) =>
      ((await call(runtime, "GET", `/api/v1/articles?sort=title&${query}`)).json.data as Array<{ title: string }>).map((row) => row.title);
    expect(await titles("filter[settings][isnull]=true")).toEqual(["C"]);
    expect(await titles("filter[settings][isnull]=false")).toEqual(["A", "B"]);
    expect(await titles("filter[settings][like]=teal")).toEqual(["A"]);
    expect(await titles("filter[settings]=x")).toEqual(["A", "B", "C"]);
    expect(await titles("filter[body][like]=harbor")).toEqual(["A"]);
    const sorted = await call(runtime, "GET", "/api/v1/articles?sort=settings");
    expect(sorted.status).toBe(200);
  });

  test("permissions: private json is hidden from users, admin only richtext is refused", async () => {
    const runtime = await started();
    const bossToken = await admin(runtime);
    const token = await user(runtime, "writer@example.test");
    const byBoss = await call(runtime, "POST", "/api/v1/articles", { title: "P", internal: { score: 9 }, reviewNotes: "<p>ok</p>" }, bossToken);
    expect(byBoss.status).toBe(201);
    const asUser = await call(runtime, "GET", `/api/v1/articles/${byBoss.json.data.id}`, undefined, token);
    expect(asUser.json.data.internal).toBeUndefined();
    const asBoss = await call(runtime, "GET", `/api/v1/articles/${byBoss.json.data.id}`, undefined, bossToken);
    expect(asBoss.json.data.internal).toEqual({ score: 9 });
    const notAllowed = await call(runtime, "POST", "/api/v1/articles", { title: "P", reviewNotes: "<p>no</p>" }, token);
    expect(notAllowed.status).toBe(403);
  });

  test("adding json and richtext fields to an existing entity migrates in place", async () => {
    const runtime = await started(MINI_YAML);
    const token = await user(runtime, "writer@example.test");
    const item = await call(runtime, "POST", "/api/v1/items", { title: "Before" }, token);
    expect(item.status).toBe(201);
    const source = await Bun.file(join(runtime.dir, "app.yaml")).text();
    await runtime.reload(
      source.replace(
        "done: { type: boolean, default: false }",
        'done: { type: boolean, default: false }\n      meta: { type: json, default: { "v": 1 } }\n      notes: { type: richtext }',
      ),
    );
    const read = await call(runtime, "GET", `/api/v1/items/${item.json.data.id}`, undefined, token);
    expect(read.json.data.meta).toEqual({ v: 1 });
    const patched = await call(runtime, "PATCH", `/api/v1/items/${item.json.data.id}`, { notes: "<h2>Hi</h2><img src=x onerror=y>" }, token);
    expect(patched.json.data.notes).toBe('<h2>Hi</h2><img src="x" alt="">');
  });

  test("OpenAPI describes both types", async () => {
    const runtime = await started();
    const doc = buildOpenApi(runtime.ast) as {
      components: { schemas: Record<string, { properties: Record<string, Record<string, unknown>> }> };
      paths: Record<string, Record<string, { parameters?: Array<{ name: string }> }>>;
    };
    const schema = Object.entries(doc.components.schemas).find(([name]) => /^Article/i.test(name) && !/write|create|update/i.test(name))?.[1];
    expect(schema?.properties.settings).toEqual({});
    expect(schema?.properties.body?.contentMediaType).toBe("text/html");
    const params = doc.paths["/api/v1/articles"]?.get?.parameters?.map((param) => param.name) ?? [];
    expect(params).toContain("filter[settings][isnull]");
    expect(params).not.toContain("filter[settings]");
    expect(params).toContain("filter[body]");
  });
});
