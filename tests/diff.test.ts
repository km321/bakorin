import { describe, expect, test } from "bun:test";
import { compileAppYaml, diffSchemas, DiffAbortError, assertPlanApplyable } from "@bakorin/core";
import { MINI_YAML } from "./helpers.ts";

function ast(extra = "") {
  return compileAppYaml(`${MINI_YAML}${extra}`, { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } });
}

describe("diffSchemas", () => {
  test("empty from produces auto add_entity in topo order", () => {
    const plan = diffSchemas(null, ast());
    expect(plan.auto.map((change) => change.kind)).toEqual(["add_entity", "add_entity"]);
    expect(plan.abort).toEqual([]);
  });

  test("adding a nullable field is auto", () => {
    const from = ast();
    const to = compileAppYaml(
      MINI_YAML.replace(
        "done: { type: boolean, default: false }",
        "done: { type: boolean, default: false }\n      notes: { type: text }",
      ),
      { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } },
    );
    const plan = diffSchemas(from, to);
    expect(plan.auto.some((change) => change.kind === "add_field")).toBe(true);
    expect(plan.abort).toEqual([]);
  });

  test("explicit renameFrom is a safe rename", () => {
    const from = ast();
    const to = compileAppYaml(
      MINI_YAML.replace("title: { type: text, required: true }", "headline: { type: text, required: true, renameFrom: title }"),
      { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } },
    );
    const plan = diffSchemas(from, to);
    expect(plan.safe).toEqual([
      { tier: "safe", kind: "rename_field", entity: "items", from: "title", to: "headline" },
    ]);
  });

  test("dropping a field is soft-deprecate, not a drop", () => {
    const from = ast();
    const to = compileAppYaml(MINI_YAML.replace("      done: { type: boolean, default: false }\n", ""), {
      env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" },
    });
    const plan = diffSchemas(from, to);
    expect(plan.deprecate).toEqual([{ tier: "deprecate", kind: "drop_field", entity: "items", field: "done" }]);
  });

  test("type change aborts", () => {
    const from = ast();
    const to = compileAppYaml(MINI_YAML.replace("title: { type: text, required: true }", "title: { type: integer, required: true }"), {
      env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" },
    });
    const plan = diffSchemas(from, to);
    expect(plan.abort.length).toBeGreaterThan(0);
    expect(() => assertPlanApplyable(plan)).toThrow(DiffAbortError);
  });

  test("required field without default aborts", () => {
    const from = ast();
    const to = compileAppYaml(
      MINI_YAML.replace(
        "done: { type: boolean, default: false }",
        "done: { type: boolean, default: false }\n      priority: { type: integer, required: true }",
      ),
      { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } },
    );
    const plan = diffSchemas(from, to);
    expect(plan.abort.some((change) => change.kind === "breaking")).toBe(true);
  });
});
