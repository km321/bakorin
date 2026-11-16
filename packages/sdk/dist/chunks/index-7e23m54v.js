import {
  fieldLabel2,
  columnFields2,
  inputValue2,
  formatValue2,
  pageInfo2,
  formatBytes2
} from "./index-qzf6915z.js";

// src/elements/render.ts
function escapeHtml2(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var attr = (name, value) => value === undefined || value === null || value === false ? "" : value === true ? ` ${name}` : ` ${name}="${escapeHtml2(value)}"`;
var INPUT_TYPES = {
  email: "email",
  password: "password",
  number: "number",
  integer: "number",
  date: "date",
  datetime: "datetime-local"
};
function renderField2(field, options) {
  const base = `${options.idPrefix}-${field.name}`;
  const inputId = `${base}-input`;
  const hint = options.hint ?? field.description;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = `${base}-error`;
  const describedBy = [hintId, options.error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  const common = `${attr("id", inputId)}${attr("name", field.name)}${attr("aria-invalid", options.error ? "true" : undefined)}${attr("aria-describedby", describedBy)}`;
  const boolean = field.type === "boolean";
  let control;
  if (boolean) {
    control = `<input${common} class="bk-checkbox" type="checkbox" value="true"${attr("checked", options.value === true)}>`;
  } else if (field.type === "enum" || field.relation && options.options) {
    const choices = field.type === "enum" ? (field.enumValues ?? []).map((v) => ({ value: v, label: v })) : options.options ?? [];
    const many = Boolean(field.relation?.many);
    const selected = new Set(many ? options.value ?? [] : [inputValue2(field, options.value)]);
    control = `<select${common} class="bk-input bk-select"${attr("required", field.required)}${attr("multiple", many)}>${many ? "" : `<option value="">${field.required ? "Choose one" : "None"}</option>`}${choices.map((choice) => `<option${attr("value", choice.value)}${attr("selected", selected.has(choice.value))}>${escapeHtml2(choice.label)}</option>`).join("")}</select>`;
  } else if (field.type === "file") {
    control = renderDropzone2({ idPrefix: base, inputId, describedBy, name: field.name, value: options.value });
  } else {
    const autocomplete = options.autocomplete ?? (field.type === "password" ? "new-password" : field.type === "email" ? "email" : undefined);
    control = `<input${common} class="bk-input"${attr("type", INPUT_TYPES[field.type] ?? "text")}${attr("step", field.type === "integer" ? "1" : field.type === "number" ? "any" : undefined)}${attr("required", field.required && field.defaultValue === undefined)}${attr("autocomplete", autocomplete)}${attr("value", inputValue2(field, options.value))}>`;
  }
  const label = `<label class="bk-label" for="${escapeHtml2(inputId)}">${escapeHtml2(options.label ?? fieldLabel2(field.name))}${field.required && !boolean ? '<span class="bk-required" aria-hidden="true"> *</span>' : ""}</label>`;
  return `<div class="bk-field${boolean ? " bk-field--check" : ""}${options.error ? " bk-field--invalid" : ""}" data-field="${escapeHtml2(field.name)}">${boolean ? control + label : label + control}${hintId ? `<p class="bk-hint" id="${hintId}">${escapeHtml2(hint)}</p>` : ""}<p class="bk-error" id="${errorId}"${attr("hidden", !options.error)}>${escapeHtml2(options.error ?? "")}</p></div>`;
}
function renderAlert2(message, tone = "error") {
  return `<div class="bk-alert${message ? ` bk-alert--${tone}` : ""}" role="${tone === "error" ? "alert" : "status"}" data-bk-alert="${tone}">${escapeHtml2(message ?? "")}</div>`;
}
function renderForm2(options) {
  const fields = options.fields.map((field) => renderField2(field, {
    idPrefix: options.idPrefix,
    value: options.values?.[field.name],
    error: options.errors?.[field.name],
    label: options.labels?.[field.name],
    hint: options.hints?.[field.name] ?? (field.type === "password" && field.minLength !== 0 ? `At least ${field.minLength ?? 8} characters.` : undefined),
    autocomplete: options.autocomplete?.[field.name],
    options: options.relationOptions?.[field.name]
  })).join("");
  const hidden = Object.entries(options.hidden ?? {}).map(([name, value]) => `<input type="hidden"${attr("name", name)}${attr("value", value)}>`).join("");
  return `<form class="bk-form ${escapeHtml2(options.className)}" method="post"${attr("action", options.action)} novalidate>${renderAlert2(options.formError)}${hidden}${fields}<div class="bk-actions"><button class="bk-button" type="submit" data-label="${escapeHtml2(options.submitLabel)}">${escapeHtml2(options.submitLabel)}</button></div>${renderAlert2(options.success, "success")}${options.footer ?? ""}</form>`;
}
function signInFields2(identityField = "email") {
  return [
    { name: identityField, type: identityField === "email" ? "email" : "text", required: true },
    { name: "password", type: "password", required: true, minLength: 0 }
  ];
}
function renderDropzone2(options) {
  const inputId = options.inputId ?? `${options.idPrefix}-file`;
  const hintText = [options.hint, options.maxBytes ? `Up to ${formatBytes2(options.maxBytes)}.` : ""].filter(Boolean).join(" ");
  const hintId = hintText ? `${options.idPrefix}-drop-hint` : undefined;
  const describedBy = [options.describedBy, hintId].filter(Boolean).join(" ") || undefined;
  return `<bakorin-file-upload class="bk-dropzone"${attr("data-base-path", options.basePath)}${attr("data-accept", options.accept)}${attr("data-max-bytes", options.maxBytes)}><input id="${escapeHtml2(inputId)}" class="bk-dropzone__input" type="file"${attr("accept", options.accept)}${attr("aria-describedby", describedBy)}><label class="bk-dropzone__label" for="${escapeHtml2(inputId)}"><span class="bk-dropzone__title">${escapeHtml2(options.inputId ? "Choose a file" : options.label ?? "Upload a file")}</span><span class="bk-dropzone__subtitle">or drop it here</span></label>${hintId ? `<p class="bk-hint" id="${hintId}">${escapeHtml2(hintText)}</p>` : ""}<div class="bk-progress-row" hidden><progress class="bk-progress" max="100" value="0" aria-label="Upload progress"></progress><span class="bk-progress__text" aria-hidden="true">0%</span></div><div role="status" class="bk-dropzone__status"></div>${renderAlert2(null)}${options.name ? `<input type="hidden"${attr("name", options.name)}${attr("value", options.value ?? "")}>` : ""}</bakorin-file-upload>`;
}
function tableConfig2(entity, schema, options = {}) {
  const columns = options.columns ? options.columns.map((column) => {
    const c = typeof column === "string" ? { field: column } : column;
    const meta = schema?.fields.find((field) => field.name === c.field);
    return { field: c.field, label: c.label ?? fieldLabel2(c.field), sortable: c.sortable ?? Boolean(meta), meta };
  }) : schema ? columnFields2(schema).map((meta) => ({ field: meta.name, label: fieldLabel2(meta.name), sortable: true, meta })) : [{ field: "id", label: "Id", sortable: false }];
  return {
    entity,
    caption: options.caption ?? fieldLabel2(entity),
    hideCaption: options.hideCaption,
    columns,
    display: schema?.display ?? "id",
    toggle: options.toggle ?? [],
    deletable: Boolean(options.deletable),
    confirmDelete: options.confirmDelete === undefined ? "Delete this row?" : options.confirmDelete,
    emptyText: options.emptyText ?? "Nothing here yet.",
    path: options.path
  };
}
function pageHref(config, state, page, sort = state.sort) {
  const params = new URLSearchParams;
  if (page > 0)
    params.set("page", String(page + 1));
  if (sort)
    params.set("sort", sort);
  const query = params.toString();
  return `${config.path ?? ""}${query ? `?${query}` : config.path ? "" : "?"}`;
}
function renderTableBody2(config, state) {
  const actions = config.deletable;
  if (state.items.length === 0) {
    return `<tr><td class="bk-table__empty" colspan="${config.columns.length + 1}">${escapeHtml2(state.loading ? "Loading..." : config.emptyText)}</td></tr>`;
  }
  return state.items.map((row) => {
    const id = String(row.id);
    const pending = id.startsWith("pending-");
    const name = String(row[config.display] ?? row.id ?? "row");
    const cells = config.columns.map((column) => {
      const content = config.toggle.includes(column.field) ? `<input class="bk-checkbox" type="checkbox" data-bk-toggle="${escapeHtml2(column.field)}"${attr("checked", row[column.field] === true)}${attr("disabled", pending)} aria-label="${escapeHtml2(`${column.label}: ${name}`)}">` : escapeHtml2(formatValue2(column.meta, row[column.field]));
      return `<td data-label="${escapeHtml2(column.label)}">${content}</td>`;
    }).join("");
    const action = actions ? `<td class="bk-table__actions"><button class="bk-button bk-button--danger bk-button--small" type="button" data-bk-delete${attr("disabled", pending)} aria-label="${escapeHtml2(`Delete ${name}`)}">Delete</button></td>` : "";
    return `<tr data-id="${escapeHtml2(id)}"${pending ? ' class="bk-row--pending"' : ""}>${cells}${action}</tr>`;
  }).join("");
}
function renderTableHead2(config, state) {
  const head = config.columns.map((column) => {
    const direction = state.sort === column.field ? "ascending" : state.sort === `-${column.field}` ? "descending" : undefined;
    const next = direction === "ascending" ? `-${column.field}` : column.field;
    const icon = direction === "ascending" ? " ↑" : direction === "descending" ? " ↓" : "";
    const inner = column.sortable ? `<a class="bk-sort" href="${escapeHtml2(pageHref(config, state, 0, next))}" data-bk-sort="${escapeHtml2(next)}">${escapeHtml2(column.label)}<span class="bk-sort__icon" aria-hidden="true">${icon}</span></a>` : escapeHtml2(column.label);
    return `<th scope="col"${attr("aria-sort", direction)}>${inner}</th>`;
  }).join("");
  return `<tr>${head}${config.deletable ? '<th scope="col"><span class="bk-visually-hidden">Actions</span></th>' : ""}</tr>`;
}
function renderPager2(config, state) {
  const page = pageInfo2(state);
  const link = (label, target, enabled, dir) => enabled ? `<a class="bk-button bk-button--secondary bk-button--small" href="${escapeHtml2(pageHref(config, state, target))}" data-bk-page="${target}" rel="${dir}">${label}</a>` : `<span class="bk-button bk-button--secondary bk-button--small" aria-disabled="true">${label}</span>`;
  return `<nav class="bk-pager" aria-label="${escapeHtml2(`${config.caption} pages`)}">${link("Previous", page.page - 1, page.hasPrevious, "prev")}<span class="bk-pager__status" aria-live="polite">${state.total === 0 ? "No rows" : `${page.from} to ${page.to} of ${state.total}`}</span>${link("Next", page.page + 1, page.hasNext, "next")}</nav>`;
}
function renderTable2(config, state, idPrefix) {
  return `${renderAlert2(state.error)}<table class="bk-table" aria-labelledby="${idPrefix}-caption"><caption id="${idPrefix}-caption" class="bk-table__caption${config.hideCaption ? " bk-visually-hidden" : ""}">${escapeHtml2(config.caption)}</caption><thead>${renderTableHead2(config, state)}</thead><tbody>${renderTableBody2(config, state)}</tbody></table><div data-bk-pager>${renderPager2(config, state)}</div>`;
}
var LIVE_TEXT = { open: "Live", connecting: "Connecting", reconnecting: "Reconnecting", closed: "Offline", off: "Not live" };
function renderLiveStatus2(live) {
  return `<span class="bk-live__dot" aria-hidden="true"></span>${escapeHtml2(LIVE_TEXT[live] ?? live)}`;
}
function renderListItems2(items, display, emptyText) {
  if (items.length === 0) {
    return `<li class="bk-list__item bk-empty">${escapeHtml2(emptyText)}</li>`;
  }
  return items.map((row) => `<li class="bk-list__item${String(row.id).startsWith("pending-") ? " bk-row--pending" : ""}" data-id="${escapeHtml2(row.id)}">${escapeHtml2(formatValue2(undefined, row[display]))}</li>`).join("");
}
function jsonForScript2(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export { escapeHtml2, renderField2, renderAlert2, renderForm2, signInFields2, renderDropzone2, tableConfig2, renderTableBody2, renderTableHead2, renderPager2, renderTable2, renderLiveStatus2, renderListItems2, jsonForScript2 };
