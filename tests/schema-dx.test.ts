import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  compileAppYaml,
  FIELD_TYPES,
  formatAppYamlError,
  SchemaError,
} from "@bakorin/core";
import { createDebounced } from "@bakorin/server";
import { MINI_YAML, tempProject } from "./helpers.ts";

const SECRET = { env: { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" } };

function compileMessage(source: string): string {
  try {
    compileAppYaml(source, SECRET);
    throw new Error("expected compileAppYaml to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(SchemaError);
    expect(error).not.toHaveProperty("issues");
    return formatAppYamlError(error);
  }
}

function looksLikeStack(text: string): boolean {
  return /ZodError/.test(text) || /\n\s+at \S+ \(/m.test(text) || text.includes("node_modules/zod");
}

describe("friendly app.yaml errors", () => {
  test("unknown top-level key that looks like an entity hints to nest it under entities", () => {
    const message = compileMessage(`${MINI_YAML}\ncars:\n  fields:\n    name: text\n`);
    expect(message).toContain('app.yaml: unknown top-level key "cars". Did you mean to put it under "entities:"?');
    expect(looksLikeStack(message)).toBe(false);
  });

  test("unknown field type lists valid types", () => {
    const message = compileMessage(
      MINI_YAML.replace("      title: { type: text, required: true }", "      title: widget"),
    );
    expect(message).toContain("unknown field type");
    expect(message).toContain("widget");
    expect(message).toContain("Valid types:");
    for (const type of FIELD_TYPES) {
      expect(message).toContain(type);
    }
    expect(looksLikeStack(message)).toBe(false);
  });

  test("bad policy expression names the path and expected forms", () => {
    const message = compileMessage(MINI_YAML.replace("      read: owner(ownerId)", "      read: ownr"));
    expect(message).toContain('invalid policy "ownr"');
    expect(message).toContain("entities.items.policies.read");
    expect(message).toContain("Expected public, authenticated, admin, owner(field), or role(name).");
    expect(message.startsWith("app.yaml:")).toBe(true);
    expect(looksLikeStack(message)).toBe(false);
  });

  test("formatAppYamlError uses the message and never the stack", () => {
    const error = new SchemaError("JWT_SECRET is required in production");
    error.stack = "SchemaError: JWT_SECRET is required in production\n    at compileAppYaml (core.ts:1:1)";
    const text = formatAppYamlError(error);
    expect(text).toBe("app.yaml: JWT_SECRET is required in production");
    expect(looksLikeStack(text)).toBe(false);
  });

  test("bakorin start prints the friendly schema error once, without a stack", async () => {
    const dir = await tempProject(`${MINI_YAML}\ncars:\n  fields:\n    name: text\n`);
    const proc = Bun.spawn(
      ["bun", join(import.meta.dir, "../packages/server/src/cli.ts"), "start", "--dir", dir],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, BAKORIN_TEST: undefined, BAKORIN_ENV: undefined } },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('unknown top-level key "cars". Did you mean to put it under "entities:"?');
    expect(stderr.split("unknown top-level key").length - 1).toBe(1);
    expect(looksLikeStack(stderr)).toBe(false);
    expect(looksLikeStack(stdout)).toBe(false);
  });
});

describe("dev watcher debounce", () => {
  test("createDebounced runs once for a burst of triggers", async () => {
    let count = 0;
    const debounced = createDebounced(40, async () => {
      count += 1;
    });
    debounced.trigger();
    debounced.trigger();
    debounced.trigger();
    expect(count).toBe(0);
    // Timers can fire late on a busy runner: wait for the run, then check it ran once.
    const waitForCount = async (target: number) => {
      for (let i = 0; i < 200 && count < target; i += 1) await Bun.sleep(10);
    };
    await waitForCount(1);
    await Bun.sleep(60);
    expect(count).toBe(1);
    debounced.trigger();
    await waitForCount(2);
    expect(count).toBe(2);
    debounced.cancel();
  });
});
