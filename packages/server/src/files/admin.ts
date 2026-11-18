import { Hono } from "hono";
import { sql } from "kysely";
import { requireAdmin } from "../auth/guard.ts";
import { writeAudit } from "../audit/log.ts";
import { FILES_TABLE } from "../db/system.ts";
import { likeEscape } from "../db/ddl.ts";
import { clientIp } from "../http/client-ip.ts";
import type { AppContext } from "../context.ts";
import { fileInfo, fileSources, fileUsage, orphanCondition, signedFile, type FileSource } from "./refs.ts";

/** Files uploaded in the last hour may still be waiting for their record to be saved. */
export const ORPHAN_GRACE_MINUTES = 60;
const MAX_BULK_DELETE = 1000;

type FileType = "image" | "pdf" | "text" | "other";

function typeCondition(type: FileType) {
  switch (type) {
    case "image":
      return sql<boolean>`content_type like 'image/%'`;
    case "pdf":
      return sql<boolean>`content_type = 'application/pdf'`;
    case "text":
      return sql<boolean>`content_type like 'text/%'`;
    case "other":
      return sql<boolean>`content_type not like 'image/%' and content_type <> 'application/pdf' and content_type not like 'text/%'`;
  }
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function dayStart(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : null;
}

function dayAfter(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

const SORTS: Record<string, [string, "asc" | "desc"]> = {
  createdAt: ["created_at", "asc"],
  "-createdAt": ["created_at", "desc"],
  size: ["size", "asc"],
  "-size": ["size", "desc"],
  filename: ["filename", "asc"],
  "-filename": ["filename", "desc"],
};

function recentCutoff(minutes = ORPHAN_GRACE_MINUTES): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function deleteOne(ctx: AppContext, row: Record<string, unknown>): Promise<void> {
  await ctx.files.delete(String(row.key)).catch(() => undefined);
  await ctx.db.deleteFrom(FILES_TABLE).where("id", "=", String(row.id)).execute();
}

export function createFileAdminRoutes(): Hono {
  const app = new Hono();

  /** Every upload, with search, filters, and the records that use each file. */
  app.get("/", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const search = new URL(c.req.url).searchParams;
    const sources = await fileSources(ctx.db, ctx.ast);
    const orphan = orphanCondition(sources, ctx.ast.runtime.dialect);
    const limit = intParam(search.get("limit"), 50, 1, 100);
    const offset = intParam(search.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const type = search.get("type");
    const status = search.get("status");
    const q = search.get("q")?.trim();
    const minSize = search.get("minSize");
    const maxSize = search.get("maxSize");
    const from = dayStart(search.get("from"));
    const to = dayAfter(search.get("to"));
    const ids = (search.get("ids") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 100);

    let qb = ctx.db.selectFrom(FILES_TABLE);
    if (ids.length > 0) {
      qb = qb.where("id", "in", ids);
    }
    if (q) {
      qb = qb.where(sql<boolean>`lower(filename) like ${`%${escapeLike(q.toLowerCase())}%`} ${likeEscape(ctx.ast.runtime.dialect)}`);
    }
    if (type === "image" || type === "pdf" || type === "text" || type === "other") {
      qb = qb.where(typeCondition(type));
    }
    if (minSize && Number.isFinite(Number(minSize))) {
      qb = qb.where("size", ">=", Number(minSize));
    }
    if (maxSize && Number.isFinite(Number(maxSize))) {
      qb = qb.where("size", "<=", Number(maxSize));
    }
    if (from) {
      qb = qb.where("created_at", ">=", from);
    }
    if (to) {
      qb = qb.where("created_at", "<", to);
    }
    if (status === "orphaned") {
      qb = qb.where(orphan);
    } else if (status === "used") {
      qb = qb.where(sql<boolean>`not ${orphan}`);
    }
    const [sortColumn, sortDir] = SORTS[search.get("sort") ?? "-createdAt"] ?? SORTS["-createdAt"]!;
    const totalRow = await qb.select((eb) => eb.fn.countAll().as("count")).executeTakeFirst();
    const rows = await qb
      .selectAll()
      .orderBy(sortColumn as "created_at", sortDir)
      .orderBy("id", "asc")
      .limit(limit)
      .offset(offset)
      .execute();
    const usage = await fileUsage(
      ctx.db,
      ctx.ast,
      sources,
      rows.map((row) => String(row.id)),
    );
    const cutoff = recentCutoff();
    const data = rows.map((row) => {
      const info = fileInfo(row as Record<string, unknown>);
      const usedBy = usage.get(info.id) ?? [];
      return {
        ...signedFile(ctx.ast, info),
        usedBy,
        orphaned: usedBy.length === 0,
        recent: info.createdAt > cutoff,
      };
    });
    const summary = await summarize(ctx, sources);
    return c.json({
      data,
      meta: { total: Number(totalRow?.count ?? 0), limit, offset, graceMinutes: ORPHAN_GRACE_MINUTES, ...summary },
    });
  });

  /** Deletes one file that no record uses. Files still in use answer 409 with their records. */
  app.delete("/:id", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const id = c.req.param("id");
    const row = await ctx.db.selectFrom(FILES_TABLE).selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) {
      return c.json({ error: { code: "not_found", message: "file not found" } }, 404);
    }
    const sources = await fileSources(ctx.db, ctx.ast);
    const usedBy = (await fileUsage(ctx.db, ctx.ast, sources, [id])).get(id) ?? [];
    if (usedBy.length > 0) {
      return c.json(
        {
          error: {
            code: "conflict",
            message: "This file is still used by a record. Remove it from the record first.",
            usedBy,
          },
        },
        409,
      );
    }
    await deleteOne(ctx, row as Record<string, unknown>);
    const actor = c.get("actor");
    await writeAudit(ctx.db, {
      action: "file_delete",
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      entity: "files",
      recordId: id,
      ip: clientIp(c),
      meta: { filename: String(row.filename), contentType: String(row.content_type), size: Number(row.size) },
    });
    return c.json({ data: { id, deleted: true } });
  });

  /**
   * Deletes every file no record uses, except uploads from the last hour (they may
   * belong to a form that is still open). One audit entry per file.
   */
  app.post("/orphans/delete", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const sources = await fileSources(ctx.db, ctx.ast);
    const rows = await ctx.db
      .selectFrom(FILES_TABLE)
      .selectAll()
      .where(orphanCondition(sources, ctx.ast.runtime.dialect))
      .where("created_at", "<=", recentCutoff())
      .orderBy("created_at", "asc")
      .limit(MAX_BULK_DELETE)
      .execute();
    const actor = c.get("actor");
    const ip = clientIp(c);
    let bytes = 0;
    for (const row of rows) {
      await deleteOne(ctx, row as Record<string, unknown>);
      bytes += Number(row.size);
      await writeAudit(ctx.db, {
        action: "file_delete",
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        entity: "files",
        recordId: String(row.id),
        ip,
        meta: { filename: String(row.filename), contentType: String(row.content_type), size: Number(row.size), bulk: true },
      });
    }
    const summary = await summarize(ctx, sources);
    return c.json({ data: { deleted: rows.length, deletedBytes: bytes, ...summary } });
  });

  return app;
}

async function summarize(ctx: AppContext, sources: FileSource[]) {
  const all = await ctx.db
    .selectFrom(FILES_TABLE)
    .select((eb) => [eb.fn.countAll().as("count"), eb.fn.sum("size").as("bytes")])
    .executeTakeFirst();
  const orphans = await ctx.db
    .selectFrom(FILES_TABLE)
    .where(orphanCondition(sources, ctx.ast.runtime.dialect))
    .select((eb) => [eb.fn.countAll().as("count"), eb.fn.sum("size").as("bytes")])
    .executeTakeFirst();
  const removable = await ctx.db
    .selectFrom(FILES_TABLE)
    .where(orphanCondition(sources, ctx.ast.runtime.dialect))
    .where("created_at", "<=", recentCutoff())
    .select((eb) => eb.fn.countAll().as("count"))
    .executeTakeFirst();
  return {
    files: Number(all?.count ?? 0),
    bytes: Number(all?.bytes ?? 0),
    orphaned: Number(orphans?.count ?? 0),
    orphanedBytes: Number(orphans?.bytes ?? 0),
    removable: Number(removable?.count ?? 0),
  };
}
