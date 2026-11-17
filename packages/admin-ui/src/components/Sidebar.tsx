import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { MetaEntity } from "../lib/api.ts";
import { filterNav, NAV_FILTER_MIN, navGroups, navMark, readCollapsed, writeCollapsed } from "../lib/nav.ts";
import { Brand } from "./Brand.tsx";
import { IconAudit, IconBackup, IconChevron, IconDocs, IconFiles, IconJobs, IconMail, IconSchema, IconStatus, IconWebhook } from "./Icons.tsx";
import type { AdminPage } from "../pages/ProjectScreen.tsx";

type ProjectPage = Exclude<AdminPage, "records">;

const PROJECT_PAGES: Array<{ page: ProjectPage; label: string; icon: () => ComponentChildren }> = [
  { page: "status", label: "Status", icon: IconStatus },
  { page: "files", label: "Files", icon: IconFiles },
  { page: "backups", label: "Backups", icon: IconBackup },
  { page: "schema", label: "Schema", icon: IconSchema },
  { page: "webhooks", label: "Webhooks", icon: IconWebhook },
  { page: "mail", label: "Mail", icon: IconMail },
  { page: "jobs", label: "Jobs", icon: IconJobs },
  { page: "audit", label: "Audit", icon: IconAudit },
];

/**
 * The admin navigation. The brand stays at the top and API docs at the bottom; the
 * list between them scrolls on its own. Data lists entities in their app.yaml admin
 * groups (collapsible, remembered per app), with a filter box when there are many.
 */
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
  onOpenPage: (page: ProjectPage) => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(appName));
  const scroller = useRef<HTMLElement>(null);
  const groups = useMemo(() => navGroups(entities), [entities]);
  const shown = useMemo(() => filterNav(groups, query), [groups, query]);
  const count = groups.reduce((sum, block) => sum + block.items.length, 0);
  const filtering = query.trim() !== "";
  const activeEntity = page === "records" ? entityName : "";

  // The app name arrives with the schema; read that app's saved groups then.
  useEffect(() => setCollapsed(readCollapsed(appName)), [appName]);

  // Keep the current item visible in the scrolling list.
  useEffect(() => {
    const active = scroller.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView?.({ block: "nearest" });
  }, [page, entityName, open, groups]);

  function toggle(group: string) {
    const next = new Set(collapsed);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setCollapsed(next);
    writeCollapsed(appName, next);
  }

  const entityButton = (item: MetaEntity) => (
    <button
      key={item.name}
      data-nav={item.name}
      class={item.name === activeEntity ? "active" : ""}
      aria-current={item.name === activeEntity ? "page" : undefined}
      onClick={() => onOpenEntity(item.name)}
    >
      <span class="nav-mark" aria-hidden="true">
        {navMark(item)}
      </span>
      <span class="nav-label">{item.plural}</span>
    </button>
  );

  return (
    <aside class={open ? "sidebar open" : "sidebar"} id="app-sidebar">
      <Brand sub={appName ?? "loading"} />
      <nav class="nav nav-scroll" aria-label="Entities" ref={scroller}>
        <div class="nav-section">Data</div>
        {count > NAV_FILTER_MIN ? (
          <div class="nav-filter">
            <label class="sr-only" for="nav-filter">
              Filter data types
            </label>
            <input
              id="nav-filter"
              type="search"
              placeholder={`Filter ${count} types`}
              autocomplete="off"
              spellcheck={false}
              value={query}
              onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
                if (event.key === "Enter" && shown[0]?.items[0]) onOpenEntity(shown[0].items[0].name);
              }}
            />
          </div>
        ) : null}
        {shown.map((block) =>
          block.group === null ? (
            <div class="nav-list" key="__ungrouped">
              {block.items.map(entityButton)}
            </div>
          ) : (
            <NavGroupBlock
              key={block.group}
              group={block.group}
              // Filtering shows every match; the current item's group never hides it.
              collapsed={collapsed.has(block.group) && !filtering && !block.items.some((item) => item.name === activeEntity)}
              onToggle={() => toggle(block.group!)}
            >
              {block.items.map(entityButton)}
            </NavGroupBlock>
          ),
        )}
        {filtering && shown.length === 0 ? (
          <p class="nav-empty" role="status">
            No data types match
          </p>
        ) : null}
        <div class="nav-section">Project</div>
        {PROJECT_PAGES.map(({ page: target, label, icon: Icon }) => (
          <button
            key={target}
            data-nav={target}
            class={page === target ? "active" : ""}
            aria-current={page === target ? "page" : undefined}
            onClick={() => onOpenPage(target)}
          >
            <span class="nav-icon">
              <Icon />
            </span>
            {label}
          </button>
        ))}
      </nav>
      <div class="sidebar-footer nav">
        <a data-nav="docs" href="/docs" target="_blank" rel="noreferrer">
          <span class="nav-icon">
            <IconDocs />
          </span>
          API docs
        </a>
      </div>
    </aside>
  );
}

function NavGroupBlock({ group, collapsed, onToggle, children }: { group: string; collapsed: boolean; onToggle: () => void; children: ComponentChildren }) {
  const id = `nav-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div class="nav-group" data-group={group}>
      <button type="button" class="nav-group-toggle" aria-expanded={!collapsed} aria-controls={id} onClick={onToggle}>
        <span class={collapsed ? "nav-chevron" : "nav-chevron open"} aria-hidden="true">
          <IconChevron />
        </span>
        <span class="nav-group-name">{group}</span>
      </button>
      <div class="nav-list" id={id} hidden={collapsed}>
        {children}
      </div>
    </div>
  );
}
