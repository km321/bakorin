import { api } from "../../../lib/bakorin.ts";
import { TasksCrud } from "./tasks-crud.tsx";

export default async function TasksPage() {
  const client = await api();
  const initial = await client.entity("tasks").list({ sort: "-createdAt", limit: 10 });
  return (
    <section className="card">
      <h1>Your tasks</h1>
      <p className="lede">Private to your account. Tick a task to finish it; changes show in every open tab.</p>
      <TasksCrud initial={initial} />
    </section>
  );
}
