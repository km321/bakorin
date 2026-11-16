"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@bakorin/sdk/browser";
import type { Task } from "../../lib/bakorin.ts";

/**
 * The task list, kept live: changes from other tabs and devices arrive over the
 * realtime stream, and the done toggle writes through /api/bakorin.
 */
export function LiveTasks({ initial }: { initial: Task[] }) {
  const [tasks, setTasks] = useState(initial);
  const [status, setStatus] = useState("connecting");
  const router = useRouter();

  useEffect(() => setTasks(initial), [initial]);

  useEffect(() => {
    const api = createBrowserClient<{ tasks: Task }>();
    return api.subscribe(
      "tasks",
      (change) => {
        setTasks((current) => {
          if (change.op === "delete") return current.filter((task) => task.id !== change.id);
          const record = change.record as Task;
          return current.some((task) => task.id === change.id)
            ? current.map((task) => (task.id === change.id ? record : task))
            : [record, ...current];
        });
      },
      { onStatus: setStatus, onReset: () => router.refresh() },
    );
  }, [router]);

  async function toggle(task: Task) {
    const api = createBrowserClient<{ tasks: Task }>();
    await api.entity("tasks").update(task.id, { done: !task.done });
  }

  return (
    <>
      <p className="live" aria-live="polite">
        {status === "open" ? "Live" : "Connecting"}
      </p>
      {tasks.length === 0 ? (
        <p className="empty">No tasks yet. Add one below.</p>
      ) : (
        <ul className="list">
          {tasks.map((task) => (
            <li key={task.id}>
              <span>{task.title}</span>
              <button type="button" className="secondary" onClick={() => void toggle(task)}>
                {task.done ? "Done" : "Open"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
