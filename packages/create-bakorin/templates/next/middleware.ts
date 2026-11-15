import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/app")) {
    return NextResponse.next();
  }
  const token = request.cookies.get("bakorin_access")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const base = process.env.BAKORIN_URL ?? "http://127.0.0.1:4371";
  const me = await fetch(new URL("/api/v1/auth/me", base), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!me.ok) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
