import { useEffect, useState } from "preact/hooks";
import { expireSession } from "../lib/api.ts";
import { createIdleController, idleTimeoutMs } from "../lib/idle.ts";
import { subscribeSessionMessages } from "../lib/session.ts";

interface Props {
  idleTimeoutMinutes: number | null | undefined;
}

export function IdleSession({ idleTimeoutMinutes }: Props) {
  const timeoutMs = idleTimeoutMs(idleTimeoutMinutes);
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    if (timeoutMs === null) {
      return;
    }
    const controller = createIdleController({
      timeoutMs,
      onWarning: () => setWarning(true),
      onWarningCancel: () => setWarning(false),
      onIdle: () => {
        setWarning(false);
        void expireSession("idle");
      },
    });
    controller.start();
    const unsubscribe = subscribeSessionMessages((message) => {
      if (message.type === "activity") {
        controller.syncFromStorage();
      }
      if (message.type === "signout") {
        controller.stop();
        setWarning(false);
      }
    });
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, [timeoutMs]);

  if (!warning || timeoutMs === null) {
    return null;
  }

  return (
    <>
      <div class="dialog-backdrop" />
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" data-idle-warning>
        <h2 id="idle-title">Still there?</h2>
        <p>You will be signed out in 1 minute due to inactivity.</p>
        <div class="dialog-actions">
          <button
            class="btn"
            type="button"
            onClick={() => {
              setWarning(false);
              // A click is activity; the idle controller also records it.
            }}
          >
            Stay signed in
          </button>
        </div>
      </div>
    </>
  );
}
