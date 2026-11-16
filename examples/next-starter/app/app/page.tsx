import { api, type Task } from "../../lib/bakorin.ts";
import { createTaskAction } from "../actions.ts";
import { TaskForm } from "./task-form.tsx";
import { LiveTasks } from "./live-tasks.tsx";

export default async function AppPage() {
  const client = await api();
  let tasks: Task[] = [];
  let error = "";
  try {
    const listed = await client.entity("tasks").list({ sort: "-createdAt", limit: 50 });
    tasks = listed.data;
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not load tasks";
  }
  return (
    <section className="card">
      <h1>Your tasks</h1>
      <p className="lede">Private to your account. Create a record and it is stored in Bakorin.</p>
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <LiveTasks initial={tasks} />
      <TaskForm action={createTaskAction} />
    </section>
  );
}
