import type { APIRoute } from "astro";

// The pass through route revokes the session and clears both cookies.
export const GET: APIRoute = ({ redirect }) => redirect("/api/bakorin/-/logout?next=/");
