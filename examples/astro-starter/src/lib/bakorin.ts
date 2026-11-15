import { createAstroClient } from "@bakorin/sdk/astro";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  ownerId: string;
};

export function bakorinUrl(): string {
  return import.meta.env.BAKORIN_URL ?? process.env.BAKORIN_URL ?? "http://127.0.0.1:4371";
}

export function api(cookies: Parameters<typeof createAstroClient>[0]["cookies"]) {
  return createAstroClient<{ users: Record<string, unknown>; tasks: Task }>({
    baseUrl: bakorinUrl(),
    cookies,
  });
}
