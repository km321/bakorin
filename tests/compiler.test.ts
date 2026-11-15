import { describe, expect, test } from "bun:test";
import { compileAppYaml, generateTypes, SchemaError } from "@bakorin/core";
import { MINI_YAML } from "./helpers.ts";

describe("compiler", () => {
  test("normalizes yaml into a versioned AST with topo order", () => {
    const ast = compileAppYaml(MINI_YAML, { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } });
    expect(ast.version).toBe(1);
    expect(ast.order).toEqual(["users", "items"]);
    expect(ast.auth.entity).toBe("users");
    expect(ast.entityMap.items?.fieldMap.ownerId?.relation?.to).toBe("users");
    expect(ast.entityMap.users?.fieldMap.id).toBeTruthy();
    expect(ast.entityMap.users?.fieldMap.password?.secret).toBe(true);
    expect(ast.entityMap.users?.display).toBe("name");
    expect(ast.entityMap.items?.display).toBe("title");
  });

  test("honors entity display and rejects a missing field", () => {
    const ast = compileAppYaml(
      MINI_YAML.replace("  items:\n    fields:", "  items:\n    display: title\n    fields:"),
      { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } },
    );
    expect(ast.entityMap.items?.display).toBe("title");
    expect(() =>
      compileAppYaml(MINI_YAML.replace("  items:\n    fields:", "  items:\n    display: missing\n    fields:"), {
        env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" },
      }),
    ).toThrow(/display field missing/);
  });

  test("interpolates env with defaults", () => {
    const ast = compileAppYaml(
      `app:\n  name: x\nruntime:\n  jwt:\n    secret: \${JWT_SECRET:-fallback-secret-fallback-secret-ok}\nentities:\n  users:\n    auth: true\n    fields:\n      email: { type: email, unique: true, required: true }\n      password: { type: password, required: true }\n      role: { type: enum, values: [user, admin], default: user }\n`,
      { env: {} },
    );
    expect(ast.runtime.jwtSecret).toBe("fallback-secret-fallback-secret-ok");
  });

  test("rejects missing env without default", () => {
    expect(() =>
      compileAppYaml(
        `app:\n  name: x\nruntime:\n  jwt:\n    secret: \${MISSING_SECRET}\nentities:\n  users:\n    auth: true\n    fields:\n      email: { type: email, unique: true, required: true }\n      password: { type: password, required: true }\n      role: { type: enum, values: [user, admin], default: user }\n`,
        { env: {} },
      ),
    ).toThrow(SchemaError);
  });

  test("rejects circular relations", () => {
    expect(() =>
      compileAppYaml(
        `app:\n  name: x\nentities:\n  users:\n    auth: true\n    fields:\n      email: { type: email, unique: true, required: true }\n      password: { type: password, required: true }\n      role: { type: enum, values: [user, admin], default: user }\n      itemId: { type: relation, to: items }\n  items:\n    fields:\n      userId: { type: relation, to: users }\n      title: text\n`,
        { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } },
      ),
    ).toThrow(/circular/);
  });

  test("typegen emits interfaces", () => {
    const ast = compileAppYaml(MINI_YAML, { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } });
    const types = generateTypes(ast);
    expect(types).toContain("export interface Users");
    expect(types).toContain("export interface BakorinEntities");
    expect(types.split("export interface UsersWrite")[0]).not.toContain("password:");
  });

  test("requires JWT_SECRET in production", () => {
    const yaml = MINI_YAML.replace(
      `  jwt:\n    secret: test-secret-test-secret-test-secret-32\n`,
      "",
    );
    expect(() => compileAppYaml(yaml, { env: {}, production: true })).toThrow(/JWT_SECRET/);
  });

  test("locks the auth role field and defaults auth create to admin", () => {
    const ast = compileAppYaml(
      `app:\n  name: x\nentities:\n  users:\n    auth: true\n    fields:\n      email: { type: email, unique: true, required: true }\n      password: { type: password, required: true }\n      role: { type: enum, values: [user, admin], default: user }\n      notes: { type: text, writable: admin }\n      locked: { type: text, readonly: true, default: sealed }\n`,
      { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } },
    );
    expect(ast.entityMap.users?.policies.create).toEqual([{ kind: "admin" }]);
    expect(ast.entityMap.users?.fieldMap.role?.writable).toBe("admin");
    expect(ast.entityMap.users?.fieldMap.notes?.writable).toBe("admin");
    expect(ast.entityMap.users?.fieldMap.locked?.writable).toBe("none");
    expect(ast.entityMap.users?.fieldMap.emailVerified?.type).toBe("boolean");
    expect(ast.entityMap.users?.fieldMap.emailVerified?.writable).toBe("admin");
    expect(ast.auth.requireVerifiedEmail).toBe(false);
  });

  test("CORS_ORIGINS overrides yaml and APP_URL is compiled", () => {
    const ast = compileAppYaml(MINI_YAML, {
      env: {
        JWT_SECRET: "test-secret-test-secret-test-secret-32",
        CORS_ORIGINS: "https://app.test, https://admin.test",
        APP_URL: "https://app.test/",
      },
    });
    expect(ast.runtime.corsOrigins).toEqual(["https://app.test", "https://admin.test"]);
    expect(ast.runtime.appUrl).toBe("https://app.test");
  });
});
