import type { BakorinHooks } from "@bakorin/server";

const hooks: BakorinHooks = {
  entities: {
    leads: {
      beforeCreate({ record, actor }) {
        if (actor && !record.ownerId) {
          record.ownerId = actor.id;
        }
        return record;
      },
    },
    tasks: {
      beforeCreate({ record, actor }) {
        if (actor && !record.ownerId) {
          record.ownerId = actor.id;
        }
        return record;
      },
    },
  },
  // jobs: {
  //   async refresh_stats(ctx) {
  //     if (ctx.dryRun) return { ok: true, message: "dry run" };
  //     return { ok: true };
  //   },
  // },
};

export default hooks;
