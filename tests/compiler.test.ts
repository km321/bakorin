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
});
