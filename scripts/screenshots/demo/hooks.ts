import type { BakorinHooks } from "@bakorin/server";

function isDone(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

const hooks: BakorinHooks = {
  jobs: {
    async daily_digest(ctx) {
      const rows = await ctx.db.selectFrom("tasks").selectAll().execute();
      const open = rows.filter((row) => !isDone(row.done)).length;
      ctx.log(`${open} open task${open === 1 ? "" : "s"}`);
      if (ctx.dryRun) {
        return { ok: true, message: "dry run" };
      }
      return { ok: true, message: `${open} open tasks` };
    },
  },
};

export default hooks;
