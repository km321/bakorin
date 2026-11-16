import { describe, expect, test } from "bun:test";
import { createClient } from "@bakorin/sdk";
import { boot, client, signupAndLogin } from "./helpers.ts";
import { FILES_YAML } from "./files-fixtures.ts";


type Runtime = Awaited<ReturnType<typeof boot>>;
type Api = ReturnType<typeof client>;

async function signIn(runtime: Runtime, email: string, admin = false): Promise<{ api: Api; id: string; token: string }> {
  const signup = await signupAndLogin(client(runtime), {
    method: "POST",
    body: JSON.stringify({ email, password: "password123", name: email.split("@")[0] }),
  });
  expect(signup.status).toBe(200);
  const id = ((await signup.json()).data.user as { id: string }).id;
  if (admin) {
    await runtime.db.updateTable("users").set({ role: "admin" }).where("id", "=", id).execute();
  }
  const login = await client(runtime).fetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123" }),
  });
  const token = (await login.json()).data.accessToken as string;
  return { api: client(runtime, token), id, token };
}

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);

async function upload(api: Api, bytes: Uint8Array<ArrayBuffer>, type: string, name: string) {
  const body = new FormData();
  body.set("file", new File([bytes], name, { type }));
  const response = await api.fetch("/api/v1/files", { method: "POST", body });
  expect(response.status).toBe(201);
  return (await response.json()).data as { id: string; url: string; downloadUrl: string; filename: string };
}

describe("file fields on records (admin edit regression)", () => {
  test("saving the record the admin loaded, with id and timestamps, keeps the uploaded file", async () => {
    const runtime = await boot(FILES_YAML);
    const { api } = await signIn(runtime, "admin@example.com", true);
    const created = await api.fetch("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Store rebuild" }) });
    expect(created.status).toBe(201);
    const record = (await created.json()).data as Record<string, unknown>;
    const file = await upload(api, PDF, "application/pdf", "brief.pdf");

    // The admin edit form used to send the whole row back. id and createdAt are
    // read-only, so the server answered 403 "id is read-only" and the file was lost.
    const listed = (await (await api.fetch("/api/v1/projects?expand=ownerId,brief")).json()).data[0] as Record<string, unknown>;
    const saved = await api.fetch(`/api/v1/projects/${record.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...listed, brief: file.id }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).data.brief).toBe(file.id);

    // Loaded back for the edit form and the detail view.
    const detail = (await (await api.fetch(`/api/v1/projects/${record.id}?expand=brief`)).json()).data;
    expect(detail.brief).toBe(file.id);
    expect(detail.$expand.brief).toMatchObject({ id: file.id, filename: "brief.pdf", contentType: "application/pdf", size: PDF.byteLength });
    expect(detail.$expand.brief.url).toContain(`/api/v1/files/${file.id}?exp=`);
    expect(detail.$expand.brief.downloadUrl).toEndWith("&download=1");
    expect(detail.$expand.brief.createdBy).toBeUndefined();
    const bytes = await client(runtime).fetch(detail.$expand.brief.url);
    expect(bytes.status).toBe(200);
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(PDF);

    // The list view expands it too.
    const list = (await (await api.fetch("/api/v1/projects?expand=brief")).json()).data;
    expect(list[0].$expand.brief.filename).toBe("brief.pdf");

    // Changing a read-only field is still refused.
    const moved = await api.fetch(`/api/v1/projects/${record.id}`, { method: "PATCH", body: JSON.stringify({ id: "other" }) });
    expect(moved.status).toBe(403);
    const stamped = await api.fetch(`/api/v1/projects/${record.id}`, {
      method: "PATCH",
      body: JSON.stringify({ createdAt: "2001-01-01T00:00:00.000Z" }),
    });
    expect(stamped.status).toBe(403);

    // Replace, then remove.
    const image = await upload(api, PNG, "image/png", "cover.png");
    const replaced = await api.fetch(`/api/v1/projects/${record.id}`, { method: "PATCH", body: JSON.stringify({ brief: image.id }) });
    expect((await replaced.json()).data.brief).toBe(image.id);
    const removed = await api.fetch(`/api/v1/projects/${record.id}`, { method: "PATCH", body: JSON.stringify({ brief: null }) });
    expect((await removed.json()).data.brief).toBeNull();
    await runtime.close();
  });

  test("file fields only take uploaded files, and a user only their own uploads", async () => {
    const runtime = await boot(FILES_YAML);
    const admin = await signIn(runtime, "admin@example.com", true);
    const ana = await signIn(runtime, "ana@example.com");
    const ben = await signIn(runtime, "ben@example.com");
    const anaFile = await upload(ana.api, PDF, "application/pdf", "ana.pdf");

    const missing = await ben.api.fetch("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "X", brief: "not-a-file" }) });
    expect(missing.status).toBe(400);
    const stolen = await ben.api.fetch("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "X", brief: anaFile.id }) });
    expect(stolen.status).toBe(400);
    expect((await stolen.json()).error.message).toContain("you uploaded");

    const own = await ana.api.fetch("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Ana's", brief: anaFile.id }) });
    expect(own.status).toBe(201);
    const project = (await own.json()).data as { id: string };
    // Ben may edit the project (update: authenticated) without touching the file Ana attached.
    const edit = await ben.api.fetch(`/api/v1/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed", brief: anaFile.id }),
    });
    expect(edit.status).toBe(200);
    // Readers of the record get a link through expand, even though they did not upload it.
    const read = (await (await ben.api.fetch(`/api/v1/projects/${project.id}?expand=brief`)).json()).data;
    expect(read.$expand.brief.filename).toBe("ana.pdf");
    // An admin can attach any file.
    const byAdmin = await admin.api.fetch("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "A", brief: anaFile.id }) });
    expect(byAdmin.status).toBe(201);
    await runtime.close();
  });

  test("records with a many to many list of users save without the list (was a 500)", async () => {
    const runtime = await boot(FILES_YAML);
    const admin = await signIn(runtime, "admin@example.com", true);
    const user = await signIn(runtime, "user@example.com");
    const byAdmin = await admin.api.fetch("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "No members" }) });
    expect(byAdmin.status).toBe(201);
    const adminRow = (await byAdmin.json()).data;
    expect(adminRow.memberIds).toEqual([]);
    expect(adminRow.ownerId).toBe(admin.id);
    const byUser = await user.api.fetch("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Mine" }) });
    expect(byUser.status).toBe(201);
    const userRow = (await byUser.json()).data;
    expect(userRow.memberIds).toEqual([user.id]);
    expect(userRow.ownerId).toBe(user.id);
    // Sending back an unchanged owner is fine; changing it is not.
    const same = await user.api.fetch(`/api/v1/projects/${userRow.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...userRow, name: "Mine, renamed" }),
    });
    expect(same.status).toBe(200);
    const takeover = await user.api.fetch(`/api/v1/projects/${userRow.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ownerId: admin.id }),
    });
    expect(takeover.status).toBe(403);
    await runtime.close();
  });
});

