import { redirect } from "next/navigation";

// The pass through route revokes the session and clears both cookies.
export function GET() {
  redirect("/api/bakorin/-/logout?next=/");
}
