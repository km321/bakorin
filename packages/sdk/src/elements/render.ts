/**
 * HTML strings for the Astro components. The .astro wrappers render these on the
 * server and the custom elements re-render parts of them in the browser, so both
 * produce the same markup and classes as the React components.
 */
import { formatValue } from "../headless/format.ts";
import { inputValue, type FieldErrors, type FormValues } from "../headless/form.ts";
import { pageInfo, type CollectionState } from "../headless/collection.ts";
import { columnFields, fieldLabel, type EntitySchema, type FieldSchema } from "../headless/schema.ts";
import { formatBytes } from "../headless/upload.ts";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const attr = (name: string, value: unknown) =>
  value === undefined || value === null || value === false ? "" : value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;

const INPUT_TYPES: Partial<Record<FieldSchema["type"], string>> = {
  email: "email",
  password: "password",
  number: "number",
  integer: "number",
  date: "date",
  datetime: "datetime-local",
};

export interface RenderFieldOptions {
  idPrefix: string;
  value?: unknown;
  error?: string;
  label?: string;
  hint?: string;
  autocomplete?: string;
  options?: { value: string; label: string }[];
  /** File fields: accepted types for the picker. */
  accept?: string;
}

export function renderField(field: FieldSchema, options: RenderFieldOptions): string {
  const base = `${options.idPrefix}-${field.name}`;
  const inputId = `${base}-input`;
  const hint = options.hint ?? field.description;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = `${base}-error`;
  const describedBy = [hintId, options.error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  const common = `${attr("id", inputId)}${attr("name", field.name)}${attr("aria-invalid", options.error ? "true" : undefined)}${attr("aria-describedby", describedBy)}`;
  const boolean = field.type === "boolean";
  let control: string;
  if (boolean) {
    control = `<input${common} class="bk-checkbox" type="checkbox" value="true"${attr("checked", options.value === true)}>`;
  } else if (field.type === "enum" || (field.relation && options.options)) {
    const choices = field.type === "enum" ? (field.enumValues ?? []).map((v) => ({ value: v, label: v })) : (options.options ?? []);
    const many = Boolean(field.relation?.many);
    const selected = new Set(many ? ((options.value as string[] | undefined) ?? []) : [inputValue(field, options.value)]);
    control = `<select${common} class="bk-input bk-select"${attr("required", field.required)}${attr("multiple", many)}>${
      many ? "" : `<option value="">${field.required ? "Choose one" : "None"}</option>`
    }${choices
      .map((choice) => `<option${attr("value", choice.value)}${attr("selected", selected.has(choice.value))}>${escapeHtml(choice.label)}</option>`)
      .join("")}</select>`;
  } else if ((field.multiline && field.type === "text") || field.type === "json" || field.type === "richtext") {
    const code = field.type === "json";
    control = `<textarea${common} class="bk-input bk-textarea${code ? " bk-textarea--code" : ""}" rows="6"${attr("spellcheck", code ? "false" : undefined)}${attr("required", field.required && field.defaultValue === undefined)}>${escapeHtml(
      inputValue(field, options.value),
    )}</textarea>`;
  } else if (field.type === "file") {
    control = renderDropzone({ idPrefix: base, inputId, describedBy, name: field.name, value: options.value, accept: options.accept });
  } else {
    const autocomplete = options.autocomplete ?? (field.type === "password" ? "new-password" : field.type === "email" ? "email" : undefined);
    control = `<input${common} class="bk-input"${attr("type", INPUT_TYPES[field.type] ?? "text")}${attr(
      "step",
      field.type === "integer" ? "1" : field.type === "number" ? "any" : undefined,
    )}${attr("required", field.required && field.defaultValue === undefined)}${attr("autocomplete", autocomplete)}${attr("value", inputValue(field, options.value))}>`;
  }
  const label = `<label class="bk-label" for="${escapeHtml(inputId)}">${escapeHtml(options.label ?? fieldLabel(field.name))}${
    field.required && !boolean ? '<span class="bk-required" aria-hidden="true"> *</span>' : ""
  }</label>`;
  return `<div class="bk-field${boolean ? " bk-field--check" : ""}${options.error ? " bk-field--invalid" : ""}" data-field="${escapeHtml(field.name)}">${
    boolean ? control + label : label + control
  }${hintId ? `<p class="bk-hint" id="${hintId}">${escapeHtml(hint)}</p>` : ""}<p class="bk-error" id="${errorId}"${attr(
    "hidden",
    !options.error,
  )}>${escapeHtml(options.error ?? "")}</p></div>`;
}

export function renderAlert(message: string | null | undefined, tone: "error" | "success" = "error"): string {
  return `<div class="bk-alert${message ? ` bk-alert--${tone}` : ""}" role="${tone === "error" ? "alert" : "status"}" data-bk-alert="${tone}">${escapeHtml(
    message ?? "",
  )}</div>`;
}

export interface RenderFormOptions {
  idPrefix: string;
  fields: readonly FieldSchema[];
  values?: FormValues;
  errors?: FieldErrors;
  formError?: string | null;
  success?: string | null;
  submitLabel: string;
  /** Where the form posts without JavaScript. Default: the same page. */
  action?: string;
  className: string;
  labels?: Record<string, string>;
  hints?: Record<string, string>;
  autocomplete?: Record<string, string>;
  relationOptions?: Record<string, { value: string; label: string }[]>;
  /** Text fields to show as multi line text areas. */
  multiline?: readonly string[];
  /** File fields: accepted types for the picker, for example "image/*". */
  accept?: Record<string, string>;
  /** Extra HTML after the button (links). Trusted: pass only your own markup. */
  footer?: string;
  /** Hidden inputs, for example _action or id. */
  hidden?: Record<string, string>;
}

export function renderForm(options: RenderFormOptions): string {
  const fields = options.fields
    .map((field) =>
      renderField(options.multiline?.includes(field.name) ? { ...field, multiline: true } : field, {
        idPrefix: options.idPrefix,
        // A create form starts from the schema defaults.
        value: options.values ? options.values[field.name] : field.defaultValue,
        error: options.errors?.[field.name],
        label: options.labels?.[field.name],
        hint: options.hints?.[field.name] ?? (field.type === "password" && field.minLength !== 0 ? `At least ${field.minLength ?? 8} characters.` : undefined),
        autocomplete: options.autocomplete?.[field.name],
        options: options.relationOptions?.[field.name],
        accept: options.accept?.[field.name],
      }),
    )
    .join("");
  const hidden = Object.entries(options.hidden ?? {})
    .map(([name, value]) => `<input type="hidden"${attr("name", name)}${attr("value", value)}>`)
    .join("");
  return `<form class="bk-form ${escapeHtml(options.className)}" method="post"${attr("action", options.action)} novalidate>${renderAlert(
    options.formError,
  )}${hidden}${fields}<div class="bk-actions"><button class="bk-button" type="submit" data-label="${escapeHtml(options.submitLabel)}">${escapeHtml(
    options.submitLabel,
  )}</button></div>${renderAlert(options.success, "success")}${options.footer ?? ""}</form>`;
}

export function signInFields(identityField = "email"): FieldSchema[] {
  return [
    { name: identityField, type: identityField === "email" ? "email" : "text", required: true },
    // Sign in does not enforce the 8 character rule: that is for new passwords.
    { name: "password", type: "password", required: true, minLength: 0 },
  ];
}

export interface DropzoneOptions {
  idPrefix: string;
  inputId?: string;
  describedBy?: string;
  /** Hidden input that holds the uploaded file id. */
  name?: string;
  value?: unknown;
  label?: string;
  accept?: string;
  maxBytes?: number;
  hint?: string;
  basePath?: string;
}

export function renderDropzone(options: DropzoneOptions): string {
  const inputId = options.inputId ?? `${options.idPrefix}-file`;
  const hintText = [options.hint, options.maxBytes ? `Up to ${formatBytes(options.maxBytes)}.` : ""].filter(Boolean).join(" ");
  const hintId = hintText ? `${options.idPrefix}-drop-hint` : undefined;
  const describedBy = [options.describedBy, hintId].filter(Boolean).join(" ") || undefined;
  return `<bakorin-file-upload class="bk-dropzone"${attr("data-base-path", options.basePath)}${attr("data-accept", options.accept)}${attr("data-max-bytes", options.maxBytes)}><input id="${escapeHtml(
    inputId,
  )}" class="bk-dropzone__input" type="file"${attr("accept", options.accept)}${attr("aria-describedby", describedBy)}><label class="bk-dropzone__label" for="${escapeHtml(
    inputId,
  )}"><span class="bk-dropzone__title">${escapeHtml(options.inputId ? "Choose a file" : (options.label ?? "Upload a file"))}</span><span class="bk-dropzone__subtitle">or drop it here</span></label>${
    hintId ? `<p class="bk-hint" id="${hintId}">${escapeHtml(hintText)}</p>` : ""
  }<div class="bk-progress-row" hidden><progress class="bk-progress" max="100" value="0" aria-label="Upload progress"></progress><span class="bk-progress__text" aria-hidden="true">0%</span></div><div role="status" class="bk-dropzone__status"></div>${renderAlert(
    null,
  )}${options.name ? `<input type="hidden"${attr("name", options.name)}${attr("value", options.value ?? "")}>` : ""}</bakorin-file-upload>`;
}

export interface TableConfig {
  entity: string;
  caption: string;
  hideCaption?: boolean;
  columns: { field: string; label: string; sortable: boolean; meta?: FieldSchema }[];
  display: string;
  toggle: string[];
  deletable: boolean;
  confirmDelete: string | null;
  emptyText: string;
  /** For links that work without JavaScript: ?page= and ?sort= on this path. */
  path?: string;
  /** Makes one column a link to the row's page. ":id" in href becomes the row id. */
  rowLink?: { field: string; href: string };
}

export function tableConfig(
  entity: string,
  schema: EntitySchema | undefined,
  options: {
    columns?: (string | { field: string; label?: string; sortable?: boolean })[];
    caption?: string;
    hideCaption?: boolean;
    toggle?: string[];
    deletable?: boolean;
    confirmDelete?: string | null;
    emptyText?: string;
    path?: string;
    rowLink?: { field: string; href: string };
  } = {},
): TableConfig {
  const columns = options.columns
    ? options.columns.map((column) => {
        const c = typeof column === "string" ? { field: column } : column;
        const meta = schema?.fields.find((field) => field.name === c.field);
        return { field: c.field, label: c.label ?? fieldLabel(c.field), sortable: c.sortable ?? Boolean(meta), meta };
      })
    : schema
      ? columnFields(schema).map((meta) => ({ field: meta.name, label: fieldLabel(meta.name), sortable: true, meta }))
      : [{ field: "id", label: "Id", sortable: false }];
  return {
    entity,
    caption: options.caption ?? fieldLabel(entity),
    hideCaption: options.hideCaption,
    columns,
    display: schema?.display ?? "id",
    toggle: options.toggle ?? [],
    deletable: Boolean(options.deletable),
    confirmDelete: options.confirmDelete === undefined ? "Delete this row?" : options.confirmDelete,
    emptyText: options.emptyText ?? "Nothing here yet.",
    path: options.path,
    rowLink: options.rowLink,
  };
}

type TableState = Pick<CollectionState<Record<string, unknown>>, "items" | "total" | "limit" | "offset" | "sort" | "error" | "loading">;

function pageHref(config: TableConfig, state: TableState, page: number, sort = state.sort): string {
  const params = new URLSearchParams();
  if (page > 0) params.set("page", String(page + 1));
  if (sort) params.set("sort", sort);
  const query = params.toString();
  return `${config.path ?? ""}${query ? `?${query}` : config.path ? "" : "?"}`;
}

export function renderTableBody(config: TableConfig, state: TableState): string {
  const actions = config.deletable;
  if (state.items.length === 0) {
    return `<tr><td class="bk-table__empty" colspan="${config.columns.length + 1}">${escapeHtml(state.loading ? "Loading..." : config.emptyText)}</td></tr>`;
  }
  return state.items
    .map((row) => {
      const id = String(row.id);
      const pending = id.startsWith("pending-");
      const name = String(row[config.display] ?? row.id ?? "row");
      const cells = config.columns
        .map((column) => {
          const content = config.toggle.includes(column.field)
            ? `<input class="bk-checkbox" type="checkbox" data-bk-toggle="${escapeHtml(column.field)}"${attr("checked", row[column.field] === true)}${attr(
                "disabled",
                pending,
              )} aria-label="${escapeHtml(`${column.label}: ${name}`)}">`
            : config.rowLink?.field === column.field && !pending
              ? `<a href="${escapeHtml(config.rowLink.href.replace(":id", encodeURIComponent(id)))}">${escapeHtml(formatValue(column.meta, row[column.field]))}</a>`
              : escapeHtml(formatValue(column.meta, row[column.field]));
          return `<td data-label="${escapeHtml(column.label)}">${content}</td>`;
        })
        .join("");
      const action = actions
        ? `<td class="bk-table__actions"><button class="bk-button bk-button--danger bk-button--small" type="button" data-bk-delete${attr("disabled", pending)} aria-label="${escapeHtml(
            `Delete ${name}`,
          )}">Delete</button></td>`
        : "";
      return `<tr data-id="${escapeHtml(id)}"${pending ? ' class="bk-row--pending"' : ""}>${cells}${action}</tr>`;
    })
    .join("");
}

export function renderTableHead(config: TableConfig, state: TableState): string {
  const head = config.columns
    .map((column) => {
      const direction = state.sort === column.field ? "ascending" : state.sort === `-${column.field}` ? "descending" : undefined;
      const next = direction === "ascending" ? `-${column.field}` : column.field;
      const icon = direction === "ascending" ? " \u2191" : direction === "descending" ? " \u2193" : "";
      const inner = column.sortable
        ? `<a class="bk-sort" href="${escapeHtml(pageHref(config, state, 0, next))}" data-bk-sort="${escapeHtml(next)}">${escapeHtml(column.label)}<span class="bk-sort__icon" aria-hidden="true">${icon}</span></a>`
        : escapeHtml(column.label);
      return `<th scope="col"${attr("aria-sort", direction)}>${inner}</th>`;
    })
    .join("");
  return `<tr>${head}${config.deletable ? '<th scope="col"><span class="bk-visually-hidden">Actions</span></th>' : ""}</tr>`;
}

export function renderPager(config: TableConfig, state: TableState): string {
  const page = pageInfo(state);
  const link = (label: string, target: number, enabled: boolean, dir: string) =>
    enabled
      ? `<a class="bk-button bk-button--secondary bk-button--small" href="${escapeHtml(pageHref(config, state, target))}" data-bk-page="${target}" rel="${dir}">${label}</a>`
      : `<span class="bk-button bk-button--secondary bk-button--small" aria-disabled="true">${label}</span>`;
  return `<nav class="bk-pager" aria-label="${escapeHtml(`${config.caption} pages`)}">${link("Previous", page.page - 1, page.hasPrevious, "prev")}<span class="bk-pager__status" aria-live="polite">${
    state.total === 0 ? "No rows" : `${page.from} to ${page.to} of ${state.total}`
  }</span>${link("Next", page.page + 1, page.hasNext, "next")}</nav>`;
}

/** The whole table. The element swaps the head, body, and pager as the state changes. */
export function renderTable(config: TableConfig, state: TableState, idPrefix: string): string {
  return `${renderAlert(state.error)}<table class="bk-table" aria-labelledby="${idPrefix}-caption"><caption id="${idPrefix}-caption" class="bk-table__caption${
    config.hideCaption ? " bk-visually-hidden" : ""
  }">${escapeHtml(config.caption)}</caption><thead>${renderTableHead(config, state)}</thead><tbody>${renderTableBody(config, state)}</tbody></table><div data-bk-pager>${renderPager(
    config,
    state,
  )}</div>`;
}

const LIVE_TEXT: Record<string, string> = { open: "Live", connecting: "Connecting", reconnecting: "Reconnecting", closed: "Offline", off: "Not live" };

export function renderLiveStatus(live: string): string {
  return `<span class="bk-live__dot" aria-hidden="true"></span>${escapeHtml(LIVE_TEXT[live] ?? live)}`;
}

export function renderListItems(items: Record<string, unknown>[], display: string, emptyText: string): string {
  if (items.length === 0) {
    return `<li class="bk-list__item bk-empty">${escapeHtml(emptyText)}</li>`;
  }
  return items
    .map(
      (row) =>
        `<li class="bk-list__item${String(row.id).startsWith("pending-") ? " bk-row--pending" : ""}" data-id="${escapeHtml(row.id)}">${escapeHtml(formatValue(undefined, row[display]))}</li>`,
    )
    .join("");
}

/** Safe JSON for a script type="application/json" tag. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
