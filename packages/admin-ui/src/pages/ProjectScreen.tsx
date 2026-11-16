import type { MetaResponse } from "../lib/api.ts";
import { Audit } from "./Audit.tsx";
import { Backups } from "./Backups.tsx";
import { Mail } from "./Mail.tsx";
import { Schema } from "./Schema.tsx";
import { Status } from "./Status.tsx";
import { Webhooks } from "./Webhooks.tsx";

export type AdminPage = "records" | "status" | "backups" | "audit" | "webhooks" | "mail" | "schema";

export function pageFromHash(hash: string): AdminPage {
  switch (hash) {
    case "#status":
      return "status";
    case "#backups":
      return "backups";
    case "#audit":
      return "audit";
    case "#webhooks":
      return "webhooks";
    case "#mail":
      return "mail";
    case "#schema":
      return "schema";
    default:
      return "records";
  }
}

/** The project screens reached from the sidebar. */
export function ProjectScreen({
  page,
  meta,
  onOpenEntity,
}: {
  page: Exclude<AdminPage, "records">;
  meta: MetaResponse | null;
  onOpenEntity: (name: string) => void;
}) {
  switch (page) {
    case "status":
      return <Status />;
    case "backups":
      return <Backups />;
    case "webhooks":
      return <Webhooks />;
    case "mail":
      return <Mail meta={meta} />;
    case "schema":
      return <Schema initial={meta} onOpenEntity={onOpenEntity} />;
    case "audit":
      return <Audit />;
    default: {
      const exhaustive: never = page;
      return exhaustive;
    }
  }
}
