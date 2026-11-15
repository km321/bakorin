import { createNextClient } from "@bakorin/sdk/next";
import { cookies } from "next/headers";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  ownerId: string;
};

export function bakorinUrl(): string {
  return process.env.BAKORIN_URL ?? "http://127.0.0.1:4371";
}

export async function api() {
  return createNextClient<{ users: Record<string, unknown>; tasks: Task }>({
    baseUrl: bakorinUrl(),
    cookies: await cookies(),
  });
}
