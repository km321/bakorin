import { sql } from "kysely";
import type { DialectName } from "@bakorin/core";
import type { BakorinDb } from "./dialects.ts";

export const META_TABLE = "_bakorin_meta";
export const REFRESH_TABLE = "_bakorin_refresh_tokens";
export const AUTH_TOKENS_TABLE = "_bakorin_auth_tokens";
export const FILES_TABLE = "_bakorin_files";
export const DEPRECATED_TABLE = "_bakorin_deprecated";
export const RATE_TABLE = "_bakorin_rate_limits";
export const LOCKOUT_TABLE = "_bakorin_lockouts";
export const LEASE_TABLE = "_bakorin_leases";
export const AUDIT_TABLE = "_bakorin_audit";
export const WEBHOOK_OUTBOX_TABLE = "_bakorin_webhook_outbox";

export async function ensureSystemTables(db: BakorinDb, dialect: DialectName): Promise<void> {
  const text = "text";
  const int = dialect === "postgres" ? "bigint" : "integer";
  await sql
    .raw(
      `create table if not exists ${META_TABLE} (
        key ${text} primary key,
        value ${text} not null
      )`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${REFRESH_TABLE} (
        id ${text} primary key,
        user_id ${text} not null,
        token_hash ${text} not null unique,
        family_id ${text} not null,
        revoked_at ${text},
        expires_at ${text} not null,
        created_at ${text} not null
      )`,
    )
    .execute(db);
  await sql
    .raw(`create index if not exists _bakorin_refresh_user_idx on ${REFRESH_TABLE} (user_id)`)
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${AUTH_TOKENS_TABLE} (
        id ${text} primary key,
        user_id ${text},
        email ${text} not null,
        purpose ${text} not null,
        token_hash ${text} not null unique,
        payload ${text},
        expires_at ${text} not null,
        used_at ${text},
        created_at ${text} not null
      )`,
    )
    .execute(db);
  await sql
    .raw(`create index if not exists _bakorin_auth_tokens_email_idx on ${AUTH_TOKENS_TABLE} (email)`)
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${FILES_TABLE} (
        id ${text} primary key,
        key ${text} not null,
        filename ${text} not null,
        content_type ${text} not null,
        size ${int} not null,
        created_by ${text},
        created_at ${text} not null
      )`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${DEPRECATED_TABLE} (
        kind ${text} not null,
        entity ${text} not null,
        field ${text},
        dropped_at ${text} not null
      )`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${RATE_TABLE} (
        key ${text} primary key,
        count ${int} not null,
        window_start ${text} not null
      )`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${LOCKOUT_TABLE} (
        identity ${text} primary key,
        failures ${int} not null,
        locked_until ${text},
        updated_at ${text} not null
      )`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${LEASE_TABLE} (
        name ${text} primary key,
        holder ${text} not null,
        expires_at ${text} not null
      )`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${AUDIT_TABLE} (
        id ${text} primary key,
        at ${text} not null,
        action ${text} not null,
        actor_id ${text},
        actor_role ${text},
        entity ${text},
        record_id ${text},
        ip ${text},
        meta ${text}
      )`,
    )
    .execute(db);
  await sql
    .raw(`create index if not exists _bakorin_audit_at_idx on ${AUDIT_TABLE} (at)`)
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${WEBHOOK_OUTBOX_TABLE} (
        id ${text} primary key,
        url ${text} not null,
        payload ${text} not null,
        headers ${text} not null,
        attempts ${int} not null,
        locked_until ${text},
        next_attempt_at ${text} not null,
        delivered_at ${text},
        created_at ${text} not null
      )`,
    )
    .execute(db);
}

export async function metaGet(db: BakorinDb, key: string): Promise<string | null> {
  const row = await db.selectFrom(META_TABLE).select("value").where("key", "=", key).executeTakeFirst();
  return (row?.value as string | undefined) ?? null;
}

export async function metaSet(db: BakorinDb, key: string, value: string): Promise<void> {
  const existing = await metaGet(db, key);
  if (existing === null) {
    await db.insertInto(META_TABLE).values({ key, value }).execute();
    return;
  }
  await db.updateTable(META_TABLE).set({ value }).where("key", "=", key).execute();
}
