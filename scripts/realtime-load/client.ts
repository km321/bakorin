// One load generator worker: holds many SSE connections over raw TCP sockets
// (much lighter than fetch per stream) and records delivery latency.
// Started by run.ts; not meant to be used on its own.

export {};

interface Assignment {
  entity: string;
  token: string | null;
}

const host = process.env.LOAD_HOST ?? "127.0.0.1";
const port = Number(process.env.LOAD_PORT);
const assignments = JSON.parse(await Bun.file(process.env.LOAD_ASSIGNMENTS!).text()) as Assignment[];
const connectBatch = Number(process.env.LOAD_CONNECT_BATCH ?? 200);

// Latency histogram in 1 ms buckets up to 30 s, plus an overflow bucket.
const histogram = new Uint32Array(30_001);
let events = 0;
let ready = 0;
let failed = 0;
let closedCount = 0;
const failures = new Map<string, number>();
const connectTimes: number[] = [];

function now() {
  return performance.timeOrigin + performance.now();
}

function handleFrame(block: string) {
  if (block.includes("event: ready")) {
    ready += 1;
    return;
  }
  if (!block.includes("event: change")) return;
  events += 1;
  // Cheaper than JSON.parse, so the client is not the bottleneck.
  const at = block.indexOf('"sentAt":');
  const sentAt = at < 0 ? NaN : Number.parseFloat(block.slice(at + 9, at + 40));
  if (Number.isFinite(sentAt)) {
    const ms = Math.max(0, Math.round(now() - sentAt));
    histogram[Math.min(ms, 30_000)]! += 1;
  }
}

function open(assignment: Assignment): Promise<void> {
  const started = now();
  return new Promise((resolve) => {
    let buffer = "";
    let headerDone = false;
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    Bun.connect({
      hostname: host,
      port,
      socket: {
        open(socket) {
          const auth = assignment.token ? `Authorization: Bearer ${assignment.token}\r\n` : "";
          socket.write(
            `GET /api/v1/realtime?entities=${assignment.entity} HTTP/1.1\r\nHost: ${host}:${port}\r\nAccept: text/event-stream\r\n${auth}\r\n`,
          );
        },
        data(_socket, chunk) {
          buffer += chunk.toString();
          if (!headerDone) {
            const end = buffer.indexOf("\r\n\r\n");
            if (end < 0) return;
            const status = buffer.slice(9, 12);
            if (status !== "200") {
              failed += 1;
              failures.set(status, (failures.get(status) ?? 0) + 1);
              settle();
              _socket.end();
              return;
            }
            headerDone = true;
            buffer = buffer.slice(end + 4);
          }
          // Chunked transfer: strip the chunk size lines, keep the SSE text.
          buffer = buffer.replace(/(^|\r\n)[0-9a-fA-F]+\r\n/g, "$1");
          let index: number;
          while ((index = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, index).replace(/\r/g, "");
            buffer = buffer.slice(index + 2);
            if (block.includes("event: ready")) {
              connectTimes.push(now() - started);
              settle();
            }
            handleFrame(block);
          }
        },
        close() {
          closedCount += 1;
          settle();
        },
        error() {
          failed += 1;
          failures.set("socket", (failures.get("socket") ?? 0) + 1);
          settle();
        },
      },
    }).catch(() => {
      failed += 1;
      failures.set("connect", (failures.get("connect") ?? 0) + 1);
      settle();
    });
  });
}

for (let i = 0; i < assignments.length; i += connectBatch) {
  await Promise.all(assignments.slice(i, i + connectBatch).map(open));
}
process.stdout.write(`${JSON.stringify({ type: "connected", ready, failed, failures: Object.fromEntries(failures) })}\n`);

const report = () => {
  connectTimes.sort((a, b) => a - b);
  process.stdout.write(
    `${JSON.stringify({
      type: "final",
      ready,
      failed,
      closed: closedCount,
      events,
      failures: Object.fromEntries(failures),
      histogram: Array.from(histogram.entries()).filter(([, n]) => n > 0),
      connectP50: connectTimes[Math.floor(connectTimes.length * 0.5)] ?? 0,
      connectP99: connectTimes[Math.floor(connectTimes.length * 0.99)] ?? 0,
    })}\n`,
  );
  process.exit(0);
};
// The runner writes a line to stdin when it wants the numbers.
void (async () => {
  const reader = Bun.stdin.stream().getReader();
  await reader.read();
  report();
})();
// Periodic progress so the runner can tell when every stream is open.
setInterval(() => process.stdout.write(`${JSON.stringify({ type: "progress", ready, events, closed: closedCount })}\n`), 1000);
