import { api } from "../../lib/bakorin.ts";
import { Sections } from "../sections.tsx";

export const metadata = { title: "About" };
export const dynamic = "force-dynamic";

export default async function AboutPage() {
  // Sections are public in app.yaml. Edit them in the Bakorin admin at /admin on the API.
  const { data: sections } = await (await api()).entity("sections").list({ filter: { page: "about" }, sort: "position", limit: 50 });
  return <Sections sections={sections} emptyText="No sections for the about page yet. Add some in the Bakorin admin, or run bun seed.ts for example content." />;
}
