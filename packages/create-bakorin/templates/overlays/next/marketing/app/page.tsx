import { api } from "../lib/bakorin.ts";
import { Sections } from "./sections.tsx";

export const metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Sections are public in app.yaml. Edit them in the Bakorin admin at /admin on the API.
  const { data: sections } = await (await api()).entity("sections").list({ filter: { page: "home" }, sort: "position", limit: 50 });
  return <Sections sections={sections} emptyText="No sections for the home page yet. Add some in the Bakorin admin, or run bun seed.ts for example content." />;
}
