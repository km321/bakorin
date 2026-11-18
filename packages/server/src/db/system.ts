import { sql } from "kysely";
import type { DialectName } from "@bakorin/core";
import type { BakorinDb } from "./dialects.ts";
import { bigIntType, createIndex, keyTextType, longTextType, tableColumnNames, tableOptions } from "./ddl.ts";

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
export const MAIL_OUTBOX_TABLE = "_bakorin_mail_outbox";
export const JOB_RUNS_TABLE = "_bakorin_job_runs";
export const TOKEN_CUTOFF_TABLE = "_bakorin_token_cutoffs";
/** Short lived log of changes on realtime entities: ids for resume, and the fan out source. */
export const REALTIME_TABLE = "_bakorin_realtime";

export async function ensureSystemTables(db: BakorinDb, dialect: DialectName): Promise<void> {
  // key: primary keys, unique and indexed columns (varchar(255) on MySQL).
  // text: everything else (longtext on MySQL). Both are plain text elsewhere.
  const key = keyTextType(dialect);
  const text = longTextType(dialect);
  const int = bigIntType(dialect);
  const opts = tableOptions(dialect);
  await sql
    .raw(
      `create table if not exists ${META_TABLE} (
        "key" ${key} primary key,
        value ${text} not null
      )${opts}`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${REFRESH_TABLE} (
        id ${key} primary key,
        user_id ${key} not null,
        token_hash ${key} not null unique,
        family_id ${key} not null,
        revoked_at ${key},
        expires_at ${key} not null,
        created_at ${key} not null
      )${opts}`,
    )
    .execute(db);
  await createIndex(db, dialect, { name: "_bakorin_refresh_user_idx", table: REFRESH_TABLE, columns: ["user_id"] });
  await sql
    .raw(
      `create table if not exists ${TOKEN_CUTOFF_TABLE} (
        user_id ${key} primary key,
        not_before ${int} not null
      )${opts}`,
    )
    .execute(db);
  const refreshColumns = await tableColumns(db, dialect, REFRESH_TABLE);
  for (const column of ["rotated_at", "successor"]) {
    if (!refreshColumns.has(column)) {
      await sql.raw(`alter table ${REFRESH_TABLE} add column ${column} ${key}`).execute(db);
    }
  }
  await sql
    .raw(
      `create table if not exists ${AUTH_TOKENS_TABLE} (
        id ${key} primary key,
        user_id ${key},
        email ${key} not null,
        purpose ${key} not null,
        token_hash ${key} not null unique,
        payload ${text},
        expires_at ${key} not null,
        used_at ${key},
        created_at ${key} not null
      )${opts}`,
    )
    .execute(db);
  await createIndex(db, dialect, { name: "_bakorin_auth_tokens_email_idx", table: AUTH_TOKENS_TABLE, columns: ["email"] });
  await sql
    .raw(
      `create table if not exists ${FILES_TABLE} (
        id ${key} primary key,
        "key" ${key} not null,
        filename ${text} not null,
        content_type ${key} not null,
        size ${int} not null,
        created_by ${key},
        created_at ${key} not null
      )${opts}`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${DEPRECATED_TABLE} (
        kind ${key} not null,
        entity ${key} not null,
        field ${key},
        dropped_at ${key} not null
      )${opts}`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${RATE_TABLE} (
        "key" ${key} primary key,
        count ${int} not null,
        window_start ${key} not null
      )${opts}`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${LOCKOUT_TABLE} (
        identity ${key} primary key,
        failures ${int} not null,
        locked_until ${key},
        updated_at ${key} not null
      )${opts}`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${LEASE_TABLE} (
        name ${key} primary key,
        holder ${key} not null,
        expires_at ${key} not null
      )${opts}`,
    )
    .execute(db);
  await sql
    .raw(
      `create table if not exists ${AUDIT_TABLE} (
        id ${key} primary key,
        at ${key} not null,
        action ${key} not null,
        actor_id ${key},
        actor_role ${key},
        entity ${key},
        record_id ${key},
        ip ${key},
        meta ${text}
      )${opts}`,
    )
    .execute(db);
  await createIndex(db, dialect, { name: "_bakorin_audit_at_idx", table: AUDIT_TABLE, columns: ["at"] });
  const seq =
    dialect === "postgres"
      ? "bigserial primary key"
      : dialect === "mysql"
        ? "bigint not null auto_increment primary key"
        : "integer primary key autoincrement";
  await sql
    .raw(
      `create table if not exists ${REALTIME_TABLE} (
        seq ${seq},
        entity ${key} not null,
        op ${key} not null,
        record_id ${key} not null,
        data ${text} not null,
        at ${int} not null
      )${opts}`,
    )
    .execute(db);
  await createIndex(db, dialect, { name: "_bakorin_realtime_at_idx", table: REALTIME_TABLE, columns: ["at"] });
  await sql
    .raw(
      `create table if not exists ${WEBHOOK_OUTBOX_TABLE} (
        id ${key} primary key,
        webhook_id ${key},
        event ${key},
        url ${text} not null,
        payload ${text} not null,
        headers ${text} not null,
        attempts ${int} not null,
        status ${key} not null default 'pending',
        last_status_code ${int},
        last_error ${text},
        locked_until ${key},
        next_attempt_at ${key} not null,
        delivered_at ${key},
        created_at ${key} not null
      )${opts}`,
    )
    .execute(db);
  await ensureOutboxColumns(db, dialect, int, key, text);
  await sql
    .raw(
      `update ${WEBHOOK_OUTBOX_TABLE} set status = 'delivered' where delivered_at is not null and (status is null or status = 'pending')`,
    )
    .execute(db);
  await createIndex(db, dialect, { name: "_bakorin_webhook_outbox_due_idx", table: WEBHOOK_OUTBOX_TABLE, columns: ["status", "next_attempt_at"] });
  await sql
    .raw(
      `create table if not exists ${MAIL_OUTBOX_TABLE} (
        id ${key} primary key,
        idempotency_key ${key} not null,
        source ${key} not null,
        rule_id ${key},
        template ${key},
        entity ${key},
        record_id ${key},
        event ${key},
        to_addrs ${text} not null,
        cc_addrs ${text} not null,
        bcc_addrs ${text} not null,
        reply_to ${text},
        subject ${text} not null,
        html ${text} not null,
        body_text ${text} not null,
        attempts ${int} not null,
        max_attempts ${int} not null,
        status ${key} not null default 'pending',
        last_error ${text},
        locked_until ${key},
        next_attempt_at ${key} not null,
        sent_at ${key},
        created_at ${key} not null,
        purpose ${key},
        sealed ${text}
      )${opts}`,
    )
    .execute(db);
  const mailColumns = await tableColumns(db, dialect, MAIL_OUTBOX_TABLE);
  for (const column of ["purpose", "sealed"]) {
    if (!mailColumns.has(column)) {
      await sql.raw(`alter table ${MAIL_OUTBOX_TABLE} add column ${column} ${column === "sealed" ? text : key}`).execute(db);
    }
  }
  await createIndex(db, dialect, { name: "_bakorin_mail_outbox_key_idx", table: MAIL_OUTBOX_TABLE, columns: ["idempotency_key"], unique: true });
  await createIndex(db, dialect, { name: "_bakorin_mail_outbox_due_idx", table: MAIL_OUTBOX_TABLE, columns: ["status", "next_attempt_at"] });
  await sql
    .raw(
      `create table if not exists ${JOB_RUNS_TABLE} (
        id ${key} primary key,
        job_name ${key} not null,
        handler ${key} not null,
        "trigger" ${key} not null,
        status ${key} not null,
        dry_run ${int} not null default 0,
        scheduled_for ${key},
        started_at ${key} not null,
        finished_at ${key},
        duration_ms ${int},
        message ${text},
        log ${text},
        data ${text},
        actor_id ${key}
      )${opts}`,
    )
    .execute(db);
  await createIndex(db, dialect, { name: "_bakorin_job_runs_slot_idx", table: JOB_RUNS_TABLE, columns: ["job_name", "scheduled_for"], unique: true });
  await createIndex(db, dialect, { name: "_bakorin_job_runs_started_idx", table: JOB_RUNS_TABLE, columns: ["started_at"] });
  await createIndex(db, dialect, { name: "_bakorin_job_runs_job_idx", table: JOB_RUNS_TABLE, columns: ["job_name", "started_at"] });
}

async function tableColumns(db: BakorinDb, dialect: DialectName, table: string): Promise<Set<string>> {
  if (dialect === "postgres") {
    const result = await sql<{ name: string }>`
      select column_name as name from information_schema.columns where table_name = ${table}
    `.execute(db);
    return new Set(result.rows.map((row) => row.name));
  }
  return tableColumnNames(db, dialect, table);
}

async function ensureOutboxColumns(db: BakorinDb, dialect: DialectName, int: string, key: string, text: string): Promise<void> {
  const existing = await tableColumns(db, dialect, WEBHOOK_OUTBOX_TABLE);
  const additions: Array<{ name: string; sql: string }> = [
    { name: "webhook_id", sql: `${key}` },
    { name: "event", sql: `${key}` },
    { name: "status", sql: `${key} not null default 'pending'` },
    { name: "last_status_code", sql: int },
    { name: "last_error", sql: text },
  ];
  for (const column of additions) {
    if (existing.has(column.name)) {
      continue;
    }
    await sql.raw(`alter table ${WEBHOOK_OUTBOX_TABLE} add column ${column.name} ${column.sql}`).execute(db);
  }
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
