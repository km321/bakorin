export interface DebouncedWork {
  trigger: () => void;
  cancel: () => void;
}

export function createDebounced(ms: number, run: () => Promise<void> | void): DebouncedWork {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let queued = false;

  const kick = () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    void (async () => {
      try {
        await run();
      } finally {
        running = false;
        if (queued) {
          queued = false;
          kick();
        }
      }
    })();
  };

  return {
    trigger() {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        kick();
      }, ms);
    },
    cancel() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      queued = false;
    },
  };
}
