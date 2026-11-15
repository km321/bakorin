import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime } from "@bakorin/server";
import { compileAppYaml, FIELD_TYPES, serializeAst } from "@bakorin/core";
import {
  BUILDER_FIELD_TYPES,
  emptyEntity,
  emptyField,
  emptyMailRule,
  importAppYaml,
  toAppYaml,
  validateConfig,
  type BuilderConfig,
} from "../packages/core/src/builder.ts";
import { client, tempProject } from "./helpers.ts";

const ROOT = join(import.meta.dir, "..");
const ENV = { env: {}, production: false };

/** Starters the website offers, read from website/src/builder/starters.ts so the test follows the page. */
async function starterSources(): Promise<string[]> {
  const text = await Bun.file(join(ROOT, "website/src/builder/starters.ts")).text();
  return [...text.matchAll(/source: "([^"]+)"/g)].map((match) => match[1]!);
}

async function starterYaml(source: string): Promise<string> {
  return (await Bun.file(join(ROOT, source)).text()).replaceAll("{{APP_NAME}}", "my-app");
}

describe("config builder", () => {
  test("offers exactly the field types the server accepts", () => {
    expect([...BUILDER_FIELD_TYPES]).toEqual([...FIELD_TYPES]);
  });

  test("every website starter round-trips through the builder and passes server validation", async () => {
    const sources = await starterSources();
    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const source of sources) {
      const original = await starterYaml(source);
      const { config, warnings } = importAppYaml(original);
      expect({ source, warnings }).toEqual({ source, warnings: [] });
      const result = validateConfig(config);
      const errors = result.issues.filter((issue) => issue.severity === "error");
      expect({ source, errors }).toEqual({ source, errors: [] });
      expect(result.ast).toBeTruthy();
      // Same compiled schema as the original file, so nothing was lost or changed.
      expect(serializeAst(compileAppYaml(result.yaml, ENV))).toBe(serializeAst(compileAppYaml(original, ENV)));
      // Output is stable: importing the output gives the same output again.
      expect(toAppYaml(importAppYaml(result.yaml).config)).toBe(result.yaml);
    }
  });

  test("errors point at the form field that caused them", () => {
    const { config } = importAppYaml(
      `app: { name: demo }\nentities:\n  users:\n    auth: true\n    fields:\n      email: { type: email, required: true }\n      password: { type: password, required: true }\n      role: { type: enum, values: [user, admin] }\n  posts:\n    fields:\n      title: { type: text }\n      authorId: { type: relation, to: users }\n    policies:\n      update: owner(authorId)\n`,
    );
    expect(validateConfig(config).issues.filter((issue) => issue.severity === "error")).toEqual([]);

    // Builder check: duplicate field names would silently collapse in YAML.
    const dup = structuredClone(config);
    dup.entities[1]!.fields.push(emptyField("title", "text"));
    expect(validateConfig(dup).issues).toContainEqual({
      target: "entities.1.fields.2.name",
      message: "Another field in posts is named title.",
      severity: "error",
    });

    // Server compiler check: relation to an entity that does not exist.
    const badRelation = structuredClone(config);
    badRelation.entities[1]!.fields[1]!.to = "people";
    const relationIssue = validateConfig(badRelation).issues[0]!;
    expect(relationIssue.target).toBe("entities.1.fields.1.to");
    expect(relationIssue.message).toContain("relates to unknown entity people");

    // Server compiler check: owner() on a field that is gone.
    const badPolicy = structuredClone(config);
    badPolicy.entities[1]!.fields[1]!.name = "writerId";
    const policyIssue = validateConfig(badPolicy).issues[0]!;
    expect(policyIssue.target).toBe("entities.1.policies.update");

    // Server Zod schema check: an invalid policy expression.
    const badExpr = structuredClone(config);
    badExpr.entities[1]!.policies.read = ["everyone"];
    const exprIssue = validateConfig(badExpr).issues[0]!;
    expect(exprIssue.target).toBe("entities.1.policies.read");
    expect(exprIssue.message).toContain("invalid policy");

    // Auth checks come from the compiler too.
    const badAuth = structuredClone(config);
    badAuth.auth.adminRole = "owner";
    expect(validateConfig(badAuth).issues[0]!.target).toBe("auth.adminRole");

    // Mail rule placeholders are checked against the entity.
    const badMail = structuredClone(config);
    badMail.mail.push({ ...emptyMailRule("posts"), to: "{{ record.missing }}", template: "post-created", subject: "Hi" });
    const mailIssue = validateConfig(badMail).issues[0]!;
    expect(mailIssue.target).toBe("mail.0.to");
    expect(mailIssue.message).toContain("unknown field posts.missing");
  });

  test("a config built with the builder boots the server and serves its API", async () => {
    const { config } = importAppYaml(await starterYaml("packages/create-bakorin/templates/schemas/blank.yaml"));
    const built: BuilderConfig = structuredClone(config);
    built.app.name = "built-app";
    built.runtime = {
      sqlite: { path: "./data/app.db" },
      files: { path: "./data/uploads" },
      jwt: { secret: "test-secret-test-secret-test-secret-32" },
      hooks: "./hooks.ts",
    };

    const projects = emptyEntity("projects");
    projects.label = "Project";
    projects.display = "title";
    projects.fields = [
      { ...emptyField("title", "text"), required: true },
      { ...emptyField("contact", "email") },
      { ...emptyField("budget", "number"), defaultValue: "1500.5" },
      { ...emptyField("seats", "integer"), defaultValue: "3" },
      { ...emptyField("active", "boolean"), defaultValue: "true" },
      { ...emptyField("startsOn", "date") },
      { ...emptyField("kickoffAt", "datetime") },
      { ...emptyField("stage", "enum"), values: ["draft", "live", "done"], defaultValue: "draft" },
      { ...emptyField("brief", "file") },
      { ...emptyField("internalCode", "text"), secret: true, writable: "admin" },
      { ...emptyField("ownerId", "relation"), to: "users", required: true, description: "Who runs it." },
    ];
    projects.indexes = [["ownerId", "stage"]];
    projects.policies = { read: ["owner(ownerId)", "admin"], create: ["authenticated"], update: ["owner(ownerId)"], delete: ["admin"] };

    const notes = emptyEntity("notes");
    notes.fields = [
      { ...emptyField("body", "text"), required: true },
      { ...emptyField("projectId", "relation"), to: "projects", onDelete: "cascade", required: true },
      { ...emptyField("pin", "password") },
    ];
    notes.policies = { read: ["public"], create: ["authenticated"], update: ["role(admin)"], delete: ["admin"] };
    built.entities.push(projects, notes);

    built.mail.push({
      ...emptyMailRule("projects"),
      name: "project-live",
      events: ["update"],
      changed: ["stage"],
      when: [{ field: "stage", op: "equals", value: "live" }],
      to: "{{ expand.ownerId.email }}, team@example.com",
      subject: "Live: {{ record.title }}",
      template: "project-live",
      expand: ["ownerId"],
    });
    built.mail.push({
      ...emptyMailRule("projects"),
      name: "project-created",
      events: ["create"],
      when: [{ field: "seats", op: "in", value: "1, 2, 3" }],
      to: "team@example.com",
      subject: "New project {{ record.title }}",
      template: "project-created",
    });

    const result = validateConfig(built);
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.mailFiles).toEqual(["mail/project-live.html", "mail/project-created.html"]);
    expect(result.yaml).toContain("budget: { type: number, required: false, default: 1500.5 }");
    expect(result.yaml).toContain("default: true");

    const dir = await tempProject(result.yaml);
    await mkdir(join(dir, "mail"), { recursive: true });
    await writeFile(join(dir, "mail", "project-live.html"), "<p>{{ record.title }} is live.</p>\n");
    await writeFile(join(dir, "mail", "project-created.html"), "<p>New: {{ record.title }}</p>\n");
    const runtime = await createRuntime({ projectDir: dir, yamlSource: result.yaml });
    try {
      const http = client(Object.assign(runtime, { dir }));
      const first = await http.fetch("/api/v1/auth/first-admin", {
        method: "POST",
        body: JSON.stringify({ email: "ada@example.com", password: "password123", name: "Ada" }),
      });
      expect(first.status).toBe(201);
      const session = (await first.json()) as { data: { accessToken: string; user: { id: string } } };
      const api = client(Object.assign(runtime, { dir }), session.data.accessToken);

      const created = await api.fetch("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ title: "Site rebuild", ownerId: session.data.user.id, startsOn: "2026-12-01" }),
      });
      expect(created.status).toBe(201);
      const project = ((await created.json()) as { data: Record<string, unknown> }).data;
      expect(project.stage).toBe("draft");
      expect(project.active).toBe(true);
      expect(project.seats).toBe(3);

      const note = await api.fetch("/api/v1/notes", {
        method: "POST",
        body: JSON.stringify({ body: "Kickoff notes", projectId: project.id }),
      });
      expect(note.status).toBe(201);
      const publicRead = await client(Object.assign(runtime, { dir })).fetch("/api/v1/notes");
      expect(publicRead.status).toBe(200);

      const live = await api.fetch(`/api/v1/projects/${String(project.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: "live" }),
      });
      expect(live.status).toBe(200);
      const mail = await api.fetch("/api/v1/mail");
      expect(mail.status).toBe(200);
      const overview = (await mail.json()) as { data: { rules: Array<{ id: string }> } };
      expect(overview.data.rules.map((rule) => rule.id).sort()).toEqual(["project-created", "project-live"]);
    } finally {
      await runtime.close();
    }
  });

  test("builder page copy has no em or en dashes", async () => {
    for (const file of ["website/src/pages/builder.astro", "website/src/builder/app.ts", "website/src/builder/starters.ts", "packages/core/src/builder.ts"]) {
      const text = await Bun.file(join(ROOT, file)).text();
      expect({ file, dashes: /[\u2013\u2014]/.test(text) }).toEqual({ file, dashes: false });
    }
  });
});