describe("file downloads", () => {
  test("inline previews may be framed by the admin, downloads stay sandboxed", async () => {
    const runtime = await boot(FILES_YAML);
    const { api } = await signIn(runtime, "admin@example.com", true);
    const pdf = await upload(api, PDF, "application/pdf", "brief.pdf");
    const inline = await client(runtime).fetch(pdf.url);
    expect(inline.headers.get("content-disposition")).toStartWith("inline;");
    expect(inline.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(inline.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(inline.headers.get("x-content-type-options")).toBe("nosniff");
    const download = await client(runtime).fetch(pdf.downloadUrl);
    expect(download.headers.get("content-disposition")).toStartWith("attachment;");

    const html = await upload(api, new TextEncoder().encode("<script>alert(1)</script>"), "text/html", "page.html");
    const served = await client(runtime).fetch(html.url);
    expect(served.headers.get("content-disposition")).toStartWith("attachment;");
    // The global policy used to replace the sandbox on file responses.
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
    expect(served.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");

    // The download flag is not part of the signature, and a bad signature still fails.
    const forged = await client(runtime).fetch(pdf.url.replace(/sig=[^&]+/, "sig=nope"));
    expect(forged.status).toBe(401);
    await runtime.close();
  });

  test("sign returns the file's details with fresh links", async () => {
    const runtime = await boot(FILES_YAML);
    const { api } = await signIn(runtime, "admin@example.com", true);
    const file = await upload(api, PNG, "image/png", "cover.png");
    const signed = (await (await api.fetch(`/api/v1/files/${file.id}/sign`, { method: "POST" })).json()).data;
    expect(signed).toMatchObject({ id: file.id, filename: "cover.png", contentType: "image/png", size: PNG.byteLength });
    expect(signed.downloadUrl).toEndWith("&download=1");
    await runtime.close();
  });
});

describe("Files page API (admin)", () => {
  async function seed() {
    const runtime = await boot(FILES_YAML);
    const admin = await signIn(runtime, "admin@example.com", true);
    const user = await signIn(runtime, "user@example.com");
    const brief = await upload(admin.api, PDF, "application/pdf", "store-brief.pdf");
    const cover = await upload(admin.api, PNG, "image/png", "cover.png");
    const draft = await upload(admin.api, PNG, "image/png", "old-draft.png");
    const notes = await upload(admin.api, new TextEncoder().encode("call notes"), "text/plain", "notes.txt");
    const legacy = await upload(admin.api, PDF, "application/pdf", "legacy.pdf");
    const store = (await (await admin.api.fetch("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Store rebuild", brief: brief.id }) })).json()).data;
    const menu = (await (await admin.api.fetch("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Menu", brief: cover.id, legacy: legacy.id }) })).json()).data;
    // Uploads from three days ago, past the one hour grace period.
    const old = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
    await runtime.db.updateTable("_bakorin_files").set({ created_at: old }).where("id", "in", [draft.id, notes.id, legacy.id]).execute();
    return { runtime, admin, user, brief, cover, draft, notes, legacy, store, menu };
  }

  test("lists uploads with the records that use them, admin only", async () => {
    const { runtime, admin, user, brief, cover, draft, store } = await seed();
    expect((await client(runtime).fetch("/api/v1/files")).status).toBe(401);
    expect((await user.api.fetch("/api/v1/files")).status).toBe(403);

    const all = await (await admin.api.fetch("/api/v1/files")).json();
    expect(all.meta).toMatchObject({ total: 5, files: 5, orphaned: 3, removable: 3 });
    const byId = new Map((all.data as Array<{ id: string }>).map((item) => [item.id, item as Record<string, unknown>]));
    expect(byId.get(brief.id)!.usedBy).toEqual([{ entity: "projects", field: "brief", id: store.id, label: "Store rebuild", removed: false }]);
    expect(byId.get(brief.id)!.orphaned).toBe(false);
    expect(byId.get(cover.id)!.orphaned).toBe(false);
    expect(byId.get(draft.id)!.orphaned).toBe(true);
    expect(byId.get(draft.id)!.recent).toBe(false);
    expect(String(byId.get(draft.id)!.url)).toContain("sig=");

    const search = async (query: string) =>
      ((await (await admin.api.fetch(`/api/v1/files?${query}`)).json()).data as Array<{ filename: string }>).map((item) => item.filename).sort();
    expect(await search("q=BRIEF")).toEqual(["store-brief.pdf"]);
    expect(await search("q=%25")).toEqual([]);
    expect(await search("type=image")).toEqual(["cover.png", "old-draft.png"]);
    expect(await search("type=pdf")).toEqual(["legacy.pdf", "store-brief.pdf"]);
    expect(await search("type=text")).toEqual(["notes.txt"]);
    expect(await search("status=orphaned")).toEqual(["legacy.pdf", "notes.txt", "old-draft.png"]);
    expect(await search("status=used")).toEqual(["cover.png", "store-brief.pdf"]);
    expect(await search(`minSize=${PNG.byteLength}`)).toEqual(["cover.png", "old-draft.png"]);
    expect(await search(`minSize=${PDF.byteLength}&maxSize=${PDF.byteLength}`)).toEqual(["legacy.pdf", "store-brief.pdf"]);
    expect(await search("maxSize=20")).toEqual(["notes.txt"]);
    const today = new Date().toISOString().slice(0, 10);
    expect(await search(`from=${today}`)).toEqual(["cover.png", "store-brief.pdf"]);
    expect(await search(`ids=${draft.id},${cover.id}`)).toEqual(["cover.png", "old-draft.png"]);
    const sorted = ((await (await admin.api.fetch("/api/v1/files?sort=filename&limit=2")).json()).data as Array<{ filename: string }>).map((item) => item.filename);
    expect(sorted).toEqual(["cover.png", "legacy.pdf"]);
    await runtime.close();
  });

  test("files kept by a removed field still count as used", async () => {
    const { runtime, admin, legacy, menu } = await seed();
    // legacy is a text column today. Mark it as a removed field, as a soft drop would.
    await runtime.db.insertInto("_bakorin_deprecated").values({ kind: "field", entity: "projects", field: "legacy", dropped_at: new Date().toISOString() }).execute();
    const listed = (await (await admin.api.fetch(`/api/v1/files?ids=${legacy.id}`)).json()).data[0];
    expect(listed.orphaned).toBe(false);
    expect(listed.usedBy).toEqual([{ entity: "projects", field: "legacy", id: menu.id, label: "Menu", removed: true }]);
    const refused = await admin.api.fetch(`/api/v1/files/${legacy.id}`, { method: "DELETE" });
    expect(refused.status).toBe(409);
    await runtime.close();
  });

  test("deletes unused files with an audit entry, never files in use", async () => {
    const { runtime, admin, user, brief, draft, notes, legacy } = await seed();
    const inUse = await admin.api.fetch(`/api/v1/files/${brief.id}`, { method: "DELETE" });
    expect(inUse.status).toBe(409);
    expect((await inUse.json()).error.usedBy[0].label).toBe("Store rebuild");
    expect((await user.api.fetch(`/api/v1/files/${draft.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await admin.api.fetch("/api/v1/files/nope", { method: "DELETE" })).status).toBe(404);

    const deleted = await admin.api.fetch(`/api/v1/files/${draft.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect((await client(runtime).fetch(draft.url)).status).toBe(404);
    const audit = await runtime.db.selectFrom("_bakorin_audit").selectAll().where("action", "=", "file_delete").execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ record_id: draft.id, entity: "files", actor_role: "admin" });
    expect(JSON.parse(String(audit[0]!.meta))).toMatchObject({ filename: "old-draft.png", contentType: "image/png" });

    // A fresh upload nobody uses yet is kept by the bulk cleanup (its form may still be open).
    const fresh = await upload(admin.api, PNG, "image/png", "just-now.png");
    expect((await user.api.fetch("/api/v1/files/orphans/delete", { method: "POST" })).status).toBe(403);
    const bulk = await (await admin.api.fetch("/api/v1/files/orphans/delete", { method: "POST" })).json();
    expect(bulk.data).toMatchObject({ deleted: 2, orphaned: 1, removable: 0 });
    const left = ((await (await admin.api.fetch("/api/v1/files")).json()).data as Array<{ id: string; recent: boolean }>).map((item) => item.id).sort();
    expect(left).toEqual([brief.id, fresh.id, ...(await keepUsed(admin.api))].filter((id, i, all) => all.indexOf(id) === i).sort());
    expect(left).not.toContain(notes.id);
    expect(left).not.toContain(legacy.id);
    expect(await runtime.db.selectFrom("_bakorin_audit").select("id").where("action", "=", "file_delete").execute()).toHaveLength(3);
    await runtime.close();
  });
});

