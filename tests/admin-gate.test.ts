import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkAdminAccess, classifyAdminAccess, screenForAccess } from "../packages/admin-ui/src/lib/access.ts";
import { AccessError, AdminsOnly } from "../packages/admin-ui/src/pages/AdminsOnly.tsx";
import { boot, client, signupAndLogin } from "./helpers.ts";

type Runtime = Awaited<ReturnType<typeof boot>>;

let runtime: Runtime;
let adminToken = "";
let memberToken = "";


beforeAll(async () => {
  runtime = await boot();
  const http = client(runtime);
  const first = await http.fetch("/api/v1/auth/first-admin", {
    method: "POST",
    body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
  });
  expect(first.status).toBe(201);
  adminToken = ((await first.json()) as { data: { accessToken: string } }).data.accessToken;
  const signup = await signupAndLogin(http, {
    method: "POST",
    body: JSON.stringify({ email: "member@studio.test", password: "password123", name: "Member" }),
  });
  expect(signup.status).toBe(200);
  const body = (await signup.json()) as { data: { accessToken: string; user: { id: string } } };
  memberToken = body.data.accessToken;

});

afterAll(async () => {
  await runtime.close();
});

const ADMIN_ONLY: Array<{ method: "GET" | "POST"; path: string; body?: unknown }> = [
  { method: "GET", path: "/api/v1/_meta" },
  { method: "GET", path: "/api/v1/backups" },
  { method: "POST", path: "/api/v1/backups" },
  { method: "GET", path: "/api/v1/audit" },
  { method: "GET", path: "/api/v1/webhooks" },
  { method: "GET", path: "/api/v1/webhooks/deliveries" },
  { method: "GET", path: "/api/v1/jobs" },
  { method: "GET", path: "/api/v1/jobs/runs" },
  { method: "POST", path: "/api/v1/jobs/does-not-exist/run" },
  { method: "POST", path: "/api/v1/webhooks/deliveries/does-not-exist/retry" },
  { method: "POST", path: "/api/v1/webhooks/does-not-exist/test" },
  { method: "POST", path: "/api/v1/auth/invites", body: { email: "new@studio.test" } },
];

function call(token: string | undefined, route: (typeof ADMIN_ONLY)[number]) {
  return client(runtime, token).fetch(route.path, {
    method: route.method,
    body: route.body === undefined ? undefined : JSON.stringify(route.body),
  });
}

describe("server rejects non-admins on admin-only endpoints", () => {
  for (const route of ADMIN_ONLY) {
    test(`${route.method} ${route.path}: 401 signed out, 403 non-admin`, async () => {
      expect((await call(undefined, route)).status).toBe(401);
      const asMember = await call(memberToken, route);
      expect(asMember.status).toBe(403);
      const json = (await asMember.json()) as { error: { code: string } };
      expect(json.error.code).toBe("forbidden");
    });
  }

  test("admins can read the admin endpoints", async () => {
    for (const path of ["/api/v1/_meta", "/api/v1/backups", "/api/v1/audit", "/api/v1/webhooks", "/api/v1/webhooks/deliveries"]) {
      expect((await client(runtime, adminToken).fetch(path)).status).toBe(200);
    }
  });

  test("non-admins cannot resend verification for another user", async () => {
    const response = await client(runtime, memberToken).fetch("/api/v1/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ userId: "someone-else" }),
    });
    expect(response.status).toBe(403);
  });
});

describe("admin UI gate", () => {
  test("classifies server answers", () => {
    expect(classifyAdminAccess(200)).toBe("admin");
    expect(classifyAdminAccess(401)).toBe("signed-out");
    expect(classifyAdminAccess(403)).toBe("not-admin");
    expect(classifyAdminAccess(500)).toBe("error");
    expect(classifyAdminAccess(404)).toBe("error");
  });

  test("maps access to screens and never shows the app to non-admins", () => {
    expect(screenForAccess("admin")).toBe("app");
    expect(screenForAccess("not-admin")).toBe("admins-only");
    expect(screenForAccess("signed-out")).toBe("login");
    expect(screenForAccess("error")).toBe("access-error");
  });

  const fetcherFor = (token?: string) => async (path: string) => client(runtime, token).fetch(path);

  test("admin session passes the gate", async () => {
    expect(await checkAdminAccess(fetcherFor(adminToken))).toEqual({ access: "admin", identity: null });
  });

  test("non-admin session is held at Admins only with its email", async () => {
    expect(await checkAdminAccess(fetcherFor(memberToken))).toEqual({ access: "not-admin", identity: "member@studio.test" });
  });

  test("missing or bad tokens go back to sign in", async () => {
    expect((await checkAdminAccess(fetcherFor())).access).toBe("signed-out");
    expect((await checkAdminAccess(fetcherFor("not-a-real-token"))).access).toBe("signed-out");
  });

  test("network or server failures show the access error screen", async () => {
    expect((await checkAdminAccess(async () => Promise.reject(new Error("offline")))).access).toBe("error");
    expect((await checkAdminAccess(async () => new Response("{}", { status: 500 }))).access).toBe("error");
  });
});

type VNodeLike = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

function walk(node: unknown, visit: (node: VNodeLike) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node && typeof node === "object" && "props" in node) {
    visit(node as VNodeLike);
    walk((node as VNodeLike).props.children, visit);
  }
}

function textOf(node: unknown): string {
  const parts: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string" || typeof value === "number") parts.push(String(value));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object" && "props" in value) collect((value as VNodeLike).props.children);
  };
  collect(node);
  return parts.join(" ");
}

function buttons(node: unknown): VNodeLike[] {
  const found: VNodeLike[] = [];
  walk(node, (vnode) => {
    if (vnode.type === "button") found.push(vnode);
  });
  return found;
}

describe("Admins only screen", () => {
  test("explains the block and offers sign out", () => {
    let signedOut = 0;
    const tree = AdminsOnly({ identity: "member@studio.test", onSignOut: () => (signedOut += 1) });
    const text = textOf(tree);
    expect(text).toContain("Admins only");
    expect(text).toContain("member@studio.test");
    expect(text).toContain("not an admin");
    const [signOut] = buttons(tree);
    expect(textOf(signOut)).toContain("Sign out");
    (signOut!.props.onClick as () => void)();
    expect(signedOut).toBe(1);
  });

  test("renders no admin navigation or data", () => {
    const text = textOf(AdminsOnly({ identity: null, onSignOut: () => {} }));
    for (const word of ["Backups", "Webhooks", "Audit", "Schema", "Users"]) {
      expect(text).not.toContain(word);
    }
  });

  test("access error offers retry and sign out", () => {
    let retried = 0;
    let signedOut = 0;
    const tree = AccessError({ onRetry: () => (retried += 1), onSignOut: () => (signedOut += 1) });
    const [retry, signOut] = buttons(tree);
    (retry!.props.onClick as () => void)();
    (signOut!.props.onClick as () => void)();
    expect(retried).toBe(1);
    expect(signedOut).toBe(1);
  });
});
