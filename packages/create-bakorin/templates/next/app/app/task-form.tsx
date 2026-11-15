"use client";

import { useState } from "react";

export function TaskForm({ action }: { action: (formData: FormData) => Promise<string | void> }) {
  const [error, setError] = useState("");
  return (
    <form
      action={async (formData) => {
        const message = await action(formData);
        if (message) {
          setError(message);
        }
      }}
    >
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <label>
        New task
        <input type="text" name="title" required maxLength={200} />
      </label>
      <div className="actions">
        <button type="submit">Add task</button>
      </div>
    </form>
  );
}
