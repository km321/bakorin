// Bakorin app.yaml config builder. Runs fully in the browser.
// The model and validation live in packages/core/src/builder.ts and use the server's own
// appYamlSchema (Zod) and compileAppYaml, so a config that shows "Valid" here passes the
// same checks the server runs at boot.
import {
  BUILDER_FIELD_TYPES,
  MAIL_EVENTS,
  ON_DELETE,
  POLICY_ACTIONS,
  WHEN_OPS,
  cloneConfig,
  defaultAuth,
  emptyEntity,
  emptyField,
  emptyBranding,
  emptyMailRule,
  importAppYaml,
  validateConfig,
  type BrandingDraft,
  type BuilderConfig,
  type BuilderFieldType,
  type BuilderIssue,
  type BuilderResult,
  type EntityDraft,
  type FieldDraft,
  type MailDraft,
  type PolicyAction,
  type WhenOp,
} from "../../../packages/core/src/builder.ts";
import { buildSchemaGraph } from "../../../packages/core/src/schema-graph.ts";
import type { SchemaAST } from "../../../packages/core/src/ast.ts";
import { layoutSchema, cardHeight, CARD_WIDTH, HEADER_HEIGHT, FIELD_HEIGHT } from "../../../packages/admin-ui/src/lib/schema-layout.ts";
import { STARTERS } from "./starters.ts";

const STORAGE_KEY = "bakorin-builder-draft-v1";

// ---------- tiny DOM helper ----------

