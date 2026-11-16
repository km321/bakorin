/** bakorin dev and bakorin start: load the project, serve it, and reload on change in dev. */

import { watch } from "node:fs/promises";
import { join } from "node:path";
import { DestructiveChangeError, DEV_JWT_SECRET, formatAppYamlError, isAppYamlValidationError, isDevMode } from "@bakorin/core";
import { loadProject, serverBodyLimit } from "./app.ts";
import { createDebounced } from "./dev-watch.ts";
import { applyProjectEnv } from "./env-files.ts";
import { installProcessSafety } from "./monitor/process-safety.ts";
import { arg, projectDir } from "./cli-args.ts";

export function reportValidationError(error: unknown, context: "startup" | "reload"): void {
  if (error instanceof DestructiveChangeError) {
    if (context === "reload") {
      console.error("[bakorin] reload stopped; keeping previous schema");
    }
    console.error(error.message);
    return;
  }
  if (isAppYamlValidationError(error)) {
    if (context === "reload") {
      console.error("[bakorin] reload failed; keeping previous schema");
    }
    console.error(formatAppYamlError(error));
    return;
  }
  if (context === "reload") {
    console.error("[bakorin] reload failed; keeping previous schema");
    console.error(error instanceof Error ? error.message : error);
    return;
  }
  console.error(error);
}

export async function loadOrExit(dir: string, options: { workers?: boolean } = {}) {
  await applyProjectEnv(dir);
  try {
    return await loadProject(dir, options);
  } catch (error) {
    reportValidationError(error, "startup");
    process.exit(1);
  }
}

export async function serve(mode: "dev" | "start"): Promise<void> {
  const dir = projectDir();
  // Load the project .env first so a BAKORIN_ENV in it is checked too.
  await applyProjectEnv(dir);
  if (mode === "dev") {
    // The only place the public dev JWT secret is allowed. `start` is always production.
    process.env.BAKORIN_ENV = "development";
  } else if (isDevMode(process.env)) {
    console.error(
      "[bakorin] `bakorin start` is for production, but BAKORIN_ENV or BAKORIN_TEST asks for development. Use `bakorin dev` locally, or unset them.",
    );
    process.exit(1);
  }
  const runtime = await loadOrExit(dir);
  const port = Number(arg("--port", String(runtime.ast.runtime.port)));
  const hostname = runtime.ast.runtime.host;
  console.log(`[bakorin] ${runtime.ast.appName} ${mode} on http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}`);
  console.log(`[bakorin] admin UI http://127.0.0.1:${port}/admin/`);
  if (mode === "dev" && runtime.ast.runtime.jwtSecret === DEV_JWT_SECRET) {
    console.warn(
      "[bakorin] WARNING: using the default JWT secret. Set JWT_SECRET in this project's .env before going beyond local experiments.",
    );
  }
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port,
      hostname,
      fetch: runtime.app.fetch,
      maxRequestBodySize: serverBodyLimit(runtime.ast),
    });
  } catch (error) {
    console.error(`[bakorin] could not listen on ${hostname}:${port}: ${error instanceof Error ? error.message : String(error)}`);
    await runtime.close().catch(() => undefined);
    process.exit(1);
  }
  // Installed only after the server is listening, so a boot failure still exits.
  installProcessSafety(runtime.context.monitor);
  if (mode === "dev") {
    const yamlPath = join(dir, "app.yaml");
    const hooksPath = join(dir, runtime.ast.runtime.hooksPath ?? "hooks.ts");
    const debounced = createDebounced(150, async () => {
      try {
        const source = await Bun.file(yamlPath).text();
        await runtime.reload(source);
      } catch (error) {
        reportValidationError(error, "reload");
      }
    });
    const watcher = watch(dir);
    void (async () => {
      for await (const event of watcher) {
        const name = event.filename ?? "";
        if (name === "app.yaml" || name === "hooks.ts" || yamlPath.endsWith(name) || hooksPath.endsWith(name)) {
          debounced.trigger();
        }
      }
    })();
  }
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`[bakorin] ${signal}: finishing in-flight requests, then stopping`);
    const force = setTimeout(() => process.exit(0), 15_000);
    try {
      // Realtime streams never finish on their own: tell them to reconnect elsewhere first.
      await runtime.context.realtime?.drain();
      void server.stop();
      const deadline = Date.now() + 10_000;
      while (server.pendingRequests > 0 && Date.now() < deadline) {
        await Bun.sleep(50);
      }
      await runtime.close();
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
