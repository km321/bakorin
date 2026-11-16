import type { EntityAST, SchemaAST } from "@bakorin/core";
import type { Actor } from "../context.ts";
import type { BakorinDb } from "../db/dialects.ts";
import type { ChangeBus } from "../bus.ts";
import { decideAccess } from "../crud/policies-sql.ts";
import { visibleRow } from "../crud/validate.ts";
import { onSessionsChanged, tokenCutoff, type SessionChange } from "../auth/refresh.ts";
import type { BrokerMessage, RealtimeBroker } from "./broker.ts";
import { pruneRealtime, readRealtimeAfter, realtimeBounds, type RealtimeRow } from "./log.ts";

const encoder = new TextEncoder();
const PING = encoder.encode(": ping\n\n");

/** Why a stream was closed by the server. Sent as an `closed` event before the stream ends. */
export type CloseReason =
  | "token_expired"
  | "signed_out"
  | "role_changed"
  | "user_deleted"
  | "logged_out"
  | "slow_consumer"
  | "server_restart"
  | "not_realtime";

export interface RealtimeStats {
  started: boolean;
  broker: string;
  brokerHealthy: boolean;
  draining: boolean;
  connections: number;
  connectionsByEntity: Record<string, number>;
  users: number;
  cursor: number;
  eventsTotal: number;
  deliveriesTotal: number;
  framesBuiltTotal: number;
  droppedSlowTotal: number;
  closedByServerTotal: number;
  rejectedTotal: Record<string, number>;
  resetsTotal: number;
  connectsTotal: number;
}

export interface ConnectInput {
  actor: Actor | null;
  /** From the verified access token, when there is one. */
  issuedAtMs?: number;
  expiresAtMs?: number;
  tokenHash?: string;
  ip: string;
  entities: string[];
  lastEventId?: number;
  signal?: AbortSignal;
}

interface Subscriber {
  id: number;
  actor: Actor | null;
  userKey: string;
  issuedAtMs?: number;
  tokenHash?: string;
  entities: string[];
  lastSeq: number;
  ready: boolean;
  backlog: RealtimeRow[];
  controller: ReadableStreamDefaultController<Uint8Array>;
  closed: boolean;
  expiry?: ReturnType<typeof setTimeout>;
}

export interface RealtimeHub {
  readonly brokerName: string;
  start(): Promise<void>;
  connect(input: ConnectInput): Promise<Response>;
  stats(): RealtimeStats;
  /** Read new log rows now (tests, and after a broker reconnect). */
  pump(): Promise<void>;
  /** Tell every stream to reconnect elsewhere and refuse new ones (SIGTERM). */
  drain(): Promise<void>;
  close(): Promise<void>;
}

export interface HubOptions {
  ast: () => SchemaAST;
  db: BakorinDb;
  broker: RealtimeBroker;
  /** Shown in stats before the broker is created. */
  brokerName?: string;
  bus: ChangeBus;
  /** How long to wait for a lower id still in another transaction before skipping it. */
  gapWaitMs?: number;
  /** Safety poll of the log when other instances may write. */
  pollMs?: number;
  /** How often open streams are rechecked against the database (role, sign out, deleted user). */
  revalidateMs?: number;
  /** Bytes queued for one client before it counts as too slow and is dropped. */
  maxBufferBytes?: number;
  onError?: (error: unknown) => void;
}

