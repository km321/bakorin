import { api, type Task } from "../../lib/bakorin.ts";
import { createTaskAction } from "../actions.ts";
import { TaskForm } from "./task-form.tsx";

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
      {tasks.length === 0 ? (
        <p className="empty">No tasks yet. Add one below.</p>
      ) : (
        <ul className="list">
          {tasks.map((task) => (
            <li key={task.id}>
              <span>{task.title}</span>
              <span>{task.done ? "done" : "open"}</span>
            </li>
          ))}
        </ul>
      )}
      <TaskForm action={createTaskAction} />
    </section>
  );
}
