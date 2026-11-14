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
};

export default hooks;
