import { subscribeToasts, type Toast } from "../lib/toast.ts";
import { useEffect, useState } from "preact/hooks";

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div class="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} class={`toast ${toast.kind}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