function json(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const policyShapes = new WeakMap<EntityAST, { isPublic: boolean; byRole: boolean; byOwner: boolean }>();

function policyShape(entity: EntityAST) {
  let shape = policyShapes.get(entity);
  if (!shape) {
    const read = entity.policies.read;
    shape = {
      isPublic: read.some((policy) => policy.kind === "public"),
      byRole: read.some((policy) => policy.kind === "role"),
      byOwner: read.some((policy) => policy.kind === "owner"),
    };
    policyShapes.set(entity, shape);
  }
  return shape;
}

/**
 * Subscribers whose key matches see exactly the same bytes for a given event, so
 * the frame is built once per key and shared. Public read entities collapse to one
 * key for everyone who is not an admin.
 */
export function groupKey(
  ast: SchemaAST,
  entity: EntityAST,
  actor: Actor | null,
  recordId: string,
  shape = policyShape(entity),
): string {
  if (actor && actor.role === ast.auth.adminRole) {
    return "a";
  }
  const self = actor && recordId === actor.id && entity.name === ast.auth.entity;
  if (shape.isPublic) {
    return self ? "p:self" : "p";
  }
  if (!actor) {
    return "x";
  }
  let key = "u";
  if (shape.byRole) key += `:${actor.role}`;
  if (shape.byOwner) key += `:${actor.id}`;
  return self ? `${key}:self` : key;
}

function readable(ast: SchemaAST, entity: EntityAST, actor: Actor | null, record: Record<string, unknown> | null): boolean {
  if (!record) {
    return false;
  }
  const decision = decideAccess(ast, entity, "read", actor);
  if (!decision.allow) {
    return false;
  }
  if (decision.bypass || decision.ownerFields.length === 0) {
    return true;
  }
  return decision.ownerFields.some((field) => actor !== null && String(record[field] ?? "") === actor.id);
}

/** The SSE frame one reader gets for a change, or null when they may not see it. */
export function buildFrame(ast: SchemaAST, entity: EntityAST, row: RealtimeRow, actor: Actor | null): Uint8Array | null {
  const canAfter = row.op !== "delete" && readable(ast, entity, actor, row.after);
  const canBefore = row.op !== "create" && readable(ast, entity, actor, row.before);
  let op: "create" | "update" | "delete";
  if (row.op === "create") {
    if (!canAfter) return null;
    op = "create";
  } else if (row.op === "update") {
    if (canAfter) op = "update";
    else if (canBefore) op = "delete"; // the record left this reader's view
    else return null;
  } else {
    if (!canBefore) return null;
    op = "delete";
  }
  const payload: Record<string, unknown> = { entity: entity.name, op, id: row.recordId, at: row.at };
  if (op !== "delete" && entity.realtime === "full" && row.after) {
    const record = visibleRow(ast, entity, row.after, actor);
    // Linked ids are only sent when anyone may read the linked entity (or to
    // admins). Otherwise the field is left out and clients refetch the record,
    // which filters ids per reader. Keeps one shared frame per policy group.
    if (!(actor && actor.role === ast.auth.adminRole)) {
      for (const field of entity.fields) {
        if (!field.relation?.many) continue;
        const target = ast.entityMap[field.relation.to];
        if (!target?.policies.read.some((policy) => policy.kind === "public")) delete record[field.name];
      }
    }
    payload.record = record;
  }
  return encoder.encode(`id: ${row.seq}\nevent: change\ndata: ${JSON.stringify(payload)}\n\n`);
}

function frame(event: string, data: unknown, extra = ""): Uint8Array {
  return encoder.encode(`${extra}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createRealtimeHub(options: HubOptions): RealtimeHub {
  const { db, bus } = options;
  // Read lazily: a networked broker connects on first use, only once realtime starts.
  const broker = () => options.broker;
  const gapWaitMs = options.gapWaitMs ?? 2000;
  const pollMs = options.pollMs ?? 1000;
  const revalidateMs = options.revalidateMs ?? 30_000;
  const maxBufferBytes = options.maxBufferBytes ?? 1024 * 1024;
  const instance = crypto.randomUUID();
  const reportRaw = options.onError ?? ((error: unknown) => console.error("[bakorin] realtime error", error));
  // Work still in flight when the hub closes is expected to fail; do not report it.
  const report = (error: unknown) => {
    if (!closing) reportRaw(error);
  };

  const subscribers = new Set<Subscriber>();
  const byEntity = new Map<string, Set<Subscriber>>();
  const byUser = new Map<string, Set<Subscriber>>();
  let ring: RealtimeRow[] = [];
  let cursor = 0;
  let gapSince: number | null = null;
  let started = false;
  let starting: Promise<void> | null = null;
  let draining = false;
  let closing = false;
  let pumping: Promise<void> | null = null;
  let pumpAgain = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  // Adaptive batching: when fan-out gets expensive, wait a little so the next pump
  // carries several events and each client gets one write instead of many.
  let lastDeliverMs = 0;
  let lastPumpAt = 0;
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  let publishPending = false;
  let nextId = 1;
  const timers: Array<ReturnType<typeof setInterval>> = [];
  const unsubscribers: Array<() => void> = [];
  const counters = {
    eventsTotal: 0,
    deliveriesTotal: 0,
    framesBuiltTotal: 0,
    droppedSlowTotal: 0,
    closedByServerTotal: 0,
    resetsTotal: 0,
    connectsTotal: 0,
    rejected: {} as Record<string, number>,
  };
  const reject = (reason: string) => {
    counters.rejected[reason] = (counters.rejected[reason] ?? 0) + 1;
  };

  const ast = () => options.ast();
  const replayLimit = () => ast().runtime.realtime.replayEvents;

  function remove(sub: Subscriber): void {
    if (!subscribers.delete(sub)) {
      return;
    }
    sub.closed = true;
    if (sub.expiry) clearTimeout(sub.expiry);
    for (const name of sub.entities) {
      const set = byEntity.get(name);
      set?.delete(sub);
      if (set && set.size === 0) byEntity.delete(name);
    }
    const users = byUser.get(sub.userKey);
    users?.delete(sub);
    if (users && users.size === 0) byUser.delete(sub.userKey);
  }

  /** Enqueue bytes; a client whose queue passes the limit is dropped and its queue discarded. */
  function send(sub: Subscriber, bytes: Uint8Array): boolean {
    if (sub.closed) {
      return false;
    }
    try {
      sub.controller.enqueue(bytes);
    } catch {
      remove(sub);
      return false;
    }
    const desired = sub.controller.desiredSize;
    if (desired !== null && desired < 0) {
      counters.droppedSlowTotal += 1;
      remove(sub);
      try {
        sub.controller.error(new Error("slow consumer"));
      } catch {
        // already gone
      }
      return false;
    }
    return true;
  }

  function closeSub(sub: Subscriber, reason: CloseReason, retryMs?: number): void {
    if (sub.closed) {
      return;
    }
    counters.closedByServerTotal += 1;
    send(sub, frame("closed", { reason }, retryMs ? `retry: ${retryMs}\n` : ""));
    remove(sub);
    try {
      sub.controller.close();
    } catch {
      // already closed
    }
  }

  function remember(row: RealtimeRow): void {
    ring.push(row);
    const limit = replayLimit();
    if (ring.length > limit + Math.max(16, Math.floor(limit / 10))) {
      ring = ring.slice(ring.length - limit);
    }
  }

  function deliverTo(sub: Subscriber, row: RealtimeRow): void {
    if (row.seq <= sub.lastSeq) return;
    sub.lastSeq = row.seq;
    const entity = ast().entityMap[row.entity];
    if (!entity?.realtime) return;
    const bytes = buildFrame(ast(), entity, row, sub.actor);
    counters.framesBuiltTotal += 1;
    if (bytes && send(sub, bytes)) counters.deliveriesTotal += 1;
  }

  /**
   * Fans a batch of rows out to subscribers. Each frame is built once per policy
   * context, and each subscriber gets one write per batch (fewer syscalls when
   * events arrive in bursts).
   */
  function deliver(rows: RealtimeRow[]): void {
    if (rows.length === 0) return;
    const startedAt = performance.now();
    try {
      fanOut(rows);
    } finally {
      lastDeliverMs = performance.now() - startedAt;
    }
  }

  function fanOut(rows: RealtimeRow[]): void {
    counters.eventsTotal += rows.length;
    const schema = ast();
    const pending = new Map<Subscriber, Uint8Array[]>();
    for (const row of rows) {
      const subs = byEntity.get(row.entity);
      if (!subs || subs.size === 0) continue;
      const entity = schema.entityMap[row.entity];
      if (!entity?.realtime) continue;
      const frames = new Map<string, Uint8Array | null>();
      const shape = policyShape(entity);
      for (const sub of subs) {
        if (sub.closed) continue;
        if (!sub.ready) {
          sub.backlog.push(row);
          if (sub.backlog.length > replayLimit() + 1000) {
            closeSub(sub, "slow_consumer");
          }
          continue;
        }
        if (row.seq <= sub.lastSeq) continue;
        sub.lastSeq = row.seq;
        const key = groupKey(schema, entity, sub.actor, row.recordId, shape);
        let bytes = frames.get(key);
        if (bytes === undefined) {
          bytes = buildFrame(schema, entity, row, sub.actor);
          counters.framesBuiltTotal += 1;
          frames.set(key, bytes);
        }
        if (!bytes) continue;
        const list = pending.get(sub);
        if (list) list.push(bytes);
        else pending.set(sub, [bytes]);
      }
    }
    for (const [sub, chunks] of pending) {
      const bytes = chunks.length === 1 ? chunks[0]! : concat(chunks);
      if (send(sub, bytes)) counters.deliveriesTotal += chunks.length;
    }
  }

  /** Reads new log rows in id order. A missing id may belong to a transaction that has not committed yet. */
  async function pumpOnce(): Promise<boolean> {
    const rows = await readRealtimeAfter(db, cursor, 500);
    const ready: RealtimeRow[] = [];
    for (const row of rows) {
      if (row.seq !== cursor + 1) {
        const now = Date.now();
        gapSince ??= now;
        if (now - gapSince < gapWaitMs) {
          if (!retryTimer && !closing) {
            retryTimer = setTimeout(() => {
              retryTimer = null;
              void pump();
            }, 50);
          }
          deliver(ready);
          return false;
        }
        // Waited long enough: the missing ids were rolled back.
      }
      gapSince = null;
      cursor = row.seq;
      remember(row);
      ready.push(row);
    }
    deliver(ready);
    return rows.length === 500;
  }

  function pump(): Promise<void> {
    if (!started || closing) {
      return Promise.resolve();
    }
    if (pumping) {
      pumpAgain = true;
      return pumping;
    }
    // At most one flush per window. The window grows with the audience (each write
    // to a stream has a fixed cost) and with how long the last fan-out took. A
    // lone event still goes out at once; only bursts are batched.
    const delay = Math.min(100, Math.max(lastDeliverMs > 2 ? lastDeliverMs * 2 : 0, subscribers.size >= 1000 ? subscribers.size / 100 : 0));
    const since = Date.now() - lastPumpAt;
    if (delay > 0 && since < delay) {
      coalesceTimer ??= setTimeout(() => {
        coalesceTimer = null;
        void pump();
      }, delay - since);
      return Promise.resolve();
    }
    lastPumpAt = Date.now();
    pumping = (async () => {
      try {
        do {
          pumpAgain = false;
          while (await pumpOnce()) {
            // keep reading full batches
          }
        } while (pumpAgain);
      } catch (error) {
        if (!closing) report(error);
      } finally {
        pumping = null;
      }
    })();
    return pumping;
  }

  function publishChanges(): void {
    if (publishPending) return;
    publishPending = true;
    setTimeout(() => {
      publishPending = false;
      if (closing) return;
      void broker().publish({ kind: "changes", seq: cursor, origin: instance });
    }, 0);
  }

  async function revalidateUser(userId: string): Promise<void> {
    const subs = byUser.get(`u:${userId}`);
    if (!subs || subs.size === 0 || closing) return;
    const schema = ast();
    const entity = schema.entityMap[schema.auth.entity];
    if (!entity) return;
    const row = (await db.selectFrom(entity.name).select(["id", schema.auth.roleField]).where("id", "=", userId).executeTakeFirst()) as
      | Record<string, unknown>
      | undefined;
    const cutoff = row ? await tokenCutoff(db, userId) : 0;
    for (const sub of [...subs]) {
      if (!row) closeSub(sub, "user_deleted");
      else if (cutoff && (sub.issuedAtMs ?? 0) < cutoff) closeSub(sub, "signed_out");
      else if (sub.actor && String(row[schema.auth.roleField]) !== sub.actor.role) closeSub(sub, "role_changed");
    }
  }

  function closeToken(userId: string, tokenHash: string): void {
    for (const sub of [...(byUser.get(`u:${userId}`) ?? [])]) {
      if (sub.tokenHash === tokenHash) closeSub(sub, "logged_out");
    }
  }

  function handleSession(change: SessionChange, fromBroker: boolean): void {
    if (change.tokenHash) closeToken(change.userId, change.tokenHash);
    else void revalidateUser(change.userId).catch(report);
    if (!fromBroker && started && !closing) {
      void broker().publish(
        (change.tokenHash
          ? { kind: "token", userId: change.userId, tokenHash: change.tokenHash, origin: instance }
          : { kind: "user", userId: change.userId, origin: instance }),
      );
    }
  }

  async function start(): Promise<void> {
    if (started) return;
    if (starting) return starting;
    starting = (async () => {
      cursor = (await realtimeBounds(db)).latest;
      started = true;
      unsubscribers.push(
        bus.subscribe((event) => {
          const schema = ast();
          if (schema.entityMap[event.entity]?.realtime) {
            void pump();
            publishChanges();
          }
          if (event.entity === schema.auth.entity && event.op !== "create") {
            const id = String(event.before?.id ?? event.after?.id ?? "");
            if (id) handleSession({ userId: id }, false);
          }
        }),
        broker().subscribe((message) => {
          if ((message as { origin?: string }).origin === instance) return;
          if (message.kind === "changes") void pump();
          else if (message.kind === "user") handleSession({ userId: message.userId }, true);
          else if (message.kind === "token") handleSession({ userId: message.userId, tokenHash: message.tokenHash }, true);
        }),
        broker().onReconnect(() => {
          void pump();
          for (const key of byUser.keys()) {
            if (key.startsWith("u:")) void revalidateUser(key.slice(2)).catch(report);
          }
        }),
        onSessionsChanged((change) => handleSession(change, false)),
      );
      const heartbeat = Math.max(1, ast().runtime.realtime.heartbeatSeconds) * 1000;
      timers.push(
        setInterval(() => {
          for (const sub of [...subscribers]) send(sub, PING);
        }, heartbeat),
        setInterval(() => {
          for (const key of [...byUser.keys()]) {
            if (key.startsWith("u:")) void revalidateUser(key.slice(2)).catch(report);
          }
        }, revalidateMs),
        setInterval(() => {
          void pruneRealtime(db, ast().runtime.realtime.retainMinutes * 60_000).catch((error) => {
            if (!closing) report(error);
          });
        }, 60_000),
      );
      if (broker().multiInstance) {
        timers.push(setInterval(() => void pump(), pollMs));
      }
      for (const timer of timers) (timer as { unref?: () => void }).unref?.();
    })();
    try {
      await starting;
    } finally {
      starting = null;
    }
  }

  async function prepare(sub: Subscriber, lastEventId: number | undefined): Promise<void> {
    const head = cursor;
    let rows: RealtimeRow[] = [];
    let reset = false;
    if (lastEventId !== undefined && lastEventId < head) {
      const limit = replayLimit();
      const window = ring.length > limit ? ring.slice(ring.length - limit) : ring;
      const ringOldest = window[0]?.seq;
      if (ringOldest !== undefined && ringOldest <= lastEventId + 1) {
        rows = window.filter((row) => row.seq > lastEventId && row.seq <= head);
      } else {
        const { oldest } = await realtimeBounds(db);
        if (oldest === 0 || oldest > lastEventId + 1) {
          reset = true;
        } else {
          rows = (await readRealtimeAfter(db, lastEventId, replayLimit() + 1)).filter((row) => row.seq <= head);
          reset = rows.length > replayLimit();
        }
      }
    }
    if (reset) {
      counters.resetsTotal += 1;
      send(sub, frame("reset", { reason: "too_far_behind", lastEventId: head }, `id: ${head}\n`));
      sub.lastSeq = head;
    } else {
      sub.lastSeq = lastEventId ?? head;
      for (const row of rows) deliverTo(sub, row);
      sub.lastSeq = Math.max(sub.lastSeq, lastEventId ?? head);
    }
    send(sub, frame("ready", { entities: sub.entities, lastEventId: Math.max(head, sub.lastSeq) }));
    sub.ready = true;
    const backlog = sub.backlog;
    sub.backlog = [];
    for (const row of backlog) deliverTo(sub, row);
  }

  return {
    get brokerName() {
      return options.brokerName ?? (started ? broker().name : "memory");
    },
    start,
    pump,
    async connect(input) {
      const schema = ast();
      if (draining || closing) {
        reject("draining");
        return json(503, "draining", "this server is restarting, reconnect in a moment", { "retry-after": "2" });
      }
      const names = [...new Set(input.entities.map((name) => name.trim()).filter(Boolean))];
      if (names.length === 0) {
        reject("bad_request");
        return json(400, "invalid_input", "pass ?entities=name,name for realtime entities");
      }
      for (const name of names) {
        const entity = schema.entityMap[name];
        if (!entity || !entity.realtime) {
          reject("not_realtime");
          return json(404, "not_realtime", `${name} does not have realtime enabled in app.yaml`);
        }
        const decision = decideAccess(schema, entity, "read", input.actor);
        if (!decision.allow) {
          reject(decision.status === 401 ? "unauthenticated" : "forbidden");
          return decision.status === 401
            ? json(401, "unauthenticated", "sign in required")
            : json(403, "forbidden", `you cannot read ${name}`);
        }
      }
      if (subscribers.size >= schema.runtime.realtime.maxConnections) {
        reject("server_full");
        return json(503, "too_many_connections", "this server has too many realtime connections", { "retry-after": "5" });
      }
      const userKey = input.actor ? `u:${input.actor.id}` : `ip:${input.ip}`;
      if ((byUser.get(userKey)?.size ?? 0) >= schema.runtime.realtime.maxPerUser) {
        reject("user_limit");
        return json(429, "too_many_connections", "too many realtime connections for this user", { "retry-after": "5" });
      }
      await start();
      counters.connectsTotal += 1;
      let sub!: Subscriber;
      const stream = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            sub = {
              id: nextId++,
              actor: input.actor,
              userKey,
              issuedAtMs: input.issuedAtMs,
              tokenHash: input.tokenHash,
              entities: names,
              lastSeq: 0,
              ready: false,
              backlog: [],
              controller,
              closed: false,
            };
            subscribers.add(sub);
            for (const name of names) {
              let set = byEntity.get(name);
              if (!set) byEntity.set(name, (set = new Set()));
              set.add(sub);
            }
            let users = byUser.get(userKey);
            if (!users) byUser.set(userKey, (users = new Set()));
            users.add(sub);
            controller.enqueue(encoder.encode(`retry: 3000\n\n`));
          },
          cancel() {
            remove(sub);
          },
        },
        { highWaterMark: maxBufferBytes, size: (chunk) => chunk?.byteLength ?? 0 },
      );
      if (input.expiresAtMs) {
        sub.expiry = setTimeout(() => closeSub(sub, "token_expired"), Math.max(0, input.expiresAtMs - Date.now()));
        (sub.expiry as { unref?: () => void }).unref?.();
      }
      input.signal?.addEventListener("abort", () => remove(sub), { once: true });
      void prepare(sub, input.lastEventId).catch((error) => {
        report(error);
        closeSub(sub, "server_restart");
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
        },
      });
    },
    stats() {
      const connectionsByEntity: Record<string, number> = {};
      for (const [name, set] of byEntity) connectionsByEntity[name] = set.size;
      return {
        started,
        broker: options.brokerName ?? (started ? broker().name : "memory"),
        brokerHealthy: started ? broker().healthy() : false,
        draining,
        connections: subscribers.size,
        connectionsByEntity,
        users: byUser.size,
        cursor,
        eventsTotal: counters.eventsTotal,
        deliveriesTotal: counters.deliveriesTotal,
        framesBuiltTotal: counters.framesBuiltTotal,
        droppedSlowTotal: counters.droppedSlowTotal,
        closedByServerTotal: counters.closedByServerTotal,
        rejectedTotal: { ...counters.rejected },
        resetsTotal: counters.resetsTotal,
        connectsTotal: counters.connectsTotal,
      };
    },
    async drain() {
      draining = true;
      for (const sub of [...subscribers]) {
        // Spread reconnects over a few seconds so a restart is not a thundering herd.
        closeSub(sub, "server_restart", 1000 + Math.floor(Math.random() * 4000));
      }
    },
    async close() {
      closing = true;
      for (const sub of [...subscribers]) closeSub(sub, "server_restart", 1000 + Math.floor(Math.random() * 4000));
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
      if (retryTimer) clearTimeout(retryTimer);
      if (coalesceTimer) clearTimeout(coalesceTimer);
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
      await pumping?.catch(() => undefined);
      if (started) {
        await broker().close();
      }
    },
  };
}
