import { createNextClient, rightmostForwardedFor } from "@bakorin/sdk/next";
import { cookies, headers } from "next/headers";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  ownerId: string;
};

export function bakorinUrl(): string {
  return process.env.BAKORIN_URL ?? "http://127.0.0.1:4371";
}

// With BAKORIN_PROXY_SECRET set on both sides, Bakorin applies lockouts and rate
// limits per visitor. The visitor IP is the right end of X-Forwarded-For, which is
// right behind one platform or proxy (Vercel, Railway, Netlify, Fly, nginx).
export async function api() {
  return createNextClient<{ users: Record<string, unknown>; tasks: Task }>({
    baseUrl: bakorinUrl(),
    cookies: await cookies(),
    clientIp: rightmostForwardedFor(await headers()),
  });
}
