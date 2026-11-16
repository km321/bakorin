import { NextResponse } from "next/server";
import { authMiddleware } from "@bakorin/sdk/next";
import { site } from "./lib/site.ts";

// Pages under site.protect need a session. Expired sessions renew through the pass
// through route (the refresh cookie only goes there), then come back.
const guard = authMiddleware({ baseUrl: process.env.BAKORIN_URL ?? "http://127.0.0.1:4371", protect: site.protect, loginPath: "/login" });

export async function middleware(request: Request) {
  return (await guard(request)) ?? NextResponse.next();
}

// Every page runs through the guard, which only acts on site.protect. Static files and the pass through route skip it.
export const config = {
  matcher: ["/((?!_next/|api/bakorin|favicon.ico).*)"],
};