async function keepUsed(api: Api): Promise<string[]> {
  const rows = (await (await api.fetch("/api/v1/projects")).json()).data as Array<{ brief: string | null }>;
  return rows.map((row) => row.brief).filter((id): id is string => Boolean(id));
}

describe("SDK file helpers", () => {
  test("upload, attach, read back with expand, and sign through the client", async () => {
    const runtime = await boot(FILES_YAML);
    const { token } = await signIn(runtime, "admin@example.com", true);
    const seen: Array<{ url: string; contentType: string | null }> = [];
    const api = createClient({
      baseUrl: "https://api.example",
      getAccessToken: () => token,
      fetch: (input, init) => {
        const request = new Request(input, init);
        seen.push({ url: request.url, contentType: request.headers.get("content-type") });
        const url = new URL(request.url);
        return runtime.app.request(url.pathname + url.search, request);
      },
    });
    const file = await api.files.upload(new File([PDF], "brief.pdf", { type: "application/pdf" }));
    expect(seen[0]!.contentType).toStartWith("multipart/form-data");
    expect(file.url).toStartWith("https://api.example/api/v1/files/");
    expect(file.downloadUrl).toEndWith("&download=1");
    const project = await api.entity("projects").create({ name: "Brief", brief: file.id });
    const read = (await api.entity("projects").get(String(project.id), "brief")) as { $expand: { brief: { url: string; filename: string } } };
    expect(read.$expand.brief.filename).toBe("brief.pdf");
    expect(read.$expand.brief.url).toStartWith("https://api.example/api/v1/files/");
    const listed = (await api.entity("projects").list({ expand: "brief" })).data[0] as { $expand: { brief: { downloadUrl: string } } };
    expect(listed.$expand.brief.downloadUrl).toStartWith("https://api.example/api/v1/files/");
    const signed = await api.files.sign(file.id);
    expect(signed.filename).toBe("brief.pdf");
    expect(signed.url).toStartWith("https://api.example/");
    await runtime.close();
  });
});
