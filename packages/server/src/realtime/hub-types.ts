/** Public shapes of the realtime hub: options, stats, connect input, and close reasons. */

import type { SchemaAST } from "@bakorin/core";
import type { Actor } from "../context.ts";
import type { BakorinDb } from "../db/dialects.ts";
import type { ChangeBus } from "../bus.ts";
import type { RealtimeBroker } from "./broker.ts";
import type { RealtimeRow } from "./log.ts";

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

export interface Subscriber {
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
