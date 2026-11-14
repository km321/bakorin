import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, type RuntimeHandles } from "@bakorin/server";

export const MINI_YAML = `
app:
  name: mini
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  files:
    path: ./data/uploads
  jwt:
    secret: test-secret-test-secret-test-secret-32
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
    policies:
      read: authenticated
      create: public
      update: owner(id)
      delete: admin
  items:
    fields:
      title: { type: text, required: true }
      done: { type: boolean, default: false }
      ownerId: { type: relation, to: users, required: true }
    policies:
      read: owner(ownerId)
      create: authenticated
      update: owner(ownerId)
      delete: owner(ownerId)
`;

export async function tempProject(yaml = MINI_YAML, hooks = "export default { entities: {} };\n"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bakorin-"));
  await writeFile(join(dir, "app.yaml"), yaml);
  await writeFile(join(dir, "hooks.ts"), hooks);
  await mkdir(join(dir, "data"), { recursive: true });
  return dir;
}

export async function boot(yaml?: string, hooks?: string): Promise<RuntimeHandles & { dir: string }> {
  const dir = await tempProject(yaml, hooks);
  const runtime = await createRuntime({
    projectDir: dir,
    yamlSource: await Bun.file(join(dir, "app.yaml")).text(),
  });
  return Object.assign(runtime, { dir });
}

export function client(runtime: RuntimeHandles & { dir?: string }, token?: string) {
  return {
    fetch(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
      if (!headers.has("x-forwarded-for")) {
        headers.set("x-forwarded-for", runtime.dir ?? "test");
      }
      if (init.body && !headers.has("content-type") && typeof init.body === "string") {
        headers.set("content-type", "application/json");
      }
      return runtime.app.request(path, { ...init, headers });
    },
  };
}
