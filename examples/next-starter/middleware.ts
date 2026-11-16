import { NextResponse } from "next/server";
import { authMiddleware } from "@bakorin/sdk/next";

// Pages under /app need a session. Expired sessions renew through the pass through
// route (the refresh cookie only goes there), then come back.
const guard = authMiddleware({ baseUrl: process.env.BAKORIN_URL ?? "http://127.0.0.1:4371", protect: ["/app"], loginPath: "/login" });

export async function middleware(request: Request) {
  return (await guard(request)) ?? NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
