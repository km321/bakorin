// Shared helpers for realtime tests: read server sent events from a Response.

export interface SseEvent {
  id?: string;
  event: string;
  data: any;
  retry?: number;
}

export function sseReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: SseEvent[] = [];
  let done = false;
  const waiters: Array<() => void> = [];
  const wake = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  void (async () => {
    try {
      while (true) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const event: SseEvent = { event: "message", data: null };
          let data = "";
          let hasField = false;
          for (const line of block.split("\n")) {
            if (line.startsWith(":")) continue;
            const colon = line.indexOf(":");
            const field = colon < 0 ? line : line.slice(0, colon);
            const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
            hasField = true;
            if (field === "id") event.id = value;
            else if (field === "event") event.event = value;
            else if (field === "data") data += (data ? "\n" : "") + value;
            else if (field === "retry") event.retry = Number(value);
          }
          if (!hasField || (!data && event.retry !== undefined && event.event === "message")) continue;
          event.data = data ? JSON.parse(data) : null;
          events.push(event);
          wake();
        }
      }
    } catch {
      // stream errored (slow consumer drop) or was cancelled
    }
    done = true;
    wake();
  })();
  return {
    events,
    get done() {
      return done;
    },
    /** Waits until an event matching the predicate arrives (searching from `from`). */
    async next(match: (event: SseEvent) => boolean = () => true, timeoutMs = 3000, from = 0): Promise<SseEvent> {
      const deadline = Date.now() + timeoutMs;
      while (true) {
        const found = events.slice(from).find(match);
        if (found) return found;
        if (done) throw new Error(`stream ended without a matching event; got ${JSON.stringify(events)}`);
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`timed out waiting for event; got ${JSON.stringify(events)}`);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, left);
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
    changes() {
      return events.filter((event) => event.event === "change");
    },
    async ended(timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      while (!done && Date.now() < deadline) await Bun.sleep(10);
      return done;
    },
    cancel() {
      void reader.cancel().catch(() => undefined);
    },
  };
}