type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;
type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key === "value" && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      el.value = String(value);
    } else if (key === "checked" && el instanceof HTMLInputElement) {
      el.checked = Boolean(value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function s(tag: string, attrs: Record<string, string | number> = {}, ...children: Array<Node | string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  for (const child of children) el.append(typeof child === "string" ? document.createTextNode(child) : child);
  return el;
}

function idFor(target: string): string {
  return `bk-${target.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

// ---------- state ----------

let config: BuilderConfig;
let starterId = "todo";
let lastResult: BuilderResult | undefined;
let lastValidAst: SchemaAST | undefined;
let refreshTimer = 0;

function loadInitial(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { config: BuilderConfig; starterId: string };
      if (saved?.config?.entities) {
        config = saved.config;
        config.branding = { ...emptyBranding(), ...(config.branding ?? {}) };
        starterId = saved.starterId ?? "custom";
        return;
      }
    }
  } catch {
    // ignore broken drafts
  }
  useStarter("todo");
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, starterId }));
  } catch {
    // private mode
  }
}

function useStarter(id: string): void {
  const starter = STARTERS.find((item) => item.id === id) ?? STARTERS[0]!;
  config = importAppYaml(starter.yaml).config;
  starterId = starter.id;
}

// ---------- form controls ----------

interface ControlOptions {
  hint?: string;
  wide?: boolean;
  srOnlyLabel?: boolean;
}

function control(target: string, label: string, input: HTMLElement, options: ControlOptions = {}): HTMLElement {
  const id = idFor(target);
  input.id = id;
  const hintId = options.hint ? `${id}-hint` : undefined;
  if (hintId) input.setAttribute("aria-describedby", hintId);
  return h(
    "div",
    { class: `ctl${options.wide ? " ctl-wide" : ""}`, "data-target": target },
    h("label", { for: id, class: options.srOnlyLabel ? "sr-only" : undefined }, label),
    input,
    options.hint ? h("p", { class: "hint", id: hintId }, options.hint) : null,
  );
}

function textInput(value: string, onInput: (value: string) => void, attrs: Attrs = {}): HTMLInputElement {
  return h("input", {
    type: "text",
    value,
    autocomplete: "off",
    spellcheck: "false",
    ...attrs,
    onInput: (event: Event) => {
      onInput((event.target as HTMLInputElement).value);
      changed();
    },
  });
}

function select(
  value: string,
  options: Array<[string, string]>,
  onChange: (value: string) => void,
  structural = false,
): HTMLSelectElement {
  const el = h(
    "select",
    {
      onChange: (event: Event) => {
        onChange((event.target as HTMLSelectElement).value);
        changed(structural);
      },
    },
    ...options.map(([optionValue, label]) => h("option", { value: optionValue }, label)),
  );
  el.value = value;
  if (el.value !== value && options.length > 0 && value) {
    // keep unknown values visible so the error makes sense
    el.prepend(h("option", { value }, `${value} (missing)`));
    el.value = value;
  }
  return el;
}

function checkbox(target: string, label: string, checked: boolean, onChange: (value: boolean) => void, structural = false): HTMLElement {
  const id = idFor(target);
  return h(
    "div",
    { class: "check", "data-target": target },
    h("input", {
      type: "checkbox",
      id,
      checked,
      onChange: (event: Event) => {
        onChange((event.target as HTMLInputElement).checked);
        changed(structural);
      },
    }),
    h("label", { for: id }, label),
  );
}

function iconButton(label: string, text: string, onClick: () => void, extra = ""): HTMLButtonElement {
  return h("button", { type: "button", class: `icon-btn ${extra}`.trim(), "aria-label": label, title: label, onClick }, text);
}

function listInput(values: string[]): string {
  return values.join(", ");
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// ---------- sections ----------

function appSection(): HTMLElement {
  const runtime = config.runtime;
  const dialect = String((runtime.dialect as string | undefined) ?? ((runtime.postgres as { url?: string } | undefined)?.url ? "postgres" : "sqlite"));
  const cors = ((runtime.cors as { origins?: string[] } | undefined)?.origins ?? []).join(", ");
  const postgresUrl = (runtime.postgres as { url?: string } | undefined)?.url ?? "";
  return h(
    "section",
    { class: "panel", "aria-labelledby": "bk-app-h" },
    h("h2", { id: "bk-app-h" }, "App"),
    h(
      "div",
      { class: "grid3" },
      control("app.name", "Name", textInput(config.app.name, (v) => (config.app.name = v), { required: true })),
      control("app.version", "Version", textInput(config.app.version, (v) => (config.app.version = v), { placeholder: "0.1.0" })),
      control(
        "runtime.dialect",
        "Database",
        select(
          dialect,
          [
            ["sqlite", "SQLite (one file)"],
            ["postgres", "Postgres"],
          ],
          (v) => {
            runtime.dialect = v;
            if (v === "postgres" && !(runtime.postgres as { url?: string } | undefined)?.url) {
              runtime.postgres = { url: "${DATABASE_URL}" };
            }
          },
          true,
        ),
      ),
    ),
    control("app.description", "Description", textInput(config.app.description, (v) => (config.app.description = v)), { wide: true }),
    dialect === "postgres"
      ? control(
          "runtime.postgres",
          "Postgres URL",
          textInput(postgresUrl, (v) => {
            runtime.postgres = { url: v };
          }),
          { hint: "Keep secrets out of the file. ${DATABASE_URL} reads the variable at boot.", wide: true },
        )
      : null,
    h(
      "div",
      { class: "grid2" },
      control(
        "runtime.port",
        "Port",
        h("input", {
          type: "number",
          min: 1,
          value: runtime.port === undefined ? "" : String(runtime.port),
          placeholder: "4371",
          onInput: (event: Event) => {
            const raw = (event.target as HTMLInputElement).value;
            if (raw === "") delete runtime.port;
            else runtime.port = Number(raw);
            changed();
          },
        }),
      ),
      control(
        "runtime.cors",
        "Allowed origins (CORS)",
        textInput(cors, (v) => {
          const origins = parseList(v);
          if (origins.length === 0) delete runtime.cors;
          else runtime.cors = { origins };
        }, { placeholder: "http://localhost:4321" }),
        { hint: "Comma separated. Your front end URLs." },
      ),
    ),
    h("div", { class: "err-slot", "data-slot": "runtime" }),
    h(
      "p",
      { class: "hint" },
      "Other runtime settings (files, JWT, backups, hooks) are kept from the starter or your import. See the ",
      h("a", { href: "/docs/configuration/" }, "configuration docs"),
      ".",
    ),
  );
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function fullHex(value: string): string {
  const v = value.trim().toLowerCase();
  if (!HEX_COLOR.test(v)) return "";
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

function colorControl(key: "primaryColor" | "accentColor", label: string, hint: string): HTMLElement {
  const branding = config.branding;
  const text = textInput(branding[key], (v) => {
    branding[key] = v.trim();
    const hex = fullHex(v);
    if (hex) picker.value = hex;
  }, { placeholder: key === "primaryColor" ? "#0f766e" : "Same as primary", inputmode: "text" });
  const picker = h("input", {
    type: "color",
    class: "color-pick",
    value: fullHex(branding[key]) || fullHex(branding.primaryColor) || "#0f766e",
    "aria-label": `${label} picker`,
    onInput: (event: Event) => {
      branding[key] = (event.target as HTMLInputElement).value;
      text.value = branding[key];
      changed();
    },
  }) as HTMLInputElement;
  const wrap = control(`branding.${key}`, label, text, { hint });
  wrap.querySelector("label")?.after(h("div", { class: "color-row" }, picker, text));
  return wrap;
}

let brandingOpen = false;

function brandingSection(): HTMLElement {
  const branding: BrandingDraft = config.branding;
  const used = Object.values(branding).some((value) => value.trim() !== "");
  return h(
    "section",
    { class: "panel", "aria-labelledby": "bk-brand-h" },
    h(
      "details",
      {
        class: "brand-details",
        open: used || brandingOpen ? true : undefined,
        onToggle: (event: Event) => (brandingOpen = (event.target as HTMLDetailsElement).open),
      },
      h("summary", {}, h("h2", { id: "bk-brand-h" }, "Branding"), h("span", { class: "hint" }, " Optional white label for the admin, API docs, and system emails")),
      h(
        "p",
        { class: "hint" },
        "Leave everything empty to keep the default Bakorin look. Colors that would fail WCAG AA contrast are adjusted by the server, and the change is shown here. ",
        h("a", { href: "/docs/branding/" }, "Branding docs"),
        ".",
      ),
      h(
        "div",
        { class: "grid3" },
        control("branding.name", "Product name", textInput(branding.name, (v) => (branding.name = v), { placeholder: config.app.name || "Acme" }), {
          hint: "Shown in the admin header, sign in, docs, and emails.",
        }),
        colorControl("primaryColor", "Primary color", "Buttons, links, and selected items."),
        colorControl("accentColor", "Accent color", "Focus rings. Optional."),
      ),
      h(
        "div",
        { class: "grid2" },
        control("branding.logo", "Logo file", textInput(branding.logo, (v) => (branding.logo = v.trim()), { placeholder: "branding/logo.svg" }), {
          hint: "In the branding/ folder next to app.yaml. svg, png, jpg, or webp. Use png for email clients.",
        }),
        control("branding.favicon", "Favicon file", textInput(branding.favicon, (v) => (branding.favicon = v.trim()), { placeholder: "branding/favicon.png" }), {
          hint: "svg, png, or ico in branding/.",
        }),
      ),
    ),
  );
}

function fieldsOf(entityName: string, filter?: (field: FieldDraft) => boolean): FieldDraft[] {
  const entity = config.entities.find((item) => item.name === entityName);
  return entity ? entity.fields.filter((field) => (filter ? filter(field) : true)) : [];
}

function authSection(): HTMLElement {
  const auth = config.auth;
  const authEntityName = auth.entity || config.entities.find((item) => item.auth)?.name || "users";
  const fieldOptions = (filter?: (field: FieldDraft) => boolean): Array<[string, string]> => [
    ["", "Default"],
    ...fieldsOf(authEntityName, filter).map((field): [string, string] => [field.name, field.name]),
  ];
  const roleField = auth.role || "role";
  const roleValues = fieldsOf(authEntityName).find((field) => field.name === roleField)?.values ?? [];
  return h(
    "section",
    { class: "panel", "aria-labelledby": "bk-auth-h" },
    h("h2", { id: "bk-auth-h" }, "Auth"),
    h(
      "p",
      { class: "hint" },
      "One entity holds accounts. It needs an email, a password field, and a role enum that includes the admin role.",
    ),
    h(
      "div",
      { class: "grid3" },
      control(
        "auth.entity",
        "Accounts entity",
        select(
          auth.entity,
          [["", "Default (the entity marked auth)"], ...config.entities.map((entity): [string, string] => [entity.name, entity.name])],
          (v) => (auth.entity = v),
          true,
        ),
      ),
      control("auth.identity", "Sign-in field", select(auth.identity, fieldOptions((f) => f.type === "email" || f.type === "text"), (v) => (auth.identity = v))),
      control("auth.password", "Password field", select(auth.password, fieldOptions((f) => f.type === "password"), (v) => (auth.password = v))),
      control("auth.role", "Role field", select(auth.role, fieldOptions((f) => f.type === "enum"), (v) => (auth.role = v), true)),
      control(
        "auth.adminRole",
        "Admin role",
        select(auth.adminRole, [["", "Default (admin)"], ...roleValues.map((value): [string, string] => [value, value])], (v) => (auth.adminRole = v)),
      ),
    ),
    checkbox("auth.requireVerifiedEmail", "Require a verified email before sign-in", auth.requireVerifiedEmail, (v) => (auth.requireVerifiedEmail = v)),
  );
}

const TYPE_HELP: Record<BuilderFieldType, string> = {
  text: "Text",
  email: "Email",
  password: "Password (hashed, never returned)",
  number: "Number",
  integer: "Whole number",
  boolean: "Yes or no",
  date: "Date",
  datetime: "Date and time",
  enum: "One of a list",
  file: "File upload",
  relation: "Link to another entity",
};

function fieldCard(entity: EntityDraft, i: number, field: FieldDraft, j: number): HTMLElement {
  const at = `entities.${i}.fields.${j}`;
  const label = field.name || `field ${j + 1}`;
  const typeSpecific: HTMLElement[] = [];
  if (field.type === "enum") {
    typeSpecific.push(
      control(`${at}.values`, "Values", textInput(listInput(field.values), (v) => (field.values = parseList(v)), { placeholder: "new, active, closed" }), {
        hint: "Comma separated.",
      }),
    );
    typeSpecific.push(
      control(
        `${at}.defaultValue`,
        "Default",
        select(field.defaultValue, [["", "No default"], ...field.values.map((v): [string, string] => [v, v])], (v) => (field.defaultValue = v)),
      ),
    );
  } else if (field.type === "relation") {
    typeSpecific.push(
      control(
        `${at}.to`,
        "Points to",
        select(field.to, [["", "Pick an entity"], ...config.entities.map((item): [string, string] => [item.name, item.name])], (v) => (field.to = v), true),
      ),
    );
    typeSpecific.push(
      control(
        `${at}.onDelete`,
        "When the linked record is deleted",
        select(
          field.onDelete,
          [
            ["", "Block the delete (restrict, default)"],
            ...ON_DELETE.map((v): [string, string] => [v, v === "restrict" ? "Block the delete (restrict)" : v === "cascade" ? "Delete this record too (cascade)" : "Clear this field (set_null)"]),
          ],
          (v) => (field.onDelete = v as FieldDraft["onDelete"]),
        ),
      ),
    );
  } else if (field.type === "boolean") {
    typeSpecific.push(
      control(
        `${at}.defaultValue`,
        "Default",
        select(field.defaultValue, [["", "No default"], ["true", "true"], ["false", "false"]], (v) => (field.defaultValue = v)),
      ),
    );
  } else if (field.type !== "password" && field.type !== "file") {
    const placeholder = field.type === "date" ? "2026-01-31" : field.type === "datetime" ? "2026-01-31T09:00:00Z" : "";
    typeSpecific.push(
      control(
        `${at}.defaultValue`,
        "Default",
        textInput(field.defaultValue, (v) => (field.defaultValue = v), {
          placeholder,
          inputmode: field.type === "number" || field.type === "integer" ? "decimal" : undefined,
        }),
      ),
    );
  }
  return h(
    "li",
    { class: "field-card" },
    h(
      "div",
      { class: "field-head" },
      control(`${at}.name`, "Field name", textInput(field.name, (v) => (field.name = v), { placeholder: "title", required: true })),
      control(
        `${at}.type`,
        "Type",
        select(field.type, BUILDER_FIELD_TYPES.map((type): [string, string] => [type, `${type}: ${TYPE_HELP[type]}`]), (v) => {
          field.type = v as BuilderFieldType;
          if (field.type !== "enum") field.values = [];
          if (field.type !== "relation") {
            field.to = "";
            field.onDelete = "";
          }
          field.defaultValue = "";
        }, true),
      ),
      h(
        "div",
        { class: "row-actions" },
        iconButton(`Move ${label} up`, "\u2191", () => move(entity.fields, j, -1), j === 0 ? "is-disabled" : ""),
        iconButton(`Move ${label} down`, "\u2193", () => move(entity.fields, j, 1), j === entity.fields.length - 1 ? "is-disabled" : ""),
        iconButton(`Remove field ${label}`, "\u00d7", () => {
          entity.fields.splice(j, 1);
          changed(true);
        }, "danger"),
      ),
    ),
    h(
      "div",
      { class: "flag-row" },
      checkbox(`${at}.required`, "Required", field.required, (v) => (field.required = v)),
      checkbox(`${at}.unique`, "Unique", field.unique, (v) => (field.unique = v)),
      checkbox(`${at}.index`, "Indexed", field.index, (v) => (field.index = v)),
      field.type !== "password" ? checkbox(`${at}.secret`, "Secret (hidden from API reads)", field.secret, (v) => (field.secret = v)) : null,
    ),
    typeSpecific.length > 0 ? h("div", { class: "grid2" }, ...typeSpecific) : null,
    h(
      "div",
      { class: "grid2" },
      control(
        `${at}.writable`,
        "Who can set it",
        select(
          field.writable,
          [
            ["any", "Anyone allowed to create or update"],
            ["admin", "Admins only"],
            ["none", "Nobody (read only)"],
          ],
          (v) => (field.writable = v as FieldDraft["writable"]),
        ),
      ),
      control(`${at}.description`, "Description", textInput(field.description, (v) => (field.description = v), { placeholder: "Shown in the admin and API docs" })),
    ),
    h(
      "details",
      { class: "more" },
      h("summary", {}, "More options"),
      control(`${at}.renameFrom`, "Renamed from", textInput(field.renameFrom, (v) => (field.renameFrom = v)), {
        hint: "Set this when you rename a field so the migrator keeps the data.",
      }),
    ),
  );
}

function move<T>(list: T[], index: number, delta: number): void {
  const next = index + delta;
  if (next < 0 || next >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(next, 0, item as T);
  changed(true);
}

function policyDefaults(entity: EntityDraft): Record<PolicyAction, string> {
  const isAuth = entity.auth || entity.name === config.auth.entity;
  return isAuth
    ? { read: "authenticated", create: "admin", update: "owner(id)", delete: "admin" }
    : { read: "authenticated", create: "authenticated", update: "authenticated", delete: "authenticated" };
}

function parsePolicy(rule: string): { kind: string; param: string } {
  const owner = /^owner\((.*)\)$/.exec(rule.trim());
  if (owner) return { kind: "owner", param: owner[1] ?? "" };
  const role = /^role\((.*)\)$/.exec(rule.trim());
  if (role) return { kind: "role", param: role[1] ?? "" };
  return { kind: rule.trim(), param: "" };
}

function formatPolicy(kind: string, param: string): string {
  if (kind === "owner") return `owner(${param})`;
  if (kind === "role") return `role(${param})`;
  return kind;
}

function policiesBlock(entity: EntityDraft, i: number): HTMLElement {
  const defaults = policyDefaults(entity);
  const ownerFields = ["id", ...entity.fields.filter((field) => field.type === "relation").map((field) => field.name)];
  return h(
    "fieldset",
    { class: "policies" },
    h("legend", {}, "Who can read and write"),
    h(
      "p",
      { class: "hint" },
      "Rules in a list are OR. owner(field) matches when that field holds the signed in user's id, so use id on the accounts entity or a relation to it.",
    ),
    ...POLICY_ACTIONS.map((action) => {
      const target = `entities.${i}.policies.${action}`;
      const rules = entity.policies[action];
      return h(
        "div",
        { class: "policy-row", "data-target": target, role: "group", "aria-label": `${action} rules` },
        h("span", { class: "policy-action" }, action),
        h(
          "div",
          { class: "policy-rules" },
          rules.length === 0 ? h("span", { class: "policy-default" }, `Default: ${defaults[action]}`) : null,
          ...rules.map((rule, k) => {
            const parsed = parsePolicy(rule);
            const kindSelect = select(
              parsed.kind,
              [
                ["public", "public"],
                ["authenticated", "authenticated"],
                ["admin", "admin"],
                ["owner", "owner(field)"],
                ["role", "role(name)"],
              ],
              (v) => {
                rules[k] = formatPolicy(v, v === "owner" ? (ownerFields.includes(parsed.param) ? parsed.param : (ownerFields[1] ?? "id")) : v === "role" ? parsed.param || "editor" : "");
              },
              true,
            );
            kindSelect.setAttribute("aria-label", `${action} rule ${k + 1}`);
            let param: HTMLElement | null = null;
            if (parsed.kind === "owner") {
              const options = ownerFields.includes(parsed.param) ? ownerFields : [parsed.param, ...ownerFields];
              param = select(parsed.param, options.map((name): [string, string] => [name, name]), (v) => (rules[k] = formatPolicy("owner", v)));
              param.setAttribute("aria-label", `${action} rule ${k + 1} owner field`);
            } else if (parsed.kind === "role") {
              param = textInput(parsed.param, (v) => (rules[k] = formatPolicy("role", v.trim())), {
                "aria-label": `${action} rule ${k + 1} role name`,
                class: "short",
              });
            }
            return h(
              "span",
              { class: "policy-rule" },
              kindSelect,
              param,
              iconButton(`Remove ${action} rule ${k + 1}`, "\u00d7", () => {
                rules.splice(k, 1);
                changed(true);
              }, "danger"),
            );
          }),
          h(
            "button",
            {
              type: "button",
              class: "link-btn",
              onClick: () => {
                rules.push(rules.length === 0 ? defaults[action] : "admin");
                changed(true);
              },
            },
            rules.length === 0 ? "Set rules" : "Add rule",
          ),
        ),
      );
    }),
  );
}

function indexesBlock(entity: EntityDraft, i: number): HTMLElement {
  return h(
    "fieldset",
    { class: "indexes", "data-target": `entities.${i}.indexes` },
    h("legend", {}, "Extra indexes"),
    h("p", { class: "hint" }, "Relations and unique fields are indexed already. Add a combined index for common filters, for example ownerId, status."),
    h(
      "ul",
      { class: "plain" },
      ...entity.indexes.map((index, k) =>
        h(
          "li",
          { class: "index-row" },
          control(`entities.${i}.indexes.${k}`, `Index ${k + 1} fields`, textInput(listInput(index), (v) => (entity.indexes[k] = parseList(v)), {
            list: `bk-fields-${i}`,
            placeholder: "ownerId, status",
          })),
          iconButton(`Remove index ${k + 1}`, "\u00d7", () => {
            entity.indexes.splice(k, 1);
            changed(true);
          }, "danger"),
        ),
      ),
    ),
    h("datalist", { id: `bk-fields-${i}` }, ...entity.fields.map((field) => h("option", { value: field.name }))),
    h(
      "button",
      {
        type: "button",
        class: "link-btn",
        onClick: () => {
          entity.indexes.push([]);
          changed(true);
        },
      },
      "Add index",
    ),
  );
}

const openEntities = new Set<number>([0, 1, 2]);

function entityCard(entity: EntityDraft, i: number): HTMLElement {
  const title = entity.name || `entity ${i + 1}`;
  const details = h(
    "details",
    { class: "entity", open: openEntities.has(i), "data-target": `entities.${i}` },
    h(
      "summary",
      {},
      h("span", { class: "entity-title" }, title),
      h("span", { class: "entity-meta" }, `${entity.fields.length} field${entity.fields.length === 1 ? "" : "s"}${entity.auth ? ", accounts" : ""}`),
    ),
    h(
      "div",
      { class: "entity-body" },
      h(
        "div",
        { class: "grid3" },
        control(`entities.${i}.name`, "Entity name", textInput(entity.name, (v) => (entity.name = v), { placeholder: "projects", required: true }), {
          hint: "Plural. Used in the API path, for example /api/v1/projects.",
        }),
        control(`entities.${i}.label`, "Label", textInput(entity.label, (v) => (entity.label = v), { placeholder: "Project" })),
        control(`entities.${i}.plural`, "Plural label", textInput(entity.plural, (v) => (entity.plural = v), { placeholder: "Projects" })),
        control(
          `entities.${i}.display`,
          "Display field",
          select(
            entity.display,
            [["", "Automatic"], ...entity.fields.filter((field) => !field.secret && field.type !== "password").map((field): [string, string] => [field.name, field.name])],
            (v) => (entity.display = v),
          ),
        ),
      ),
      control(`entities.${i}.description`, "Description", textInput(entity.description, (v) => (entity.description = v)), { wide: true }),
      checkbox(`entities.${i}.auth`, "This entity stores accounts (auth: true)", entity.auth, (v) => (entity.auth = v), true),
      h(
        "fieldset",
        { class: "fields", "data-target": `entities.${i}.fields` },
        h("legend", {}, "Fields"),
        h("p", { class: "hint" }, "id, createdAt, and updatedAt are added automatically."),
        h("ul", { class: "plain field-list" }, ...entity.fields.map((field, j) => fieldCard(entity, i, field, j))),
        h(
          "button",
          {
            type: "button",
            class: "btn-secondary",
            onClick: () => {
              entity.fields.push(emptyField("", "text"));
              changed(true, `entities.${i}.fields.${entity.fields.length - 1}.name`);
            },
          },
          "Add field",
        ),
      ),
      policiesBlock(entity, i),
      indexesBlock(entity, i),
      h(
        "div",
        { class: "entity-actions" },
        h(
          "button",
          {
            type: "button",
            class: "btn-danger",
            onClick: () => {
              if (!confirm(`Remove the ${title} entity and its fields?`)) return;
              config.entities.splice(i, 1);
              changed(true);
            },
          },
          `Remove ${title}`,
        ),
      ),
    ),
  );
  details.addEventListener("toggle", () => {
    if (details.open) openEntities.add(i);
    else openEntities.delete(i);
  });
  return details;
}

function entitiesSection(): HTMLElement {
  return h(
    "section",
    { class: "panel", "aria-labelledby": "bk-entities-h" },
    h("h2", { id: "bk-entities-h" }, "Entities"),
    h("p", { class: "hint" }, "Each entity becomes a table, a REST resource, and a section in the admin."),
    h("div", { class: "err-slot", "data-slot": "entities" }),
    h("div", { class: "entity-list" }, ...config.entities.map((entity, i) => entityCard(entity, i))),
    h(
      "button",
      {
        type: "button",
        class: "btn-secondary",
        onClick: () => {
          const entity = emptyEntity("");
          entity.fields.push({ ...emptyField("title", "text"), required: true });
          config.entities.push(entity);
          openEntities.add(config.entities.length - 1);
          changed(true, `entities.${config.entities.length - 1}.name`);
        },
      },
      "Add entity",
    ),
  );
}

function whenRow(rule: MailDraft, i: number, k: number): HTMLElement {
  const item = rule.when[k]!;
  const fields = fieldsOf(rule.entity, (field) => field.type !== "password" && !field.secret);
  const fieldSelect = select(item.field, [["", "Field"], ...fields.map((field): [string, string] => [field.name, field.name])], (v) => (item.field = v));
  fieldSelect.setAttribute("aria-label", `Condition ${k + 1} field`);
  const opSelect = select(
    item.op,
    WHEN_OPS.map((op): [string, string] => [op, op === "notIn" ? "not in" : op]),
    (v) => {
      item.op = v as WhenOp;
      if (item.op === "exists") item.value = "true";
    },
    true,
  );
  opSelect.setAttribute("aria-label", `Condition ${k + 1} operator`);
  const value =
    item.op === "exists"
      ? select(item.value === "false" ? "false" : "true", [["true", "is set"], ["false", "is empty"]], (v) => (item.value = v))
      : textInput(item.value, (v) => (item.value = v), { placeholder: item.op === "in" || item.op === "notIn" ? "won, lost" : "won" });
  value.setAttribute("aria-label", `Condition ${k + 1} value`);
  return h(
    "li",
    { class: "when-row", "data-target": `mail.${i}.when.${k}` },
    fieldSelect,
    opSelect,
    value,
    iconButton(`Remove condition ${k + 1}`, "\u00d7", () => {
      rule.when.splice(k, 1);
      changed(true);
    }, "danger"),
  );
}

function fieldChecks(target: string, legend: string, names: string[], selected: string[], onChange: (next: string[]) => void, hint?: string): HTMLElement {
  return h(
    "fieldset",
    { class: "inline-checks", "data-target": target },
    h("legend", {}, legend),
    hint ? h("p", { class: "hint" }, hint) : null,
    names.length === 0 ? h("p", { class: "hint" }, "No matching fields yet.") : null,
    ...names.map((name) =>
      checkbox(`${target}.${name}`, name, selected.includes(name), (checked) => {
        const next = selected.filter((item) => item !== name);
        if (checked) next.push(name);
        onChange(next);
      }),
    ),
  );
}

function mailCard(rule: MailDraft, i: number): HTMLElement {
  const at = `mail.${i}`;
  const title = rule.name || `rule ${i + 1}`;
  const relationFields = fieldsOf(rule.entity, (field) => field.type === "relation").map((field) => field.name);
  const allFields = fieldsOf(rule.entity).map((field) => field.name);
  const updateOnly = rule.events.length === 1 && rule.events[0] === "update";
  return h(
    "details",
    { class: "entity", open: true, "data-target": at },
    h("summary", {}, h("span", { class: "entity-title" }, title), h("span", { class: "entity-meta" }, `${rule.entity || "no entity"}, on ${rule.events.join(", ") || "nothing"}`)),
    h(
      "div",
      { class: "entity-body" },
      h(
        "div",
        { class: "grid3" },
        control(`${at}.name`, "Rule name", textInput(rule.name, (v) => (rule.name = v), { placeholder: "new-lead-alert" })),
        control(
          `${at}.entity`,
          "Entity",
          select(rule.entity, [["", "Pick an entity"], ...config.entities.map((entity): [string, string] => [entity.name, entity.name])], (v) => {
            rule.entity = v;
            rule.expand = [];
            rule.changed = [];
            rule.when = [];
          }, true),
        ),
        control(`${at}.template`, "Template", textInput(rule.template, (v) => (rule.template = v), { placeholder: "new-lead" }), {
          hint: "File name in mail/, without .html",
        }),
      ),
      h(
        "fieldset",
        { class: "inline-checks", "data-target": `${at}.events` },
        h("legend", {}, "Send when a record is"),
        ...MAIL_EVENTS.map((event) =>
          checkbox(`${at}.events.${event}`, event === "create" ? "created" : event === "update" ? "updated" : "deleted", rule.events.includes(event), (checked) => {
            const next = rule.events.filter((item) => item !== event);
            if (checked) next.push(event);
            rule.events = MAIL_EVENTS.filter((item) => next.includes(item));
            if (!(rule.events.length === 1 && rule.events[0] === "update")) rule.changed = [];
          }, true),
        ),
      ),
      h(
        "div",
        { class: "grid2" },
        control(`${at}.to`, "To", textInput(rule.to, (v) => (rule.to = v), { placeholder: "{{ expand.ownerId.email }}, team@example.com" }), {
          hint: "Comma separated. Placeholders start with record, before, expand, event, or app.",
        }),
        control(`${at}.subject`, "Subject", textInput(rule.subject, (v) => (rule.subject = v), { placeholder: "New lead: {{ record.company }}" }), {
          hint: "Leave empty to use mail/<template>.subject.",
        }),
        control(`${at}.cc`, "Cc", textInput(rule.cc, (v) => (rule.cc = v))),
        control(`${at}.bcc`, "Bcc", textInput(rule.bcc, (v) => (rule.bcc = v))),
        control(`${at}.replyTo`, "Reply to", textInput(rule.replyTo, (v) => (rule.replyTo = v), { placeholder: "{{ record.email }}" })),
        control(
          `${at}.maxAttempts`,
          "Max attempts",
          h("input", {
            type: "number",
            min: 1,
            max: 100,
            value: rule.maxAttempts,
            placeholder: "8",
            onInput: (event: Event) => {
              rule.maxAttempts = (event.target as HTMLInputElement).value;
              changed();
            },
          }),
        ),
      ),
      fieldChecks(`${at}.expand`, "Load linked records (expand)", relationFields, rule.expand, (next) => (rule.expand = next), "Needed for placeholders like {{ expand.ownerId.email }}."),
      updateOnly
        ? fieldChecks(`${at}.changed`, "Only when these fields changed", allFields, rule.changed, (next) => (rule.changed = next))
        : h("p", { class: "hint" }, "Pick only \"updated\" to limit sends to specific changed fields."),
      h(
        "fieldset",
        { class: "when", "data-target": `${at}.when` },
        h("legend", {}, "Conditions (all must match)"),
        h("ul", { class: "plain" }, ...rule.when.map((_item, k) => whenRow(rule, i, k))),
        h(
          "button",
          {
            type: "button",
            class: "link-btn",
            onClick: () => {
              rule.when.push({ field: "", op: "equals", value: "" });
              changed(true);
            },
          },
          "Add condition",
        ),
      ),
      h(
        "div",
        { class: "entity-actions" },
        h(
          "button",
          {
            type: "button",
            class: "btn-danger",
            onClick: () => {
              config.mail.splice(i, 1);
              changed(true);
            },
          },
          `Remove ${title}`,
        ),
      ),
    ),
  );
}

function mailSection(): HTMLElement {
  return h(
    "section",
    { class: "panel", "aria-labelledby": "bk-mail-h" },
    h("h2", { id: "bk-mail-h" }, "Mail rules"),
    h(
      "p",
      { class: "hint" },
      "Send an email when records change. Each rule needs a template file in mail/. See ",
      h("a", { href: "/docs/email/" }, "Email docs"),
      ".",
    ),
    h("div", { class: "err-slot", "data-slot": "mail" }),
    h("div", { class: "entity-list" }, ...config.mail.map((rule, i) => mailCard(rule, i))),
    h(
      "button",
      {
        type: "button",
        class: "btn-secondary",
        onClick: () => {
          const entity = config.entities.find((item) => !item.auth)?.name ?? config.entities[0]?.name ?? "";
          const rule = emptyMailRule(entity);
          rule.name = `${entity || "record"}-created`;
          rule.to = "team@example.com";
          rule.template = `${entity || "record"}-created`;
          rule.subject = "New record: {{ record.id }}";
          config.mail.push(rule);
          changed(true, `mail.${config.mail.length - 1}.name`);
        },
      },
      "Add mail rule",
    ),
    config.webhooks.length > 0
      ? h("p", { class: "hint", "data-target": "webhooks" }, `${config.webhooks.length} webhook${config.webhooks.length === 1 ? "" : "s"} from your import are kept as they are.`)
      : null,
  );
}

// ---------- render ----------

const root = document.getElementById("builder-forms") as HTMLElement;

function render(focusTarget?: string): void {
  const active = document.activeElement as HTMLElement | null;
  const activeId = focusTarget ? idFor(focusTarget) : active?.id;
  const scroll = window.scrollY;
  root.replaceChildren(appSection(), brandingSection(), authSection(), entitiesSection(), mailSection());
  const starterSelect = document.getElementById("bk-starter") as HTMLSelectElement | null;
  if (starterSelect) starterSelect.value = STARTERS.some((item) => item.id === starterId) ? starterId : "custom";
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.focus({ preventScroll: !focusTarget });
      if (focusTarget) el.scrollIntoView({ block: "center" });
    }
  }
  if (!focusTarget) window.scrollTo({ top: scroll });
  refresh();
}

function changed(structural = false, focusTarget?: string): void {
  if (starterId !== "custom" && STARTERS.some((item) => item.id === starterId)) {
    // still based on a starter; keep the label until the user picks another
  }
  save();
  if (structural) {
    render(focusTarget);
    return;
  }
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refresh, 120);
}

// ---------- output, errors, diagram ----------

const yamlOut = document.getElementById("bk-yaml") as HTMLElement;
const statusEl = document.getElementById("bk-status") as HTMLElement;
const issuesEl = document.getElementById("bk-issues") as HTMLElement;
const notesEl = document.getElementById("bk-notes") as HTMLElement;
const diagramEl = document.getElementById("bk-diagram") as HTMLElement;
const liveEl = document.getElementById("bk-live") as HTMLElement;

function clearErrors(): void {
  for (const el of root.querySelectorAll(".err")) el.remove();
  for (const el of root.querySelectorAll("[aria-invalid]")) {
    el.removeAttribute("aria-invalid");
    const describedBy = (el.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && !id.endsWith("-err"));
    if (describedBy.length > 0) el.setAttribute("aria-describedby", describedBy.join(" "));
    else el.removeAttribute("aria-describedby");
  }
  for (const el of root.querySelectorAll(".has-error")) el.classList.remove("has-error");
}

function findTarget(target: string): HTMLElement | null {
  let path = target;
  while (path) {
    const el = root.querySelector<HTMLElement>(`[data-target="${CSS.escape(path)}"], [data-slot="${CSS.escape(path)}"]`);
    if (el) return el;
    const cut = path.lastIndexOf(".");
    path = cut > 0 ? path.slice(0, cut) : "";
  }
  return null;
}

function attachIssue(issue: BuilderIssue, n: number): HTMLElement | null {
  const host = findTarget(issue.target);
  if (!host) return null;
  const errId = `${idFor(issue.target || "general")}-${n}-err`;
  const message = h("p", { class: `err${issue.severity === "warning" ? " warn" : ""}`, id: errId }, issue.message);
  if (host.matches("details")) {
    const body = host.querySelector(".entity-body");
    (body ?? host).prepend(message);
    if (issue.severity === "error") (host as HTMLDetailsElement).open = true;
  } else if (host.matches("fieldset, .err-slot, .policy-row")) {
    host.append(message);
  } else {
    host.append(message);
  }
  host.classList.add(issue.severity === "error" ? "has-error" : "has-warning");
  const input = host.querySelector<HTMLElement>(":scope > input, :scope > select, :scope > textarea");
  if (input) {
    if (issue.severity === "error") input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", `${input.getAttribute("aria-describedby") ?? ""} ${errId}`.trim());
  }
  // Expand a collapsed entity so the error is visible
  const parent = host.closest("details");
  if (parent && issue.severity === "error") parent.open = true;
  return host;
}

function focusIssue(issue: BuilderIssue): void {
  const host = findTarget(issue.target);
  if (!host) return;
  const details = host.closest("details");
  if (details) details.open = true;
  const focusable = host.matches("input, select, textarea, button")
    ? host
    : host.querySelector<HTMLElement>("input, select, textarea, button, summary");
  (focusable ?? host).scrollIntoView({ block: "center" });
  focusable?.focus({ preventScroll: true });
}

function refresh(): void {
  const result = validateConfig(cloneConfig(config));
  lastResult = result;
  yamlOut.textContent = result.yaml;
  clearErrors();
  const errors = result.issues.filter((issue) => issue.severity === "error");
  const warnings = result.issues.filter((issue) => issue.severity === "warning");
  issuesEl.replaceChildren();
  result.issues.forEach((issue, n) => {
    attachIssue(issue, n);
  });
  if (errors.length === 0) {
    statusEl.className = "status ok";
    statusEl.textContent = "Valid. This app.yaml passes the same schema and compiler checks the server runs at boot.";
    lastValidAst = result.ast;
  } else {
    statusEl.className = "status bad";
    statusEl.textContent = `${errors.length} problem${errors.length === 1 ? "" : "s"} to fix before this will boot.`;
    issuesEl.append(
      ...errors.map((issue) =>
        h(
          "li",
          {},
          h(
            "button",
            { type: "button", class: "issue-link", onClick: () => focusIssue(issue) },
            issue.message,
          ),
        ),
      ),
    );
  }
  const notes: HTMLElement[] = [];
  if (result.mailFiles.length > 0) {
    notes.push(
      h(
        "li",
        {},
        "Add these template files next to app.yaml: ",
        ...result.mailFiles.flatMap((file, k) => [k > 0 ? ", " : "", h("code", {}, file)]),
        ".",
      ),
    );
  }
  if (result.brandingFiles.length > 0) {
    notes.push(
      h(
        "li",
        {},
        "Add these branding files next to app.yaml: ",
        ...result.brandingFiles.flatMap((file, k) => [k > 0 ? ", " : "", h("code", {}, file)]),
        ".",
      ),
    );
  }
  for (const warning of warnings) notes.push(h("li", {}, warning.message));
  if (result.envVars.length > 0) {
    notes.push(
      h("li", {}, "Set these environment variables before boot: ", ...result.envVars.flatMap((name, k) => [k > 0 ? ", " : "", h("code", {}, name)]), "."),
    );
  }
  const hooks = (config.runtime as { hooks?: string }).hooks;
  if (hooks) notes.push(h("li", {}, "runtime.hooks points at ", h("code", {}, hooks), ". Keep that file in the project (create-bakorin makes one)."));
  notesEl.replaceChildren(...notes);
  notesEl.hidden = notes.length === 0;
  liveEl.textContent = errors.length === 0 ? "app.yaml is valid" : `${errors.length} problem${errors.length === 1 ? "" : "s"}`;
  renderDiagram(errors.length === 0 ? result.ast : lastValidAst, errors.length > 0);
}

function renderDiagram(ast: SchemaAST | undefined, stale: boolean): void {
  const note = document.getElementById("bk-diagram-note") as HTMLElement;
  if (!ast) {
    diagramEl.replaceChildren(h("p", { class: "hint" }, "The diagram appears once the config is valid."));
    note.textContent = "";
    return;
  }
  note.textContent = stale ? "Showing the last valid version while you fix the problems above." : "";
  const graph = buildSchemaGraph(ast);
  const hidden = new Set(["createdAt", "updatedAt"]);
  const entities = graph.entities.map((entity) => ({ ...entity, fields: entity.fields.filter((field) => !hidden.has(field.name)) }));
  const layout = layoutSchema(graph.layers, entities, graph.relations);
  const desc = graph.relations.length
    ? graph.relations.map((rel) => `${rel.from}.${rel.field} points to ${rel.to} (on delete ${rel.onDelete})`).join(". ")
    : "No relations yet.";
  const svg = s(
    "svg",
    {
      width: layout.width,
      height: layout.height,
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      role: "img",
      "aria-labelledby": "bk-diagram-title bk-diagram-desc",
      class: "diagram-svg",
    },
    s("title", { id: "bk-diagram-title" }, `${graph.entities.length} entities and ${graph.relations.length} relations`),
    s("desc", { id: "bk-diagram-desc" }, desc),
    s(
      "defs",
      {},
      s("marker", { id: "bk-arrow", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse" }, s("path", { d: "M0 0 L8 4 L0 8 z", class: "edge-head" })),
    ),
  );
  for (const edge of layout.edges) {
    if (!edge.d) continue;
    svg.append(s("path", { d: edge.d, class: "edge", "marker-end": "url(#bk-arrow)" }));
    svg.append(s("text", { x: edge.labelX, y: edge.labelY, class: "edge-label", "text-anchor": "middle" }, `${edge.field}, ${edge.onDelete}`));
  }
  for (const node of layout.nodes) {
    const entity = entities.find((item) => item.name === node.name)!;
    const g = s("g", { transform: `translate(${node.x} ${node.y})` });
    g.append(s("rect", { width: CARD_WIDTH, height: cardHeight(entity.fields.length), rx: 10, class: "card" }));
    g.append(s("rect", { width: CARD_WIDTH, height: HEADER_HEIGHT, rx: 10, class: "card-head" }));
    g.append(s("rect", { y: HEADER_HEIGHT - 10, width: CARD_WIDTH, height: 10, class: "card-head" }));
    g.append(s("text", { x: 14, y: 24, class: "card-title" }, entity.label));
    g.append(s("text", { x: 14, y: 42, class: "card-sub" }, `${entity.name}${entity.auth ? ", accounts" : ""}`));
    entity.fields.forEach((field, index) => {
      const y = HEADER_HEIGHT + index * FIELD_HEIGHT + FIELD_HEIGHT / 2 + 4;
      if (field.relation) g.append(s("rect", { y: HEADER_HEIGHT + index * FIELD_HEIGHT, width: CARD_WIDTH, height: FIELD_HEIGHT, class: "row-rel" }));
      g.append(s("text", { x: 14, y, class: "field-name" }, `${field.name}${field.required ? " *" : ""}`));
      g.append(s("text", { x: CARD_WIDTH - 14, y, class: "field-type", "text-anchor": "end" }, field.relation ? `to ${field.relation.to}` : field.type));
    });
    svg.append(g);
  }
  diagramEl.replaceChildren(svg);
}

// ---------- toolbar ----------

function announce(text: string): void {
  liveEl.textContent = "";
  window.setTimeout(() => (liveEl.textContent = text), 30);
}

function setup(): void {
  const starterSelect = document.getElementById("bk-starter") as HTMLSelectElement;
  starterSelect.addEventListener("change", () => {
    const id = starterSelect.value;
    if (id === "custom") return;
    const starter = STARTERS.find((item) => item.id === id);
    if (!starter) return;
    if (!confirm(`Replace your current config with the ${starter.label} starter?`)) {
      starterSelect.value = STARTERS.some((item) => item.id === starterId) ? starterId : "custom";
      return;
    }
    useStarter(id);
    openEntities.clear();
    [0, 1, 2].forEach((n) => openEntities.add(n));
    save();
    render();
    announce(`Loaded the ${starter.label} starter`);
  });

  document.getElementById("bk-copy")?.addEventListener("click", async () => {
    const text = lastResult?.yaml ?? "";
    try {
      await navigator.clipboard.writeText(text);
      announce("Copied app.yaml to the clipboard");
    } catch {
      const range = document.createRange();
      range.selectNodeContents(yamlOut);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      announce("Selected the YAML. Press Ctrl+C or Command+C to copy.");
    }
    const btn = document.getElementById("bk-copy") as HTMLButtonElement;
    btn.textContent = "Copied";
    window.setTimeout(() => (btn.textContent = "Copy"), 1600);
  });

  document.getElementById("bk-download")?.addEventListener("click", () => {
    const blob = new Blob([lastResult?.yaml ?? ""], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: "app.yaml" });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce("Downloaded app.yaml");
  });

  const dialog = document.getElementById("bk-import") as HTMLDialogElement;
  const area = document.getElementById("bk-import-text") as HTMLTextAreaElement;
  const file = document.getElementById("bk-import-file") as HTMLInputElement;
  const importError = document.getElementById("bk-import-error") as HTMLElement;
  document.getElementById("bk-open-import")?.addEventListener("click", () => {
    importError.textContent = "";
    area.value = "";
    dialog.showModal();
    area.focus();
  });
  document.getElementById("bk-import-cancel")?.addEventListener("click", () => dialog.close());
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    if (picked) area.value = await picked.text();
  });
  document.getElementById("bk-import-load")?.addEventListener("click", () => {
    try {
      if (!area.value.trim()) throw new Error("Paste an app.yaml or pick a file first.");
      const imported = importAppYaml(area.value);
      if (!imported.config.entities) throw new Error("No entities found.");
      config = imported.config;
      if (!config.auth) config.auth = defaultAuth();
      starterId = "custom";
      openEntities.clear();
      config.entities.forEach((_entity, n) => openEntities.add(n));
      save();
      dialog.close();
      render();
      announce(imported.warnings.length > 0 ? `Imported with ${imported.warnings.length} note${imported.warnings.length === 1 ? "" : "s"}: ${imported.warnings.join(" ")}` : "Imported app.yaml");
    } catch (error) {
      importError.textContent = error instanceof Error ? error.message : String(error);
      area.focus();
    }
  });

  loadInitial();
  render();
}

setup();
