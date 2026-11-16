import type { Projects, Updates } from "./bakorin.gen.ts";

export type Project = Projects;
export type Update = Updates;

/** Roles from app.yaml. Managers and admins can edit and delete any project. */
export const MANAGERS = ["manager", "admin"];
export const PROJECT_FIELDS = ["name", "status", "dueOn", "notes"];
export const STATUSES = ["planned", "active", "paused", "done"] as const;
