import type { MetaEntity } from "../lib/api.ts";
import { initials } from "../lib/format.ts";
import { Brand } from "./Brand.tsx";
import { IconAudit, IconBackup, IconDocs, IconFiles, IconMail, IconSchema, IconStatus, IconWebhook } from "./Icons.tsx";
import type { AdminPage } from "../pages/ProjectScreen.tsx";

/** The admin navigation: one entry per entity, then the project screens. */
export function Sidebar({
  appName,
  entities,
  page,
  entityName,
  open,
  onOpenEntity,
  onOpenPage,
}: {
  appName: string | undefined;
  entities: MetaEntity[];
  page: AdminPage;
  entityName: string;
  open: boolean;
  onOpenEntity: (name: string) => void;
  onOpenPage: (page: Exclude<AdminPage, "records">) => void;
}) {
  return (
    <aside class={open ? "sidebar open" : "sidebar"} id="app-sidebar">
      <Brand sub={appName ?? "loading"} />
      <nav class="nav" aria-label="Entities">
        <div class="nav-section">Data</div>
        {entities.map((item) => (
          <button
            key={item.name}
            data-nav={item.name}
            class={page === "records" && item.name === entityName ? "active" : ""}
            aria-current={page === "records" && item.name === entityName ? "page" : undefined}
            onClick={() => onOpenEntity(item.name)}
          >
            <span class="nav-mark">{initials(item.plural)}</span>
            {item.plural}
          </button>
        ))}
        <div class="nav-section">Project</div>
        <button
          data-nav="status"
          class={page === "status" ? "active" : ""}
          aria-current={page === "status" ? "page" : undefined}
          onClick={() => onOpenPage("status")}
        >
          <span class="nav-icon">
            <IconStatus />
          </span>
          Status
        </button>
        <button
          data-nav="files"
          class={page === "files" ? "active" : ""}
          aria-current={page === "files" ? "page" : undefined}
          onClick={() => onOpenPage("files")}
        >
          <span class="nav-icon">
            <IconFiles />
          </span>
          Files
        </button>
        <button
          data-nav="backups"
          class={page === "backups" ? "active" : ""}
          aria-current={page === "backups" ? "page" : undefined}
          onClick={() => onOpenPage("backups")}
        >
          <span class="nav-icon">
            <IconBackup />
          </span>
          Backups
        </button>
        <button
          data-nav="schema"
          class={page === "schema" ? "active" : ""}
          aria-current={page === "schema" ? "page" : undefined}
          onClick={() => onOpenPage("schema")}
        >
          <span class="nav-icon">
            <IconSchema />
          </span>
          Schema
        </button>
        <button
          data-nav="webhooks"
          class={page === "webhooks" ? "active" : ""}
          aria-current={page === "webhooks" ? "page" : undefined}
          onClick={() => onOpenPage("webhooks")}
        >
          <span class="nav-icon">
            <IconWebhook />
          </span>
          Webhooks
        </button>
        <button
          data-nav="mail"
          class={page === "mail" ? "active" : ""}
          aria-current={page === "mail" ? "page" : undefined}
          onClick={() => onOpenPage("mail")}
        >
          <span class="nav-icon">
            <IconMail />
          </span>
          Mail
        </button>
        <button
          data-nav="audit"
          class={page === "audit" ? "active" : ""}
          aria-current={page === "audit" ? "page" : undefined}
          onClick={() => onOpenPage("audit")}
        >
          <span class="nav-icon">
            <IconAudit />
          </span>
          Audit
        </button>
        <a data-nav="docs" href="/docs" target="_blank" rel="noreferrer">
          <span class="nav-icon">
            <IconDocs />
          </span>
          API docs
        </a>
      </nav>
    </aside>
  );
}
