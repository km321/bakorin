import type { APIRoute } from "astro";
import { api } from "../lib/bakorin.ts";

export const GET: APIRoute = async ({ cookies, redirect }) => {
  const refresh = cookies.get("bakorin_refresh")?.value;
  try {
    await api(cookies).logout(refresh);
  } catch {
    // still clear cookies
  }
  cookies.delete("bakorin_access", { path: "/" });
  cookies.delete("bakorin_refresh", { path: "/" });
  return redirect("/");
};
