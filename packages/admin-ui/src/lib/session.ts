/** Shared admin session keys and cross-tab messaging. */

export const TOKEN_KEY = "bakorin_access";
export const REFRESH_KEY = "bakorin_refresh";
export const SESSION_NOTICE_KEY = "bakorin_session_notice";
export const LAST_ACTIVITY_KEY = "bakorin_last_activity";
export const SESSION_CHANNEL = "bakorin-session";
export const SESSION_ENDED_EVENT = "bakorin:session-ended";
export const REFRESH_LOCK = "bakorin-refresh";

/** How soon before access-token expiry to refresh, in milliseconds. */
export const REFRESH_SKEW_MS = 30_000;

export type SessionNotice = "expired" | "idle";

export type SessionMessage =
  | { type: "tokens" }
  | { type: "activity"; at: number }
  | { type: "signout"; reason?: SessionNotice };

export function sessionNoticeMessage(reason: SessionNotice): string {
  if (reason === "idle") {
    return "You were signed out after a period of inactivity. Sign in again.";
  }
  return "Your session expired. Sign in again.";
}

export function writeSessionNotice(reason: SessionNotice): void {
  try {
    sessionStorage.setItem(SESSION_NOTICE_KEY, reason);
  } catch {
    // Private mode or missing sessionStorage should not block sign-out.
  }
}

export function consumeSessionNotice(): SessionNotice | null {
  try {
    const raw = sessionStorage.getItem(SESSION_NOTICE_KEY);
    sessionStorage.removeItem(SESSION_NOTICE_KEY);
    return raw === "expired" || raw === "idle" ? raw : null;
  } catch {
    return null;
  }
}

export function dispatchSessionEnded(reason?: SessionNotice): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { reason } }));
}

let sharedChannel: BroadcastChannel | null | undefined;

function sessionChannel(): BroadcastChannel | null {
  if (sharedChannel !== undefined) {
    return sharedChannel;
  }
  if (typeof BroadcastChannel === "undefined") {
    sharedChannel = null;
    return null;
  }
  try {
    sharedChannel = new BroadcastChannel(SESSION_CHANNEL);
  } catch {
    sharedChannel = null;
  }
  return sharedChannel;
}

export function postSessionMessage(message: SessionMessage): void {
  try {
    sessionChannel()?.postMessage(message);
  } catch {
    // The channel can be closed while a tab is unloading.
  }
}

export function subscribeSessionMessages(handler: (message: SessionMessage) => void): () => void {
  const channel = sessionChannel();
  function onMessage(event: MessageEvent) {
    const data = event.data as SessionMessage;
    if (data && typeof data === "object" && typeof (data as SessionMessage).type === "string") {
      handler(data);
    }
  }
  function onStorage(event: StorageEvent) {
    if (event.key === LAST_ACTIVITY_KEY && event.newValue) {
      const at = Number(event.newValue);
      if (Number.isFinite(at)) {
        handler({ type: "activity", at });
      }
    }
    if (event.key === TOKEN_KEY && event.newValue === null && event.oldValue) {
      handler({ type: "signout" });
    }
  }
  channel?.addEventListener("message", onMessage);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    channel?.removeEventListener("message", onMessage);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/** For tests that need a clean BroadcastChannel between cases. */
export function resetSessionChannelForTests(): void {
  try {
    sharedChannel?.close();
  } catch {
    // ignore
  }
  sharedChannel = undefined;
}
