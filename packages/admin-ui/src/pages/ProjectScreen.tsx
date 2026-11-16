import type { MetaResponse } from "../lib/api.ts";
import { Audit } from "./Audit.tsx";
import { Backups } from "./Backups.tsx";
import { Files } from "./Files.tsx";
import { Jobs } from "./Jobs.tsx";
import { Mail } from "./Mail.tsx";
import { Schema } from "./Schema.tsx";
import { Status } from "./Status.tsx";
import { Webhooks } from "./Webhooks.tsx";

export type AdminPage = "records" | "status" | "files" | "backups" | "audit" | "webhooks" | "mail" | "jobs" | "schema";

export function pageFromHash(hash: string): AdminPage {
  switch (hash) {
    case "#status":
      return "status";
    case "#files":
      return "files";
    case "#backups":
      return "backups";
    case "#audit":
      return "audit";
    case "#webhooks":
      return "webhooks";
    case "#mail":
      return "mail";
    case "#jobs":
      return "jobs";
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
    case "files":
      return <Files meta={meta} />;
    case "backups":
      return <Backups />;
    case "webhooks":
      return <Webhooks />;
    case "mail":
      return <Mail meta={meta} />;
    case "jobs":
      return <Jobs />;
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
